const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const HOUR = 3600;
const DAY = 24 * HOUR;
const Phase = { None: 0, Hunting: 1, Disclosure: 2, Review: 3, Expired: 4, Settled: 5, Refunded: 6 };
const eth = (v) => ethers.parseEther(v);

const ARTIFACT = ethers.keccak256(ethers.toUtf8Bytes("fast-json-3.7.0.tgz"));
const PREVIOUS = ethers.keccak256(ethers.toUtf8Bytes("fast-json-3.6.9.tgz"));

function roomParams(overrides = {}) {
  return {
    ecosystem: "npm",
    packageName: "fast-json",
    version: "3.7.0",
    artifactHash: ARTIFACT,
    previousArtifactHash: PREVIOUS,
    moderator: overrides.moderator,
    huntDuration: 7 * DAY,
    disclosureDuration: 2 * DAY,
    adjudicationWindow: 14 * DAY,
    ...overrides,
  };
}

function commitmentOf(roomId, artifactHash, findingHash, researcher, nonce) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes32", "bytes32", "address", "bytes32"],
      [roomId, artifactHash, findingHash, researcher, nonce],
    ),
  );
}

async function deployFixture() {
  const [owner, developer, moderator, alice, bob, carol, outsider] = await ethers.getSigners();
  const ReleaseBond = await ethers.getContractFactory("ReleaseBond");
  const rb = await ReleaseBond.deploy(owner.address);
  await rb.setModerator(moderator.address, true);
  return { rb, owner, developer, moderator, alice, bob, carol, outsider };
}

async function roomFixture() {
  const ctx = await deployFixture();
  const { rb, developer, moderator } = ctx;
  await rb.connect(developer).createRoom(roomParams({ moderator: moderator.address }), { value: eth("500") });
  return { ...ctx, roomId: 1n };
}

async function commit(rb, signer, roomId, label) {
  const findingHash = ethers.keccak256(ethers.toUtf8Bytes(label));
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const c = commitmentOf(roomId, ARTIFACT, findingHash, signer.address, nonce);
  await rb.connect(signer).commitFinding(roomId, c);
  return { findingHash, nonce, commitment: c };
}

async function toReview(rb, roomId) {
  const room = await rb.getRoom(roomId);
  await time.increaseTo(room.disclosureEndsAt);
  expect(await rb.phaseOf(roomId)).to.equal(Phase.Review);
}

