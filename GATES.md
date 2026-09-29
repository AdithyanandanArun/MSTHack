# Gates: ReleaseBond MVP on MST Testnet

OWNS: contracts/**, web/**, demo/**, scripts/**, README.md, HANDOFF.md, GATES.md, .gitignore, package.json

Scope: a working ReleaseBond web app (GitHub-issues-style findings, threaded adversarial review, evidence engine) backed by a tested ReleaseBond escrow/commitment/settlement contract deployable to MST Testnet, pushed to GitHub with a handoff note.

- [x] G0: this ledger states outcomes that can fail
  CHECK: node /home/adithyan/.claude/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=1b83816ddf3db89ce2a31a3a6e49a4a0a9d9f5e700761ed6e598381d81102d44; exit=0; EXPECT=matched; output-sha256=497e1b1fd83aa8c97730b46891c668bfc53799ce4cdaa54b7d44728bf3aca6e2; output-bytes=150; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G1: the contract test suite passes, covering escrow, commit/reveal, settlement caps, refunds and access control
  CHECK: node scripts/check-contracts.mjs
  EXPECT: CONTRACT SUITE VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c74f877f8259cddf7c94f37fe6d8c87708f84b191b3945b3ada294445914e4dc; exit=0; EXPECT=matched; output-sha256=0cf48c583513347289f56aff030816d82c9ee308501bbb33aaf2c2170555db1c; output-bytes=2071; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G2: the compiled bytecode is accepted by the live MST Testnet EVM (chain id and deploy gas estimate measured over RPC)
  CHECK: node scripts/check-mst-testnet.mjs
  EXPECT: MST TESTNET DEPLOY ESTIMATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=dabb90616a1312e85cdbf64938eb08136e1ee7adf010cd28f2a8afd40474d317; exit=0; EXPECT=matched; output-sha256=4762eb4b0fb9b6c77b385df0f25d8d40e3dc28eb98f062d13fa2eb53c80fb629; output-bytes=109; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G3: web unit tests pass (commitment hash parity with Solidity, evidence rules detect the malicious fixture and stay silent on the benign control)
  CHECK: node scripts/check-web-unit.mjs
  EXPECT: WEB UNIT VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5234dd54e2c379e3ba36b330c9774284b0418d8dad262b963ed6ad9159c430f3; exit=0; EXPECT=matched; output-sha256=2397a3f9addb2f2cf3c9b9d5b70fc8f4b6d461c3447fe9a025d788cf463838b3; output-bytes=594; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G4: the web app typechecks and produces a production build
  CHECK: node scripts/check-web-build.mjs
  EXPECT: WEB BUILD VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=27c11e690719a95f6fa8db1581eb15bf1add792ad831d73b3d7ef46dba42bc1c; exit=0; EXPECT=matched; output-sha256=cc52012c5a7b37130e7984fe30be9e01f7796d333276d8baba7d092aed2075a3; output-bytes=167; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G5: a full lifecycle runs end to end against a local chain through the real HTTP API (fund, commit, reveal, review thread, reproduction, adjudication, on-chain settlement, withdrawal balances)
  CHECK: node scripts/check-e2e.mjs
  EXPECT: E2E LIFECYCLE PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=e6d0cc70d967b6f85a6e6cb2cfecf5cd0aee81e365087790d0c2cf2d713181af; exit=0; EXPECT=matched; output-sha256=0f4edeba883fcf78c134f8e8c3d4d6bfb0cf3b95abe4f782fec6e806b20a0ba4; output-bytes=5829; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G6: the Docker sandbox records install-time telemetry (sensitive file read and outbound connection attempt) for the demo package
  CHECK: node scripts/check-sandbox.mjs
  EXPECT: SANDBOX TELEMETRY VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=16036077e7c67898ef227c82fb6c3970bda19d5df134f952dc221dec9c621e2e; exit=0; EXPECT=matched; output-sha256=406e9d85c1efea26a1a8dc6953ed404792ab8ed066b45a10c68b77f14ccfc8f2; output-bytes=561; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G7: the pacman adapter downloads a real Arch package, verifies its hash and normalizes it into a ReleaseArtifact
  CHECK: node scripts/check-pacman.mjs
  EXPECT: PACMAN ADAPTER VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=efa97e4e52ba5a38516418a8f1f9346854b23cadcc12955e326f946ff3d1777e; exit=0; EXPECT=matched; output-sha256=173194b171d12ad979dfbc8fb2a8ea7e019d8ad5945871b8852fd78ad11105db; output-bytes=602; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G8: history has several granular commits, none carrying a Claude co-author trailer, and origin/main equals local HEAD with a clean tree and handoff docs present
  CHECK: node scripts/check-repo.mjs
  EXPECT: REPO STATE VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=3db2d3bc5b71572199324fa6c5652bbf4ec7f4fc92a50f7f3585056fa3dbeb0e; exit=0; EXPECT=matched; output-sha256=9ff3c7c9df6dde35607ad258b87ca611dd3059c63f9443c595027c9eff11f604; output-bytes=53; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G9: the ReleaseBond contract is deployed on MST Testnet from the owner's Bridgekey wallet and the app is configured with its address
  EVIDENCE: 2026-09-29 deployed from the owner's BridgeKey account via /admin: address 0xA3e1622062c55cEf8B5406330798a7d81aAcfb3F, tx 0x2123b33ff529df5710bcf3052f7e36fdf92c66cbb7651d96587bebf8bde7b7cf, block 5798399, owner() = 0x83431e1da2f753bc076dffb2c188575e5b7f8721 (the deployer), 18903 bytes of runtime code on chain; the app stored it (settings contract:91562037) and /api/health reports contract configured and the indexer ok on chain 91562037. Source verified on https://testnet.mstscan.com/address/0xA3e1622062c55cEf8B5406330798a7d81aAcfb3F (ReleaseBond, solc v0.8.28+commit.7893614a).

- [ ] G10: the npm sandbox installs the release's dependency tree (prefetched with scripts disabled, then run offline) and observes an attack hidden in a dependency's install hook while the root package has none; the benign control stays silent
  CHECK: node scripts/check-npm-deps.mjs
  EXPECT: NPM DEPENDENCY SANDBOX VERIFIED
  EVIDENCE: pending

- [ ] G11: the pacman sandbox executes a package's .INSTALL scriptlet offline and records its sensitive read, outbound connection attempt and persistence write; a package without scriptlets records nothing
  CHECK: node scripts/check-pacman-sandbox.mjs
  EXPECT: PACMAN SANDBOX VERIFIED
  EVIDENCE: pending

- [ ] G12: evidence reports for pacman rooms now include dynamic sandbox runs, and a pacman finding's claims are confirmed dynamically end to end through the evidence pipeline
  CHECK: node scripts/check-pacman-evidence.mjs
  EXPECT: PACMAN EVIDENCE PIPELINE VERIFIED
  EVIDENCE: pending

ABANDON: G10 not pursued: it needed new attack-imitating fixture packages; owner decision required on how to test dependency hooks
ABANDON: G11 not pursued: it needed an attack-imitating pacman fixture; owner decision required on the test approach
ABANDON: G12 depends on G11; not pursued

- [x] G13: write endpoints are rate limited per wallet (429 with Retry-After once the budget is spent) while reads keep working, and uploads stop at the per-wallet storage quota; the full lifecycle still passes
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /write endpoints rate limited with Retry-After[\s\S]*reads unaffected by write limits[\s\S]*upload quota enforced per wallet[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=bbe8bf1ad47ecdc97c5ef18ec91ae534a493af913e3a9d331ee8ce4e1e87b4f0; exit=0; EXPECT=matched; output-sha256=0f4edeba883fcf78c134f8e8c3d4d6bfb0cf3b95abe4f782fec6e806b20a0ba4; output-bytes=5829; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G14: the limiter's window, per-key isolation and reset behaviour are unit tested
  CHECK: node scripts/check-web-unit.mjs
  EXPECT: WEB UNIT VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5234dd54e2c379e3ba36b330c9774284b0418d8dad262b963ed6ad9159c430f3; exit=0; EXPECT=matched; output-sha256=14b25ccc7c9110dd3f8843b21fa7fda82c4172bad5db7216a2a6c8284ea4cd70; output-bytes=594; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G15: a room can require verified researchers: an unverified wallet's report is refused, a moderator-verified wallet's report is accepted, and the requirement is mirrored from the room draft
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /unverified researcher refused in a verified-only room[\s\S]*verified researcher accepted[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=031c4c84f39d906a42cf38e281db3d70d09a91f7a5141c992e5d841065a15c45; exit=0; EXPECT=matched; output-sha256=0f4edeba883fcf78c134f8e8c3d4d6bfb0cf3b95abe4f782fec6e806b20a0ba4; output-bytes=5829; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G16: a verdict can be appealed once by the author or developer, only a different moderator can decide it, settlement is refused while it is open, and the decision is part of the published adjudication record
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /appeal filed by the author[\s\S]*room moderator cannot decide an appeal[\s\S]*settlement blocked while an appeal is open[\s\S]*appeal decided by a second moderator[\s\S]*appeal recorded in the adjudication record[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=7a649da4fe631e67e48c96709b82070cbacf1f88867de4199fa8b27f49385ea3; exit=0; EXPECT=matched; output-sha256=0f4edeba883fcf78c134f8e8c3d4d6bfb0cf3b95abe4f782fec6e806b20a0ba4; output-bytes=5829; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G17: appeal eligibility rules are unit tested (who may appeal, who may decide, when)
  CHECK: node scripts/check-web-unit.mjs
  EXPECT: WEB UNIT VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5234dd54e2c379e3ba36b330c9774284b0418d8dad262b963ed6ad9159c430f3; exit=0; EXPECT=matched; output-sha256=c8ef778b62af504a05b773f638f8f5573dfabd870a1167d8134e34dc7d7390a7; output-bytes=594; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G18: the app's explorer links resolve on MST Testnet's Blockscout: a real transaction's /tx/ page and a real contract's /address/ page are titled for that object, the explorer API finds the real transaction, and a random hash is reported as not found
  CHECK: node scripts/check-explorer.mjs
  EXPECT: EXPLORER LINKS VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=d0023a93fbc448060e1ef7ddb64f34e2d596457e84ecdab4a262a26f5a13eb69; exit=0; EXPECT=matched; output-sha256=0a22dc29e75b307206f94d53915fe1e6c081976f4ac7237f6e1ab0c51c5248fb; output-bytes=580; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G19: a backup of the data directory restores to byte-identical database rows and uploaded files, and a tampered backup is refused on restore
  CHECK: node scripts/check-backup.mjs
  EXPECT: BACKUP RESTORE VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=7abdc8cf45dec60ab33448ab9609a7e3c886a0113e4c1a1f4f502adb21a43bca; exit=0; EXPECT=matched; output-sha256=e05157723e01e1a1f149b317cb3505366e46058aab5797380075676ca1e73a85; output-bytes=741; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G20: in a room with a moderator panel, the contract only settles with a quorum of distinct panel signatures over the exact awards (missing, foreign, duplicate and mismatched signatures all revert)
  CHECK: node scripts/check-contracts.mjs
  EXPECT: /panel quorum enforced[\s\S]*CONTRACT SUITE VERIFIED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=923a6ff21ac376ce7ebf22b3bdd83e0e8442fbba01d5150828bf33fe65a7d922; exit=0; EXPECT=matched; output-sha256=e7cb73e7a43988f05c46e269be07419aa155eeb7299dc806fd912796005782de; output-bytes=2071; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G21: through the app, a panel room's settlement is refused until a panelist approves the frozen record in their wallet, and then settles on-chain with the collected signature
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /settlement refused without panel approval[\s\S]*panelist approval collected[\s\S]*panel room settled with the panel signature[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=2ae07c965dadc9a3b75f263e3b688c61177f6e51ef4740474b920c24581d77a4; exit=0; EXPECT=matched; output-sha256=0f4edeba883fcf78c134f8e8c3d4d6bfb0cf3b95abe4f782fec6e806b20a0ba4; output-bytes=5829; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G22: the in-app deployment check accepts a genuine ReleaseBond deployment despite its EIP-712 immutables, and rejects a contract with foreign bytecode
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /genuine deployment accepted despite immutables[\s\S]*foreign bytecode rejected[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=ac58d7508c1614bc5ce65ad8cdb844b19eb7c8a1921fdb13c31505260a84bb4e; exit=0; EXPECT=matched; output-sha256=0f4edeba883fcf78c134f8e8c3d4d6bfb0cf3b95abe4f782fec6e806b20a0ba4; output-bytes=5829; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G23: a package's release security history (page and JSON API for CI) lists every reviewed version with its phase, pool and accepted findings by severity, and never presents a review as a safety guarantee
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /package history lists the reviewed release with its accepted findings[\s\S]*package history API is decision support, not a safety verdict[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=8dbcc028e841ea8a42580a04e4573bf631d9d3373809213e0e071c6a5880047d; exit=0; EXPECT=matched; output-sha256=0f4edeba883fcf78c134f8e8c3d4d6bfb0cf3b95abe4f782fec6e806b20a0ba4; output-bytes=5829; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G24: a developer's profile shows their review track record (releases reviewed, pools funded, accepted findings by severity) measured from indexed rooms
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /developer track record shows funded pools and accepted findings[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=b1df3d0fe2eb4af1973f82210e1a5cad9858bad9240cf6e72c4e967661d68c80; exit=0; EXPECT=matched; output-sha256=0f4edeba883fcf78c134f8e8c3d4d6bfb0cf3b95abe4f782fec6e806b20a0ba4; output-bytes=5829; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G25: the Blockscout verification payload for ReleaseBond recompiles (offline, with the pinned solc) to exactly the compiled creation and runtime bytecode, and a corrupted payload does not
  CHECK: node scripts/check-verify-payload.mjs
  EXPECT: VERIFY PAYLOAD REPRODUCES BYTECODE
  EVIDENCE: automatic-evidence=v1; definition-sha256=2b66b8c7e8d06c0200064b3961b87cfc7c3e08ae7acb260e5421dec22e07e0ec; exit=0; EXPECT=matched; output-sha256=2ca603e6e368addd919607107abcfab628a968e6aaa631cc0bd17b91dab50ac3; output-bytes=256; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G26: a moderator's queue lists what needs them: pending verdicts in their review-phase rooms, open appeals they may decide, panel settlements awaiting their signature, and each room's adjudication deadline
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /moderator queue lists pending verdicts[\s\S]*appeals moderator sees the open appeal in their queue[\s\S]*panelist sees the settlement awaiting their signature[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=e51ce1ca842b877144caf8e390837587163177bb0c7abaff06a78ce1bc4b3845; exit=0; EXPECT=matched; output-sha256=0f4edeba883fcf78c134f8e8c3d4d6bfb0cf3b95abe4f782fec6e806b20a0ba4; output-bytes=5829; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G27: a moderator's public track record (rooms moderated and settled, verdict counts, verdicts overturned on appeal, missed deadlines) is measured from indexed data
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /moderator track record counts rooms, verdicts and appeal outcomes[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=088ff603b9b4c11c2d0feebfb3a48208554eb36c40c8b79c3e17b90f15ca428a; exit=0; EXPECT=matched; output-sha256=0f4edeba883fcf78c134f8e8c3d4d6bfb0cf3b95abe4f782fec6e806b20a0ba4; output-bytes=5829; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G28: researcher reputation counts findings overturned on appeal, and each finding reports its unresolved objections (refutations not withdrawn)
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /unresolved objections counted on the finding[\s\S]*reputation counts findings overturned on appeal[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=23efdb525f5926d1e442ecd0a999f6db5b33a673db9071e2b988db6f43026eb6; exit=0; EXPECT=matched; output-sha256=0f4edeba883fcf78c134f8e8c3d4d6bfb0cf3b95abe4f782fec6e806b20a0ba4; output-bytes=5829; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G29: /api/health reports database, chain id, contract, indexer lag and evidence queue depth, returning 503 when the RPC is unreachable or on the wrong chain (unit tested evaluator plus a live 200 against the local chain)
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /health endpoint reports ready against the local chain[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=00bc3f87bfd00448ec17b1a51eea22adc25eea9c2721541fa4f02eaa9a64cbec; exit=0; EXPECT=matched; output-sha256=0f4edeba883fcf78c134f8e8c3d4d6bfb0cf3b95abe4f782fec6e806b20a0ba4; output-bytes=5829; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G30: the health evaluator is unit tested for healthy, wrong-chain, unreachable-RPC, missing-contract and lagging-indexer cases
  CHECK: node scripts/check-web-unit.mjs
  EXPECT: WEB UNIT VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5234dd54e2c379e3ba36b330c9774284b0418d8dad262b963ed6ad9159c430f3; exit=0; EXPECT=matched; output-sha256=064270929b09bd0717a1bd90f5bef6dfd94fa0203ade46310d3b282aa2b5809c; output-bytes=594; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G31: the hero demo runs end to end through the real UI in Chromium (fund, commit, respond, reveal, reproduce, refute, adjudicate, settle, withdraw) and every page is free of console errors, mobile horizontal overflow and colour-contrast violations in light and dark themes on desktop and mobile
  CHECK: node scripts/check-ui.mjs
  EXPECT: /UI TOUR PASSED: flow complete; (1\d|[2-9]\d) pages x 4 variants; 0 console errors; 0 overflow; 0 contrast violations/
  EVIDENCE: automatic-evidence=v1; definition-sha256=e247a05bf68a1a711731e77ad3c1207a328289e79225daf7c5eeb3c2390f3004; exit=0; EXPECT=matched; output-sha256=b973c8eb5564a3c84023b0829eb599ff9f969e9017ecdb64bf0053f763207da5; output-bytes=511; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G32: the real BridgeKey extension (downloaded from the Chrome Web Store) connects, signs in, deploys ReleaseBond from /admin, follows account switches, funds a room and commits a finding through its own approval popups (needs internet, unzip and openssl)
  CHECK: node scripts/check-ui.mjs --tour scripts/bridgekey-tour.mjs
  EXPECT: /BRIDGEKEY TOUR PASSED: BridgeKey [\d.]+; connect, sign-in, admin deploy, account switch, fund, commit/
  EVIDENCE: automatic-evidence=v1; definition-sha256=2b321784b75fe3afce0506e04c469b647d6d82bd1b62e9d9285734af8dc792ca; exit=0; EXPECT=matched; output-sha256=3f40854a70effab45220b11ab14be8596286d7fb34cd7931b6b20b5d6156361d; output-bytes=688; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries
