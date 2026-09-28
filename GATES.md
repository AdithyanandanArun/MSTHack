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
  EVIDENCE: automatic-evidence=v1; definition-sha256=c74f877f8259cddf7c94f37fe6d8c87708f84b191b3945b3ada294445914e4dc; exit=0; EXPECT=matched; output-sha256=27597ec3515e58b53dd126f365c8a081b9670b8cba911024468402b40e1828d5; output-bytes=2071; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G2: the compiled bytecode is accepted by the live MST Testnet EVM (chain id and deploy gas estimate measured over RPC)
  CHECK: node scripts/check-mst-testnet.mjs
  EXPECT: MST TESTNET DEPLOY ESTIMATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=dabb90616a1312e85cdbf64938eb08136e1ee7adf010cd28f2a8afd40474d317; exit=0; EXPECT=matched; output-sha256=4762eb4b0fb9b6c77b385df0f25d8d40e3dc28eb98f062d13fa2eb53c80fb629; output-bytes=109; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G3: web unit tests pass (commitment hash parity with Solidity, evidence rules detect the malicious fixture and stay silent on the benign control)
  CHECK: node scripts/check-web-unit.mjs
  EXPECT: WEB UNIT VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5234dd54e2c379e3ba36b330c9774284b0418d8dad262b963ed6ad9159c430f3; exit=0; EXPECT=matched; output-sha256=bfb82c9bed2a9e3b23e268f343a8748ed83c402678fca090b75e696ba38f0678; output-bytes=555; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G4: the web app typechecks and produces a production build
  CHECK: node scripts/check-web-build.mjs
  EXPECT: WEB BUILD VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=27c11e690719a95f6fa8db1581eb15bf1add792ad831d73b3d7ef46dba42bc1c; exit=0; EXPECT=matched; output-sha256=d9c4be93df76df87556c36d2f7eaae8470fbf14d3a7d8a729fb5b84ab8811378; output-bytes=167; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G5: a full lifecycle runs end to end against a local chain through the real HTTP API (fund, commit, reveal, review thread, reproduction, adjudication, on-chain settlement, withdrawal balances)
  CHECK: node scripts/check-e2e.mjs
  EXPECT: E2E LIFECYCLE PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=e6d0cc70d967b6f85a6e6cb2cfecf5cd0aee81e365087790d0c2cf2d713181af; exit=0; EXPECT=matched; output-sha256=1812d4bbce1f3aa2baac9ce15cbf79b1604ce7fc0b46373adda2128470801183; output-bytes=4914; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G6: the Docker sandbox records install-time telemetry (sensitive file read and outbound connection attempt) for the demo package
  CHECK: node scripts/check-sandbox.mjs
  EXPECT: SANDBOX TELEMETRY VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=16036077e7c67898ef227c82fb6c3970bda19d5df134f952dc221dec9c621e2e; exit=0; EXPECT=matched; output-sha256=406e9d85c1efea26a1a8dc6953ed404792ab8ed066b45a10c68b77f14ccfc8f2; output-bytes=561; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G7: the pacman adapter downloads a real Arch package, verifies its hash and normalizes it into a ReleaseArtifact
  CHECK: node scripts/check-pacman.mjs
  EXPECT: PACMAN ADAPTER VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=efa97e4e52ba5a38516418a8f1f9346854b23cadcc12955e326f946ff3d1777e; exit=0; EXPECT=matched; output-sha256=173194b171d12ad979dfbc8fb2a8ea7e019d8ad5945871b8852fd78ad11105db; output-bytes=602; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [ ] G8: history has several granular commits, none carrying a Claude co-author trailer, and origin/main equals local HEAD with a clean tree and handoff docs present
  CHECK: node scripts/check-repo.mjs
  EXPECT: REPO STATE VERIFIED
  EVIDENCE: pending

