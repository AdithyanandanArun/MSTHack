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
  EVIDENCE: automatic-evidence=v1; definition-sha256=c74f877f8259cddf7c94f37fe6d8c87708f84b191b3945b3ada294445914e4dc; exit=0; EXPECT=matched; output-sha256=198bb4715b369c1678388a457ae3cedb898254d933ad6286261995e35b44718e; output-bytes=1758; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G2: the compiled bytecode is accepted by the live MST Testnet EVM (chain id and deploy gas estimate measured over RPC)
  CHECK: node scripts/check-mst-testnet.mjs
  EXPECT: MST TESTNET DEPLOY ESTIMATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=dabb90616a1312e85cdbf64938eb08136e1ee7adf010cd28f2a8afd40474d317; exit=0; EXPECT=matched; output-sha256=291d5f9f42624ef0fea5b2c65776f911b80022bef8535dcae39dfde051d1f180; output-bytes=109; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G3: web unit tests pass (commitment hash parity with Solidity, evidence rules detect the malicious fixture and stay silent on the benign control)
  CHECK: node scripts/check-web-unit.mjs
  EXPECT: WEB UNIT VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5234dd54e2c379e3ba36b330c9774284b0418d8dad262b963ed6ad9159c430f3; exit=0; EXPECT=matched; output-sha256=0f4f520b09e4e82cdadab8cea110a447397223f1c55c14a32fc7222ddcd5d3ff; output-bytes=515; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G4: the web app typechecks and produces a production build
  CHECK: node scripts/check-web-build.mjs
  EXPECT: WEB BUILD VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=27c11e690719a95f6fa8db1581eb15bf1add792ad831d73b3d7ef46dba42bc1c; exit=0; EXPECT=matched; output-sha256=d40e9d18366e717985f68a0b25965d533bc3989a6a3752a65261e21ba68978ab; output-bytes=167; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G5: a full lifecycle runs end to end against a local chain through the real HTTP API (fund, commit, reveal, review thread, reproduction, adjudication, on-chain settlement, withdrawal balances)
  CHECK: node scripts/check-e2e.mjs
  EXPECT: E2E LIFECYCLE PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=e6d0cc70d967b6f85a6e6cb2cfecf5cd0aee81e365087790d0c2cf2d713181af; exit=0; EXPECT=matched; output-sha256=1cb502b97dde1f75ee217a9f939a9b1bce36111db32b02741da6090c6a2fca29; output-bytes=3599; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

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
  EVIDENCE: automatic-evidence=v1; definition-sha256=bbe8bf1ad47ecdc97c5ef18ec91ae534a493af913e3a9d331ee8ce4e1e87b4f0; exit=0; EXPECT=matched; output-sha256=1cb502b97dde1f75ee217a9f939a9b1bce36111db32b02741da6090c6a2fca29; output-bytes=3599; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries

- [x] G14: the limiter's window, per-key isolation and reset behaviour are unit tested
  CHECK: node scripts/check-web-unit.mjs
  EXPECT: WEB UNIT VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5234dd54e2c379e3ba36b330c9774284b0418d8dad262b963ed6ad9159c430f3; exit=0; EXPECT=matched; output-sha256=a74d1dcba278f120fa48c27c44d8dee013f295434cd531d9ab00bf9b3acb36ab; output-bytes=515; shell=/bin/sh; cwd=/home/adithyan/Documents/MSTHack; path=635bb48c0f05/9 entries