describe("ReleaseBond", function () {
  describe("moderator registry", function () {
    it("makes the owner a moderator and lets only the owner change the registry", async function () {
      const { rb, owner, outsider } = await loadFixture(deployFixture);
      expect(await rb.isModerator(owner.address)).to.equal(true);
      await expect(rb.connect(outsider).setModerator(outsider.address, true)).to.be.revertedWithCustomError(
        rb,
        "OwnableUnauthorizedAccount",
      );
      await expect(rb.setModerator(outsider.address, true))
        .to.emit(rb, "ModeratorUpdated")
        .withArgs(outsider.address, true);
      await expect(rb.setModerator(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(rb, "InvalidParams");
    });
  });

  describe("createRoom", function () {
    it("escrows the bounty, records the artifact and starts the hunt", async function () {
      const { rb, developer, moderator } = await loadFixture(deployFixture);
      const tx = rb.connect(developer).createRoom(roomParams({ moderator: moderator.address }), { value: eth("500") });
      await expect(tx).to.emit(rb, "RoomCreated");
      await expect(tx).to.changeEtherBalances([developer, rb], [eth("-500"), eth("500")]);

      const room = await rb.getRoom(1);
      expect(room.developer).to.equal(developer.address);
      expect(room.moderator).to.equal(moderator.address);
      expect(room.artifactHash).to.equal(ARTIFACT);
      expect(room.previousArtifactHash).to.equal(PREVIOUS);
      expect(room.bounty).to.equal(eth("500"));
      expect(room.ecosystem).to.equal("npm");
      expect(room.packageName).to.equal("fast-json");
      expect(room.version).to.equal("3.7.0");
      expect(room.disclosureEndsAt - room.huntEndsAt).to.equal(BigInt(2 * DAY));
      expect(room.adjudicationDeadline - room.disclosureEndsAt).to.equal(BigInt(14 * DAY));
      expect(await rb.phaseOf(1)).to.equal(Phase.Hunting);
      expect(await rb.activeRoomForArtifact(ARTIFACT)).to.equal(1n);
    });

    it("rejects unfunded rooms, bad parameters and unregistered moderators", async function () {
      const { rb, developer, moderator, outsider } = await loadFixture(deployFixture);
      const ok = roomParams({ moderator: moderator.address });
      const c = rb.connect(developer);
      await expect(c.createRoom(ok)).to.be.revertedWithCustomError(rb, "InvalidParams");
      await expect(c.createRoom({ ...ok, artifactHash: ethers.ZeroHash }, { value: 1 })).to.be.revertedWithCustomError(
        rb,
        "InvalidParams",
      );
      await expect(c.createRoom({ ...ok, huntDuration: 59 }, { value: 1 })).to.be.revertedWithCustomError(
        rb,
        "InvalidParams",
      );
      await expect(c.createRoom({ ...ok, ecosystem: "" }, { value: 1 })).to.be.revertedWithCustomError(
        rb,
        "InvalidParams",
      );
      await expect(c.createRoom({ ...ok, adjudicationWindow: HOUR }, { value: 1 })).to.be.revertedWithCustomError(
        rb,
        "InvalidParams",
      );
      await expect(c.createRoom({ ...ok, moderator: outsider.address }, { value: 1 })).to.be.revertedWithCustomError(
        rb,
        "NotModerator",
      );
    });

    it("forbids a developer from moderating their own release", async function () {
      const { rb, owner } = await loadFixture(deployFixture);
      await expect(
        rb.connect(owner).createRoom(roomParams({ moderator: owner.address }), { value: 1 }),
      ).to.be.revertedWithCustomError(rb, "ConflictOfInterest");
    });

    it("allows only one active room per exact artifact", async function () {
      const { rb, developer, moderator, alice } = await loadFixture(roomFixture);
      await expect(
        rb.connect(alice).createRoom(roomParams({ moderator: moderator.address }), { value: 1 }),
      ).to.be.revertedWithCustomError(rb, "ArtifactHasActiveRoom");
      const other = roomParams({ moderator: moderator.address, version: "3.7.1", artifactHash: PREVIOUS });
      await expect(rb.connect(developer).createRoom(other, { value: 1 })).to.emit(rb, "RoomCreated");
    });

    it("lets only the developer add to the pool, and only while hunting", async function () {
      const { rb, developer, alice, roomId } = await loadFixture(roomFixture);
      await expect(rb.connect(alice).increaseBounty(roomId, { value: 1 })).to.be.revertedWithCustomError(
        rb,
        "NotDeveloper",
      );
      await expect(rb.connect(developer).increaseBounty(roomId, { value: eth("100") }))
        .to.emit(rb, "BountyIncreased")
        .withArgs(roomId, eth("100"), eth("600"));
      await time.increase(7 * DAY);
      await expect(rb.connect(developer).increaseBounty(roomId, { value: 1 })).to.be.revertedWithCustomError(
        rb,
        "WrongPhase",
      );
    });
  });

  describe("commitments", function () {
    it("records private commitments during the hunt only", async function () {
      const { rb, alice, roomId } = await loadFixture(roomFixture);
      const { commitment } = await commit(rb, alice, roomId, "finding-a");
      const stored = await rb.getCommitment(roomId, 0);
      expect(stored.researcher).to.equal(alice.address);
      expect(stored.commitment).to.equal(commitment);
      expect(stored.revealed).to.equal(false);
      expect((await rb.getRoom(roomId)).commitmentCount).to.equal(1);

      await time.increase(7 * DAY);
      await expect(rb.connect(alice).commitFinding(roomId, ethers.id("late"))).to.be.revertedWithCustomError(
        rb,
        "WrongPhase",
      );
    });

    it("rejects commitments from the developer or moderator and reused commitments", async function () {
      const { rb, developer, moderator, alice, bob, roomId } = await loadFixture(roomFixture);
      await expect(rb.connect(developer).commitFinding(roomId, ethers.id("x"))).to.be.revertedWithCustomError(
        rb,
        "ConflictOfInterest",
      );
      await expect(rb.connect(moderator).commitFinding(roomId, ethers.id("x"))).to.be.revertedWithCustomError(
        rb,
        "ConflictOfInterest",
      );
      await rb.connect(alice).commitFinding(roomId, ethers.id("x"));
      await expect(rb.connect(bob).commitFinding(roomId, ethers.id("x"))).to.be.revertedWithCustomError(
        rb,
        "CommitmentReused",
      );
      await expect(rb.connect(bob).commitFinding(roomId, ethers.ZeroHash)).to.be.revertedWithCustomError(
        rb,
        "InvalidParams",
      );
    });

    it("matches the on-chain commitment formula", async function () {
      const { rb, alice, roomId } = await loadFixture(roomFixture);
      const fh = ethers.id("report");
      const nonce = ethers.id("nonce");
      expect(await rb.computeCommitment(roomId, ARTIFACT, fh, alice.address, nonce)).to.equal(
        commitmentOf(roomId, ARTIFACT, fh, alice.address, nonce),
      );
    });

    it("reveals only after the hunt, only by the researcher, only with the right preimage", async function () {
      const { rb, alice, bob, roomId } = await loadFixture(roomFixture);
      const a = await commit(rb, alice, roomId, "finding-a");

      await expect(rb.connect(alice).revealFinding(roomId, 0, a.findingHash, a.nonce)).to.be.revertedWithCustomError(
        rb,
        "WrongPhase",
      );
      await time.increase(7 * DAY);
      expect(await rb.phaseOf(roomId)).to.equal(Phase.Disclosure);

      await expect(rb.connect(bob).revealFinding(roomId, 0, a.findingHash, a.nonce)).to.be.revertedWithCustomError(
        rb,
        "NotResearcher",
      );
      await expect(
        rb.connect(alice).revealFinding(roomId, 0, ethers.id("tampered"), a.nonce),
      ).to.be.revertedWithCustomError(rb, "CommitmentMismatch");
      await expect(rb.connect(alice).revealFinding(roomId, 0, a.findingHash, a.nonce))
        .to.emit(rb, "FindingRevealed")
        .withArgs(roomId, 0, alice.address, a.findingHash);
      await expect(rb.connect(alice).revealFinding(roomId, 0, a.findingHash, a.nonce)).to.be.revertedWithCustomError(
        rb,
        "AlreadyRevealed",
      );
      expect((await rb.getRoom(roomId)).revealedCount).to.equal(1);
    });
  });

  describe("settlement", function () {
    async function reviewReady() {
      const ctx = await roomFixture();
      const { rb, alice, bob, carol, roomId } = ctx;
      const a = await commit(rb, alice, roomId, "finding-a");
      const b = await commit(rb, bob, roomId, "finding-a-independent");
      const c = await commit(rb, carol, roomId, "finding-c-invalid");
      await time.increase(7 * DAY);
      await rb.connect(alice).revealFinding(roomId, 0, a.findingHash, a.nonce);
      await rb.connect(bob).revealFinding(roomId, 1, b.findingHash, b.nonce);
      await rb.connect(carol).revealFinding(roomId, 2, c.findingHash, c.nonce);
      await toReview(rb, roomId);
      return ctx;
    }

    const ADJ = ethers.id("adjudication-record");

    it("pays discoverers and reviewers, refunds the remainder and records reputation", async function () {
      const { rb, developer, moderator, alice, bob, carol, outsider, roomId } = await loadFixture(reviewReady);
      const discoveries = [
        { commitmentIndex: 0, severity: 3, duplicate: false, amount: eth("300") },
        { commitmentIndex: 1, severity: 3, duplicate: true, amount: eth("100") },
      ];
      const reviews = [{ reviewer: outsider.address, amount: eth("50") }];

      const tx = rb.connect(moderator).finalizeSettlement(roomId, discoveries, reviews, [2], ADJ);
      await expect(tx).to.emit(rb, "RoomSettled").withArgs(roomId, ADJ, eth("450"), eth("50"));
      await expect(tx).to.emit(rb, "DiscoveryAwarded").withArgs(roomId, 0, alice.address, 3, false, eth("300"));
      await expect(tx).to.emit(rb, "ReviewAwarded").withArgs(roomId, outsider.address, eth("50"));
      await expect(tx).to.emit(rb, "FindingRejected").withArgs(roomId, 2, carol.address);

      expect(await rb.phaseOf(roomId)).to.equal(Phase.Settled);
      expect(await rb.pendingWithdrawals(alice.address)).to.equal(eth("300"));
      expect(await rb.pendingWithdrawals(bob.address)).to.equal(eth("100"));
      expect(await rb.pendingWithdrawals(outsider.address)).to.equal(eth("50"));
      expect(await rb.pendingWithdrawals(developer.address)).to.equal(eth("50"));
      expect(await rb.activeRoomForArtifact(ARTIFACT)).to.equal(0n);
      expect((await rb.getRoom(roomId)).adjudicationHash).to.equal(ADJ);

      const aliceStats = await rb.statsOf(alice.address);
      expect(aliceStats.validDiscoveries).to.equal(1);
      expect(aliceStats.highFindings).to.equal(1);
      expect(aliceStats.totalEarned).to.equal(eth("300"));
      expect((await rb.statsOf(bob.address)).duplicateDiscoveries).to.equal(1);
      expect((await rb.statsOf(carol.address)).rejectedFindings).to.equal(1);
      expect((await rb.statsOf(outsider.address)).reviewAwards).to.equal(1);

      await expect(rb.connect(alice).withdraw()).to.changeEtherBalances([alice, rb], [eth("300"), eth("-300")]);
      await expect(rb.connect(alice).withdraw()).to.be.revertedWithCustomError(rb, "NothingToWithdraw");
      await expect(rb.connect(developer).withdraw()).to.changeEtherBalance(developer, eth("50"));
    });

    it("keeps settlement with the room's moderator and inside the review phase", async function () {
      const { rb, owner, alice, roomId } = await loadFixture(roomFixture);
      await commit(rb, alice, roomId, "finding-a");
      await expect(rb.connect(owner).finalizeSettlement(roomId, [], [], [], ADJ)).to.be.revertedWithCustomError(
        rb,
        "NotModerator",
      );
    });

    it("refuses settlement before the disclosure window ends", async function () {
      const { rb, moderator, alice, roomId } = await loadFixture(roomFixture);
      await commit(rb, alice, roomId, "finding-a");
      await time.increase(7 * DAY);
      await expect(rb.connect(moderator).finalizeSettlement(roomId, [], [], [], ADJ)).to.be.revertedWithCustomError(
        rb,
        "WrongPhase",
      );
    });

    it("enforces award rules: revealed only, valid severity, unique indices, caps, bounty limit", async function () {
      const { rb, developer, moderator, alice, outsider, roomId } = await loadFixture(reviewReady);
      const s = (d, r = [], rej = []) => rb.connect(moderator).finalizeSettlement(roomId, d, r, rej, ADJ);
      const award = (i, amount, severity = 3) => ({ commitmentIndex: i, severity, duplicate: false, amount });

      await expect(s([award(9, 1)])).to.be.revertedWithCustomError(rb, "InvalidAward").withArgs("index");
      await expect(s([award(0, 1, 0)])).to.be.revertedWithCustomError(rb, "InvalidAward").withArgs("severity");
      await expect(s([award(0, 1, 5)])).to.be.revertedWithCustomError(rb, "InvalidAward").withArgs("severity");
      await expect(s([award(0, 1), award(0, 1)]))
        .to.be.revertedWithCustomError(rb, "InvalidAward")
        .withArgs("duplicate index");
      await expect(s([award(0, 1)], [], [0]))
        .to.be.revertedWithCustomError(rb, "InvalidAward")
        .withArgs("duplicate index");
      await expect(s([award(0, eth("501"))]))
        .to.be.revertedWithCustomError(rb, "InvalidAward")
        .withArgs("exceeds bounty");
      // review cap: at most 30% of the bounty
      await expect(s([award(0, eth("300"))], [{ reviewer: outsider.address, amount: eth("151") }]))
        .to.be.revertedWithCustomError(rb, "InvalidAward")
        .withArgs("review cap");
      // review may not exceed discovery
      await expect(s([award(0, eth("10"))], [{ reviewer: outsider.address, amount: eth("11") }]))
        .to.be.revertedWithCustomError(rb, "InvalidAward")
        .withArgs("review exceeds discovery");
      await expect(s([], [{ reviewer: developer.address, amount: 1 }]))
        .to.be.revertedWithCustomError(rb, "InvalidAward")
        .withArgs("reviewer");
      await expect(s([], [{ reviewer: moderator.address, amount: 1 }]))
        .to.be.revertedWithCustomError(rb, "InvalidAward")
        .withArgs("reviewer");
      await expect(rb.connect(moderator).finalizeSettlement(roomId, [award(0, 1)], [], [], ethers.ZeroHash))
        .to.be.revertedWithCustomError(rb, "InvalidParams");
      // alice is still unpaid after all those reverts
      expect(await rb.pendingWithdrawals(alice.address)).to.equal(0n);
    });

    it("refuses discovery awards for unrevealed commitments", async function () {
      const { rb, moderator, alice, roomId } = await loadFixture(roomFixture);
      await commit(rb, alice, roomId, "never-revealed");
      await toReview(rb, roomId);
      await expect(
        rb.connect(moderator).finalizeSettlement(
          roomId,
          [{ commitmentIndex: 0, severity: 4, duplicate: false, amount: 1 }],
          [],
          [],
          ADJ,
        ),
      )
        .to.be.revertedWithCustomError(rb, "InvalidAward")
        .withArgs("unrevealed");
    });

    it("pays reviewers up to the cap when no discovery was valid", async function () {
      const { rb, developer, moderator, outsider, roomId } = await loadFixture(reviewReady);
      await rb
        .connect(moderator)
        .finalizeSettlement(roomId, [], [{ reviewer: outsider.address, amount: eth("150") }], [0, 1, 2], ADJ);
      expect(await rb.pendingWithdrawals(outsider.address)).to.equal(eth("150"));
      expect(await rb.pendingWithdrawals(developer.address)).to.equal(eth("350"));
    });

    it("cannot settle twice", async function () {
      const { rb, moderator, roomId } = await loadFixture(reviewReady);
      await rb.connect(moderator).finalizeSettlement(roomId, [], [], [], ADJ);
      await expect(rb.connect(moderator).finalizeSettlement(roomId, [], [], [], ADJ)).to.be.revertedWithCustomError(
        rb,
        "WrongPhase",
      );
    });
  });

  describe("refunds", function () {
    it("lets the developer reclaim a pool that attracted no commitments", async function () {
      const { rb, developer, alice, roomId } = await loadFixture(roomFixture);
      await expect(rb.connect(developer).reclaimUnused(roomId)).to.be.revertedWithCustomError(rb, "WrongPhase");
      await time.increase(7 * DAY);
      await expect(rb.connect(alice).reclaimUnused(roomId)).to.be.revertedWithCustomError(rb, "NotDeveloper");
      await expect(rb.connect(developer).reclaimUnused(roomId))
        .to.emit(rb, "RoomRefunded")
        .withArgs(roomId, developer.address, eth("500"), "no commitments");
      expect(await rb.phaseOf(roomId)).to.equal(Phase.Refunded);
      expect(await rb.activeRoomForArtifact(ARTIFACT)).to.equal(0n);
      await expect(rb.connect(developer).withdraw()).to.changeEtherBalance(developer, eth("500"));
    });

    it("does not let the developer reclaim a pool once findings are committed", async function () {
      const { rb, developer, alice, roomId } = await loadFixture(roomFixture);
      await commit(rb, alice, roomId, "finding-a");
      await time.increase(7 * DAY);
      await expect(rb.connect(developer).reclaimUnused(roomId)).to.be.revertedWithCustomError(rb, "InvalidParams");
    });

    it("returns the pool only after the adjudication deadline if the moderator never settles", async function () {
      const { rb, developer, alice, outsider, roomId } = await loadFixture(roomFixture);
      await commit(rb, alice, roomId, "finding-a");
      await toReview(rb, roomId);
      await expect(rb.connect(outsider).refundExpired(roomId)).to.be.revertedWithCustomError(rb, "WrongPhase");
      const room = await rb.getRoom(roomId);
      await time.increaseTo(room.adjudicationDeadline + 1n);
      expect(await rb.phaseOf(roomId)).to.equal(Phase.Expired);
      await rb.connect(outsider).refundExpired(roomId);
      expect(await rb.pendingWithdrawals(developer.address)).to.equal(eth("500"));
    });
  });

  describe("views", function () {
    it("reverts for unknown rooms and reports None phase", async function () {
      const { rb } = await loadFixture(deployFixture);
      await expect(rb.getRoom(42)).to.be.revertedWithCustomError(rb, "RoomNotFound");
      expect(await rb.phaseOf(42)).to.equal(Phase.None);
    });
  });
});