- [ ] G9: the ReleaseBond contract is deployed on MST Testnet from the owner's Bridgekey wallet and the app is configured with its address
  EVIDENCE: pending

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
  EVIDENCE: automatic-evidence=v1; definition-sha256=bbe8bf1ad47ecdc97c5ef18ec91ae534a493af913e3a9d331ee8ce4e1e87b4f0; exit=0; EXPECT=matched; output-sha256=1812d4bbce1f3aa2baac9ce15cbf79b1604ce7fc0b46373adda2128470801183; output-bytes=4914; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G14: the limiter's window, per-key isolation and reset behaviour are unit tested
  CHECK: node scripts/check-web-unit.mjs
  EXPECT: WEB UNIT VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5234dd54e2c379e3ba36b330c9774284b0418d8dad262b963ed6ad9159c430f3; exit=0; EXPECT=matched; output-sha256=6c165abf06a55c2ef48f075fb7fadb3efbe331de84f58017023a282d3a843635; output-bytes=555; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G15: a room can require verified researchers: an unverified wallet's report is refused, a moderator-verified wallet's report is accepted, and the requirement is mirrored from the room draft
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /unverified researcher refused in a verified-only room[\s\S]*verified researcher accepted[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=031c4c84f39d906a42cf38e281db3d70d09a91f7a5141c992e5d841065a15c45; exit=0; EXPECT=matched; output-sha256=1812d4bbce1f3aa2baac9ce15cbf79b1604ce7fc0b46373adda2128470801183; output-bytes=4914; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G16: a verdict can be appealed once by the author or developer, only a different moderator can decide it, settlement is refused while it is open, and the decision is part of the published adjudication record
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /appeal filed by the author[\s\S]*room moderator cannot decide an appeal[\s\S]*settlement blocked while an appeal is open[\s\S]*appeal decided by a second moderator[\s\S]*appeal recorded in the adjudication record[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=7a649da4fe631e67e48c96709b82070cbacf1f88867de4199fa8b27f49385ea3; exit=0; EXPECT=matched; output-sha256=1812d4bbce1f3aa2baac9ce15cbf79b1604ce7fc0b46373adda2128470801183; output-bytes=4914; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G17: appeal eligibility rules are unit tested (who may appeal, who may decide, when)
  CHECK: node scripts/check-web-unit.mjs
  EXPECT: WEB UNIT VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5234dd54e2c379e3ba36b330c9774284b0418d8dad262b963ed6ad9159c430f3; exit=0; EXPECT=matched; output-sha256=0e190c6ad0ca2090c937ad902016e89043722865a87e0bc677fecce84a438df8; output-bytes=555; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G18: the app's explorer links resolve on MST Testnet's Blockscout: a real transaction's /tx/ page and a real contract's /address/ page are titled for that object, the explorer API finds the real transaction, and a random hash is reported as not found
  CHECK: node scripts/check-explorer.mjs
  EXPECT: EXPLORER LINKS VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=d0023a93fbc448060e1ef7ddb64f34e2d596457e84ecdab4a262a26f5a13eb69; exit=0; EXPECT=matched; output-sha256=72ec8606f5a8b5f6cd4471c53d381dc1ad0e6c34a078fe108beafef9172de1c6; output-bytes=580; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G19: a backup of the data directory restores to byte-identical database rows and uploaded files, and a tampered backup is refused on restore
  CHECK: node scripts/check-backup.mjs
  EXPECT: BACKUP RESTORE VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=7abdc8cf45dec60ab33448ab9609a7e3c886a0113e4c1a1f4f502adb21a43bca; exit=0; EXPECT=matched; output-sha256=b9b0679eba7b8ccd7aed12720fe1ed65be5867df2cb2dba8ad43db4ece73c53f; output-bytes=741; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G20: in a room with a moderator panel, the contract only settles with a quorum of distinct panel signatures over the exact awards (missing, foreign, duplicate and mismatched signatures all revert)
  CHECK: node scripts/check-contracts.mjs
  EXPECT: /panel quorum enforced[\s\S]*CONTRACT SUITE VERIFIED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=923a6ff21ac376ce7ebf22b3bdd83e0e8442fbba01d5150828bf33fe65a7d922; exit=0; EXPECT=matched; output-sha256=b6a94d19e45f9ac7744719b6c5b531797e78159f31bf7cc332f93b911b165c60; output-bytes=2071; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G21: through the app, a panel room's settlement is refused until a panelist approves the frozen record in their wallet, and then settles on-chain with the collected signature
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /settlement refused without panel approval[\s\S]*panelist approval collected[\s\S]*panel room settled with the panel signature[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=2ae07c965dadc9a3b75f263e3b688c61177f6e51ef4740474b920c24581d77a4; exit=0; EXPECT=matched; output-sha256=1812d4bbce1f3aa2baac9ce15cbf79b1604ce7fc0b46373adda2128470801183; output-bytes=4914; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G22: the in-app deployment check accepts a genuine ReleaseBond deployment despite its EIP-712 immutables, and rejects a contract with foreign bytecode
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /genuine deployment accepted despite immutables[\s\S]*foreign bytecode rejected[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: automatic-evidence=v1; definition-sha256=ac58d7508c1614bc5ce65ad8cdb844b19eb7c8a1921fdb13c31505260a84bb4e; exit=0; EXPECT=matched; output-sha256=1812d4bbce1f3aa2baac9ce15cbf79b1604ce7fc0b46373adda2128470801183; output-bytes=4914; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [ ] G23: a package's release security history (page and JSON API for CI) lists every reviewed version with its phase, pool and accepted findings by severity, and never presents a review as a safety guarantee
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /package history lists the reviewed release with its accepted findings[\s\S]*package history API is decision support, not a safety verdict[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: pending

- [ ] G24: a developer's profile shows their review track record (releases reviewed, pools funded, accepted findings by severity) measured from indexed rooms
  CHECK: node scripts/check-e2e.mjs
  EXPECT: /developer track record shows funded pools and accepted findings[\s\S]*E2E LIFECYCLE PASSED/
  EVIDENCE: pending

- [ ] G25: the Blockscout verification payload for ReleaseBond recompiles (offline, with the pinned solc) to exactly the compiled creation and runtime bytecode, and a corrupted payload does not
  CHECK: node scripts/check-verify-payload.mjs
  EXPECT: VERIFY PAYLOAD REPRODUCES BYTECODE
  EVIDENCE: pending
