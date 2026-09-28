// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title ReleaseBond
/// @notice Release-level security bounties on MST.
///
/// A developer locks native MST against the exact hash of one software
/// release and names a registered security moderator. During the hunt,
/// researchers commit to private findings with
/// `keccak256(abi.encode(roomId, artifactHash, findingHash, researcher, nonce))`.
/// After the hunt closes they reveal `(findingHash, nonce)`, which proves they
/// possessed that exact finding at the commitment's block. Once the private
/// disclosure window has passed, the room's moderator finalizes settlement.
/// Discovery awards can only go to revealed commitments, review awards are
/// capped, and any remainder returns to the developer. All payouts are
/// credited and then withdrawn (pull payments).
///
/// High-value rooms can name a moderator panel: settlement then also needs
/// EIP-712 signatures from a quorum of panel members over the exact awards,
/// so the room moderator cannot change amounts after the panel approved them.
///
/// The contract never decides whether code is malicious. It only enforces
/// escrow, timing, commitments and the settlement rules.
contract ReleaseBond is Ownable2Step, ReentrancyGuard, EIP712 {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// Review contributions may take at most 30% of the bounty.
    uint256 public constant MAX_REVIEW_BPS = 3_000;
    uint256 private constant BPS = 10_000;

    uint64 public constant MIN_HUNT_DURATION = 60; // short hunts keep demos practical
    uint64 public constant MAX_HUNT_DURATION = 90 days;
    uint64 public constant MAX_DISCLOSURE_DURATION = 90 days;
    uint64 public constant MIN_ADJUDICATION_WINDOW = 1 days;
    uint64 public constant MAX_ADJUDICATION_WINDOW = 180 days;

    uint256 public constant MAX_PANEL = 5;
    bytes32 public constant SETTLEMENT_TYPEHASH =
        keccak256("Settlement(uint256 roomId,bytes32 adjudicationHash,bytes32 awardsHash)");

    uint8 public constant SEVERITY_NONE = 0;
    uint8 public constant SEVERITY_CRITICAL = 4;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Status {
        None,
        Active, // funded; phase derives from timestamps
        Settled,
        Refunded
    }

    enum Phase {
        None,
        Hunting,
        Disclosure,
        Review,
        Expired,
        Settled,
        Refunded
    }

    struct Room {
        address developer;
        address moderator;
        uint64 createdAt;
        uint64 huntEndsAt;
        uint64 disclosureEndsAt;
        uint64 adjudicationDeadline;
        Status status;
        uint32 commitmentCount;
        uint32 revealedCount;
        bytes32 artifactHash;
        bytes32 previousArtifactHash;
        uint256 bounty;
        bytes32 adjudicationHash;
        string ecosystem;
        string packageName;
        string version;
    }

    struct Commitment {
        address researcher;
        uint64 committedAt;
        uint64 blockNumber;
        bool revealed;
        bytes32 commitment;
        bytes32 findingHash;
    }

    struct CreateRoomParams {
        string ecosystem;
        string packageName;
        string version;
        bytes32 artifactHash;
        bytes32 previousArtifactHash;
        address moderator;
        uint64 huntDuration;
        uint64 disclosureDuration;
        uint64 adjudicationWindow;
        /// Optional co-moderators whose signatures settlement requires.
        address[] panel;
        /// How many distinct panel signatures settlement needs (0 when no panel).
        uint8 panelQuorum;
    }

    struct DiscoveryAward {
        uint32 commitmentIndex;
        uint8 severity; // 1 low .. 4 critical
        bool duplicate; // independent duplicate of an earlier valid finding
        uint256 amount;
    }

    struct ReviewAward {
        address reviewer;
        uint256 amount;
    }

    struct ResearcherStats {
        uint32 validDiscoveries;
        uint32 duplicateDiscoveries;
        uint32 criticalFindings;
        uint32 highFindings;
        uint32 reviewAwards;
        uint32 rejectedFindings;
        uint256 totalEarned;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    uint256 public roomCount;
    mapping(uint256 roomId => Room) private _rooms;
    mapping(uint256 roomId => Commitment[]) private _commitments;
    /// One active room per (artifact, funder). Scoping by funder means a third
    /// party cannot block a developer from funding their own release by
    /// opening a dust-sized room on the same artifact first.
    mapping(bytes32 artifactHash => mapping(address developer => uint256 roomId)) public activeRoomForArtifact;
    mapping(bytes32 commitment => bool) public commitmentUsed;
    mapping(address => bool) public isModerator;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(address => ResearcherStats) private _stats;
    mapping(uint256 roomId => address[]) private _panels;
    mapping(uint256 roomId => uint8) public panelQuorum;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event ModeratorUpdated(address indexed moderator, bool enabled);
    event RoomCreated(
        uint256 indexed roomId,
        address indexed developer,
        address indexed moderator,
        bytes32 artifactHash,
        string ecosystem,
        string packageName,
        string version,
        uint256 bounty,
        uint64 huntEndsAt,
        uint64 disclosureEndsAt,
        uint64 adjudicationDeadline
    );
    event PanelConfigured(uint256 indexed roomId, address[] panel, uint8 quorum);
    event BountyIncreased(uint256 indexed roomId, uint256 amount, uint256 newBounty);
    event FindingCommitted(
        uint256 indexed roomId, uint32 indexed index, address indexed researcher, bytes32 commitment
    );
    event FindingRevealed(
        uint256 indexed roomId, uint32 indexed index, address indexed researcher, bytes32 findingHash
    );
    event DiscoveryAwarded(
        uint256 indexed roomId,
        uint32 indexed index,
        address indexed researcher,
        uint8 severity,
        bool duplicate,
        uint256 amount
    );
    event ReviewAwarded(uint256 indexed roomId, address indexed reviewer, uint256 amount);
    event FindingRejected(uint256 indexed roomId, uint32 indexed index, address indexed researcher);
    event RoomSettled(
        uint256 indexed roomId, bytes32 adjudicationHash, uint256 totalAwarded, uint256 refunded
    );
    event RoomRefunded(uint256 indexed roomId, address indexed developer, uint256 amount, string reason);
    event Withdrawal(address indexed account, uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error InvalidParams(string reason);
    error NotModerator();
    error NotDeveloper();
    error NotResearcher();
    error RoomNotFound();
    error WrongPhase(Phase current);
    error ArtifactHasActiveRoom(uint256 roomId);
    error CommitmentReused();
    error ConflictOfInterest();
    error AlreadyRevealed();
    error CommitmentMismatch();
    error InvalidAward(string reason);
    error NothingToWithdraw();
    error TransferFailed();
    error PanelApproval(string reason);

    constructor(address initialOwner) Ownable(initialOwner) EIP712("ReleaseBond", "1") {
        isModerator[initialOwner] = true;
        emit ModeratorUpdated(initialOwner, true);
    }

    // ---------------------------------------------------------------------
    // Moderator registry
    // ---------------------------------------------------------------------

    function setModerator(address moderator, bool enabled) external onlyOwner {
        if (moderator == address(0)) revert InvalidParams("zero moderator");
        isModerator[moderator] = enabled;
        emit ModeratorUpdated(moderator, enabled);
    }

    // ---------------------------------------------------------------------
    // Developer: register and fund
    // ---------------------------------------------------------------------

    function createRoom(CreateRoomParams calldata p) external payable returns (uint256 roomId) {
        if (msg.value == 0) revert InvalidParams("bounty required");
        if (p.artifactHash == bytes32(0)) revert InvalidParams("artifact hash required");
        if (bytes(p.ecosystem).length == 0 || bytes(p.ecosystem).length > 32) {
            revert InvalidParams("ecosystem");
        }
        if (bytes(p.packageName).length == 0 || bytes(p.packageName).length > 214) {
            revert InvalidParams("package name");
        }
        if (bytes(p.version).length == 0 || bytes(p.version).length > 128) revert InvalidParams("version");
        if (p.huntDuration < MIN_HUNT_DURATION || p.huntDuration > MAX_HUNT_DURATION) {
            revert InvalidParams("hunt duration");
        }
        if (p.disclosureDuration > MAX_DISCLOSURE_DURATION) revert InvalidParams("disclosure duration");
        if (p.adjudicationWindow < MIN_ADJUDICATION_WINDOW || p.adjudicationWindow > MAX_ADJUDICATION_WINDOW) {
            revert InvalidParams("adjudication window");
        }
        if (!isModerator[p.moderator]) revert NotModerator();
        if (p.moderator == msg.sender) revert ConflictOfInterest();
        _validatePanel(p);

        uint256 existing = activeRoomForArtifact[p.artifactHash][msg.sender];
        if (existing != 0) revert ArtifactHasActiveRoom(existing);

        roomId = ++roomCount;
        uint64 nowTs = uint64(block.timestamp);
        uint64 huntEnds = nowTs + p.huntDuration;
        uint64 disclosureEnds = huntEnds + p.disclosureDuration;

        Room storage r = _rooms[roomId];
        r.developer = msg.sender;
        r.moderator = p.moderator;
        r.createdAt = nowTs;
        r.huntEndsAt = huntEnds;
        r.disclosureEndsAt = disclosureEnds;
        r.adjudicationDeadline = disclosureEnds + p.adjudicationWindow;
        r.status = Status.Active;
        r.artifactHash = p.artifactHash;
        r.previousArtifactHash = p.previousArtifactHash;
        r.bounty = msg.value;
        r.ecosystem = p.ecosystem;
        r.packageName = p.packageName;
        r.version = p.version;

        activeRoomForArtifact[p.artifactHash][msg.sender] = roomId;
        if (p.panel.length > 0) {
            _panels[roomId] = p.panel;
            panelQuorum[roomId] = p.panelQuorum;
            emit PanelConfigured(roomId, p.panel, p.panelQuorum);
        }

        emit RoomCreated(
            roomId,
            msg.sender,
            p.moderator,
            p.artifactHash,
            p.ecosystem,
            p.packageName,
            p.version,
            msg.value,
            huntEnds,
            disclosureEnds,
            r.adjudicationDeadline
        );
    }

    /// The developer may add to the pool while the hunt is still open.
    function increaseBounty(uint256 roomId) external payable {
        Room storage r = _room(roomId);
        if (msg.sender != r.developer) revert NotDeveloper();
        if (msg.value == 0) revert InvalidParams("amount");
        Phase ph = phaseOf(roomId);
        if (ph != Phase.Hunting) revert WrongPhase(ph);
        r.bounty += msg.value;
        emit BountyIncreased(roomId, msg.value, r.bounty);
    }

    // ---------------------------------------------------------------------
    // Researchers: commit and reveal
    // ---------------------------------------------------------------------

    function commitFinding(uint256 roomId, bytes32 commitment) external returns (uint32 index) {
        Room storage r = _room(roomId);
        Phase ph = phaseOf(roomId);
        if (ph != Phase.Hunting) revert WrongPhase(ph);
        if (msg.sender == r.developer || msg.sender == r.moderator) revert ConflictOfInterest();
        if (commitment == bytes32(0)) revert InvalidParams("commitment");
        if (commitmentUsed[commitment]) revert CommitmentReused();

        commitmentUsed[commitment] = true;
        index = uint32(_commitments[roomId].length);
        _commitments[roomId].push(
            Commitment({
                researcher: msg.sender,
                committedAt: uint64(block.timestamp),
                blockNumber: uint64(block.number),
                revealed: false,
                commitment: commitment,
                findingHash: bytes32(0)
            })
        );
        r.commitmentCount += 1;
        emit FindingCommitted(roomId, index, msg.sender, commitment);
    }

    function revealFinding(uint256 roomId, uint32 index, bytes32 findingHash, bytes32 nonce) external {
        Room storage r = _room(roomId);
        Phase ph = phaseOf(roomId);
        if (ph != Phase.Disclosure && ph != Phase.Review) revert WrongPhase(ph);
        if (index >= _commitments[roomId].length) revert InvalidParams("index");
        Commitment storage c = _commitments[roomId][index];
        if (c.researcher != msg.sender) revert NotResearcher();
        if (c.revealed) revert AlreadyRevealed();
        if (computeCommitment(roomId, r.artifactHash, findingHash, msg.sender, nonce) != c.commitment) {
            revert CommitmentMismatch();
        }
        c.revealed = true;
        c.findingHash = findingHash;
        r.revealedCount += 1;
        emit FindingRevealed(roomId, index, msg.sender, findingHash);
    }

    function computeCommitment(
        uint256 roomId,
        bytes32 artifactHash,
        bytes32 findingHash,
        address researcher,
        bytes32 nonce
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(roomId, artifactHash, findingHash, researcher, nonce));
    }

    // ---------------------------------------------------------------------
    // Moderator: settlement
    // ---------------------------------------------------------------------

    /// @param adjudicationHash keccak256 of the canonical public adjudication
    ///        record (verdicts, severities, duplicates, reasoning) kept off-chain.
    /// @param rejected commitment indices judged invalid (reputation only).
    function finalizeSettlement(
        uint256 roomId,
        DiscoveryAward[] calldata discoveries,
        ReviewAward[] calldata reviews,
        uint32[] calldata rejected,
        bytes32 adjudicationHash,
        bytes[] calldata panelSignatures
    ) external nonReentrant {
        Room storage r = _room(roomId);
        if (msg.sender != r.moderator) revert NotModerator();
        Phase ph = phaseOf(roomId);
        if (ph != Phase.Review) revert WrongPhase(ph);
        if (adjudicationHash == bytes32(0)) revert InvalidParams("adjudication hash");
        _checkPanel(roomId, adjudicationHash, hashAwards(discoveries, reviews, rejected), panelSignatures);

        (uint256 discoveryTotal, uint256 reviewTotal) = _validateAwards(roomId, r, discoveries, reviews, rejected);

        // Discovery must dominate: review awards never exceed discovery
        // awards when there are discoveries, and never exceed the review cap.
        if (reviewTotal * BPS > r.bounty * MAX_REVIEW_BPS) revert InvalidAward("review cap");
        if (discoveryTotal > 0 && reviewTotal > discoveryTotal) revert InvalidAward("review exceeds discovery");
        uint256 totalAwarded = discoveryTotal + reviewTotal;
        if (totalAwarded > r.bounty) revert InvalidAward("exceeds bounty");

        r.status = Status.Settled;
        r.adjudicationHash = adjudicationHash;
        delete activeRoomForArtifact[r.artifactHash][r.developer];

        _payDiscoveries(roomId, discoveries);
        _payReviews(roomId, reviews);
        _recordRejected(roomId, rejected);

        uint256 refund = r.bounty - totalAwarded;
        if (refund > 0) pendingWithdrawals[r.developer] += refund;
        emit RoomSettled(roomId, adjudicationHash, totalAwarded, refund);
    }

    function _validateAwards(
        uint256 roomId,
        Room storage r,
        DiscoveryAward[] calldata discoveries,
        ReviewAward[] calldata reviews,
        uint32[] calldata rejected
    ) private view returns (uint256 discoveryTotal, uint256 reviewTotal) {
        Commitment[] storage cs = _commitments[roomId];
        // Every awarded or rejected index must be unique across both lists.
        bool[] memory seen = new bool[](cs.length);

        for (uint256 i = 0; i < discoveries.length; i++) {
            DiscoveryAward calldata a = discoveries[i];
            if (a.commitmentIndex >= cs.length) revert InvalidAward("index");
            if (seen[a.commitmentIndex]) revert InvalidAward("duplicate index");
            seen[a.commitmentIndex] = true;
            if (!cs[a.commitmentIndex].revealed) revert InvalidAward("unrevealed");
            if (a.severity == SEVERITY_NONE || a.severity > SEVERITY_CRITICAL) revert InvalidAward("severity");
            if (a.amount == 0) revert InvalidAward("discovery amount");
            discoveryTotal += a.amount;
        }
        for (uint256 i = 0; i < reviews.length; i++) {
            ReviewAward calldata a = reviews[i];
            if (a.reviewer == address(0) || a.reviewer == r.developer || a.reviewer == r.moderator) {
                revert InvalidAward("reviewer");
            }
            if (a.amount == 0) revert InvalidAward("review amount");
            reviewTotal += a.amount;
        }
        for (uint256 i = 0; i < rejected.length; i++) {
            if (rejected[i] >= cs.length) revert InvalidAward("index");
            if (seen[rejected[i]]) revert InvalidAward("duplicate index");
            seen[rejected[i]] = true;
        }
    }

    function _payDiscoveries(uint256 roomId, DiscoveryAward[] calldata discoveries) private {
        Commitment[] storage cs = _commitments[roomId];
        for (uint256 i = 0; i < discoveries.length; i++) {
            DiscoveryAward calldata a = discoveries[i];
            address researcher = cs[a.commitmentIndex].researcher;
            ResearcherStats storage s = _stats[researcher];
            if (a.duplicate) s.duplicateDiscoveries += 1;
            else s.validDiscoveries += 1;
            if (a.severity == SEVERITY_CRITICAL) s.criticalFindings += 1;
            else if (a.severity == SEVERITY_CRITICAL - 1) s.highFindings += 1;
            s.totalEarned += a.amount;
            pendingWithdrawals[researcher] += a.amount;
            emit DiscoveryAwarded(roomId, a.commitmentIndex, researcher, a.severity, a.duplicate, a.amount);
        }
    }

    function _payReviews(uint256 roomId, ReviewAward[] calldata reviews) private {
        for (uint256 i = 0; i < reviews.length; i++) {
            ReviewAward calldata a = reviews[i];
            ResearcherStats storage s = _stats[a.reviewer];
            s.reviewAwards += 1;
            s.totalEarned += a.amount;
            pendingWithdrawals[a.reviewer] += a.amount;
            emit ReviewAwarded(roomId, a.reviewer, a.amount);
        }
    }

    function _recordRejected(uint256 roomId, uint32[] calldata rejected) private {
        Commitment[] storage cs = _commitments[roomId];
        for (uint256 i = 0; i < rejected.length; i++) {
            address researcher = cs[rejected[i]].researcher;
            _stats[researcher].rejectedFindings += 1;
            emit FindingRejected(roomId, rejected[i], researcher);
        }
    }

    // ---------------------------------------------------------------------
    // Moderator panels
    // ---------------------------------------------------------------------

    function _validatePanel(CreateRoomParams calldata p) private view {
        uint256 n = p.panel.length;
        if (n > MAX_PANEL) revert InvalidParams("panel too large");
        if (n == 0) {
            if (p.panelQuorum != 0) revert InvalidParams("quorum without panel");
            return;
        }
        if (p.panelQuorum == 0 || p.panelQuorum > n) revert InvalidParams("panel quorum");
        for (uint256 i = 0; i < n; i++) {
            address m = p.panel[i];
            if (!isModerator[m]) revert NotModerator();
            if (m == msg.sender || m == p.moderator) revert ConflictOfInterest();
            for (uint256 j = 0; j < i; j++) {
                if (p.panel[j] == m) revert InvalidParams("duplicate panelist");
            }
        }
    }

    /// keccak256 of the exact award arrays; panelists sign this (via EIP-712).
    function hashAwards(
        DiscoveryAward[] calldata discoveries,
        ReviewAward[] calldata reviews,
        uint32[] calldata rejected
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(discoveries, reviews, rejected));
    }

    /// EIP-712 digest a panelist signs to approve a settlement.
    function settlementDigest(uint256 roomId, bytes32 adjudicationHash, bytes32 awardsHash) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(SETTLEMENT_TYPEHASH, roomId, adjudicationHash, awardsHash)));
    }

    function _checkPanel(uint256 roomId, bytes32 adjudicationHash, bytes32 awardsHash, bytes[] calldata sigs) private view {
        uint8 quorum = panelQuorum[roomId];
        if (quorum == 0) return;
        address[] storage panel = _panels[roomId];
        bytes32 digest = settlementDigest(roomId, adjudicationHash, awardsHash);
        address[] memory seen = new address[](sigs.length);
        uint256 valid;
        for (uint256 i = 0; i < sigs.length; i++) {
            address signer = ECDSA.recover(digest, sigs[i]);
            bool member;
            for (uint256 j = 0; j < panel.length; j++) {
                if (panel[j] == signer) member = true;
            }
            if (!member) revert PanelApproval("signer not on panel");
            for (uint256 k = 0; k < valid; k++) {
                if (seen[k] == signer) revert PanelApproval("duplicate signer");
            }
            seen[valid++] = signer;
        }
        if (valid < quorum) revert PanelApproval("quorum not met");
    }

    function getPanel(uint256 roomId) external view returns (address[] memory panel, uint8 quorum) {
        return (_panels[roomId], panelQuorum[roomId]);
    }

    // ---------------------------------------------------------------------
    // Refund paths
    // ---------------------------------------------------------------------

    /// After the hunt, a room with zero commitments has nothing to judge.
    function reclaimUnused(uint256 roomId) external {
        Room storage r = _room(roomId);
        if (msg.sender != r.developer) revert NotDeveloper();
        Phase ph = phaseOf(roomId);
        if (ph == Phase.Hunting || ph == Phase.Settled || ph == Phase.Refunded) revert WrongPhase(ph);
        if (r.commitmentCount != 0) revert InvalidParams("room has commitments");
        _refund(r, roomId, "no commitments");
    }

    /// If the moderator never settles, anyone may return the pool to the
    /// developer after the adjudication deadline so funds cannot be stuck.
    function refundExpired(uint256 roomId) external {
        Room storage r = _room(roomId);
        Phase ph = phaseOf(roomId);
        if (ph != Phase.Expired) revert WrongPhase(ph);
        _refund(r, roomId, "adjudication deadline passed");
    }

    function _refund(Room storage r, uint256 roomId, string memory reason) private {
        r.status = Status.Refunded;
        delete activeRoomForArtifact[r.artifactHash][r.developer];
        pendingWithdrawals[r.developer] += r.bounty;
        emit RoomRefunded(roomId, r.developer, r.bounty, reason);
    }

    // ---------------------------------------------------------------------
    // Withdrawals
    // ---------------------------------------------------------------------

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawal(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function phaseOf(uint256 roomId) public view returns (Phase) {
        Room storage r = _rooms[roomId];
        if (r.status == Status.None) return Phase.None;
        if (r.status == Status.Settled) return Phase.Settled;
        if (r.status == Status.Refunded) return Phase.Refunded;
        if (block.timestamp < r.huntEndsAt) return Phase.Hunting;
        if (block.timestamp < r.disclosureEndsAt) return Phase.Disclosure;
        if (block.timestamp <= r.adjudicationDeadline) return Phase.Review;
        return Phase.Expired;
    }

    function getRoom(uint256 roomId) external view returns (Room memory) {
        if (_rooms[roomId].status == Status.None) revert RoomNotFound();
        return _rooms[roomId];
    }

    function getCommitment(uint256 roomId, uint32 index) external view returns (Commitment memory) {
        return _commitments[roomId][index];
    }

    function getCommitments(uint256 roomId) external view returns (Commitment[] memory) {
        return _commitments[roomId];
    }

    function statsOf(address account) external view returns (ResearcherStats memory) {
        return _stats[account];
    }

    function _room(uint256 roomId) private view returns (Room storage r) {
        r = _rooms[roomId];
        if (r.status == Status.None) revert RoomNotFound();
    }
}
