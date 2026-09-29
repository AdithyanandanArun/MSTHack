# ReleaseBond

> **Put a bounty on your release. Let verified researchers try to break it before users have to trust it.**

ReleaseBond turns one exact software release (npm or pacman) into a funded, time-boxed security competition on the **MST blockchain**:

**Fund → Hunt → Commit → Reveal → Reproduce/Refute → Adjudicate → Pay → Patch → Repeat**

- A developer locks MSTC in the `ReleaseBond` contract against the **SHA-256 of the exact artifact**.
- Researchers hunt privately. Only `keccak256(roomId, artifactHash, reportHash, researcher, nonce)` goes on-chain, so they get timestamped priority without publishing a zero-day.
- After the hunt, the developer and moderator see the reports first (private disclosure). Then each finding becomes a **GitHub-issue-style thread** where peers post typed responses: `REPRODUCED`, `REFUTED`, `ADDITIONAL EVIDENCE`, `DUPLICATE`, `SEVERITY CHALLENGE` and so on. Researchers can attach proof files and evidence runs.
- A hybrid **Agent + Rule evidence engine** re-verifies the artifact hash, runs deterministic static rules and repeated no-network Docker sandbox runs, and has an agent (Claude, or a heuristic fallback) challenge the claim. The agent can never mark anything valid.
- The room's moderator records public verdicts. The server freezes a canonical adjudication record, and the moderator signs `finalizeSettlement` with that record's hash. The **contract** enforces the payout rules: only revealed commitments can win discovery awards, review awards are capped, and any remainder goes back to the developer.
- High-value rooms can name a **moderator panel**: settlement then needs EIP-712 signatures from a quorum of co-moderators over the exact awards, enforced by the contract. Verdicts can be **appealed** once to a different moderator, and rooms can accept **verified researchers only**.
- Every wallet accumulates on-chain reputation (`statsOf`): valid, duplicate, critical and high findings, review awards, rejected reports, and total earned.

The full product spec lives in [`ReleaseBond_Complete_Project_Idea_Agent_Rule_Engine.md`](ReleaseBond_Complete_Project_Idea_Agent_Rule_Engine.md).

---

## Repository layout

```
contracts/   Hardhat project: ReleaseBond.sol (escrow, commit/reveal, settlement, reputation) + 21 tests
web/         Next.js 15 app (UI + REST API + SQLite index + evidence engine)
  src/lib/canonical.ts        finding/commitment/adjudication hashing (shared browser <-> server)
  src/lib/phase.ts            phase + visibility + who-may-post rules (mirrors the contract)
  src/lib/payout.ts           suggested settlement (severity caps, duplicates, review pool)
  src/lib/evidence/           adapters (npm, pacman), static rules, sandbox, correlation, agent
  src/lib/server/             db, chain indexer, SIWE auth, findings/adjudication logic
  src/app/api/                REST API (see below)
  scripts/e2e.ts              full lifecycle test driven through HTTP with 6 wallets
demo/        harmless demo npm packages (+ packed .tgz): a "compromised" 2.0.0, clean 1.0.0, benign control
scripts/     gate checks, local demo launcher, time-travel helper
GATES.md     completion ledger (what is verified and how)
HANDOFF.md   notes for the next contributor/agent
```

## MST Testnet

| | |
|---|---|
| Network | MST Testnet |
| Chain ID | `91562037` |
| RPC | `https://testnetrpc.mstblockchain.com` |
| Explorer | `https://testnet.mstscan.com` |
| Gas | 1 gwei, base fee 0 (Cancun-capable Geth fork) |
| Faucet | https://faucet.masterstroke.academy (10 MSTC) |
| Wallet | [Bridgekey](https://chromewebstore.google.com/detail/bridgekey/bfjojdcfenehemjgjlepdjomkpginlkg) (EIP-6963 or `window.ethereum`) |

Deploying the contract costs about 4.3M gas (≈0.0043 MSTC). `node scripts/check-mst-testnet.mjs` proves the compiled bytecode is accepted by the live chain.

## Quick start

Requirements: Node 20+, npm, Docker (optional; used for the dynamic sandbox).

```bash
npm run setup                 # installs contracts/ and web/ dependencies
```

### A. Local demo (no wallet or faucet needed)

```bash
npm run dev:local             # Hardhat chain :8545 + ReleaseBond deploy + web on :3000
```

Open http://localhost:3000 and choose **Connect wallet → Dev #N**. The dev wallets are the well-known Hardhat keys and are only offered on the local chain:
`Dev #0` owner/moderator · `Dev #1` developer · `Dev #2–#4` researchers.
The local chain mines a block every second, so room phases follow the wall clock (a 3-minute hunt closes after 3 minutes and the page moves on by itself). Use `npm run advance-time -- 600` to skip ahead.

### B. MST Testnet with BridgeKey (the live demo)

1. **Wallet.** Install [BridgeKey](https://chromewebstore.google.com/detail/bridgekey/bfjojdcfenehemjgjlepdjomkpginlkg) and create a wallet. MST Testnet is built in (chain ID 91562037; the coin shows as tMSTC). Open the account menu and use **Add account** until you have five accounts: Account 1 = owner/moderator, Account 2 = developer, Accounts 3–5 = researchers A–C. Roles must be different wallets, because the contract rejects conflicts of interest.
2. **Funds.** Claim 10 MSTC for Account 1 at [faucet.masterstroke.academy](https://faucet.masterstroke.academy) (captcha). From Account 1, **Send** about 3 MSTC to the developer and 0.5 MSTC to each researcher. The deploy costs about 0.005 MSTC; a commit, reveal or withdrawal costs well under 0.001 MSTC.
3. **Start the app:** `npm run demo:mst`, then open http://localhost:3000. It builds when needed, keeps MST data in `web/data-mst`, and uses the Docker sandbox if Docker is running.
4. **Deploy once.** In BridgeKey select Account 1. In the app click **Sign in** (top right), choose **BridgeKey**, **Approve connection**, click **Sign in as 0x…**, **Approve**, and pick a display name. Then open **Admin**, click **Deploy ReleaseBond from my wallet** and **Confirm**. The server checks the deployed bytecode against this build and stores the address; Account 1 becomes the owner and first moderator. Only moderators see Admin afterwards.
5. **Switching roles.** Each wallet account is its own ReleaseBond account. Select another account in BridgeKey, then use the account menu's **Switch account** (or **Sign in**) and sign in as that account; the first time, approve the connection and pick a name. Tip: a separate Chrome profile per role (each with BridgeKey and the same recovery phrase imported) keeps every role signed in side by side.
6. *(Optional)* Publish the verified source with `npm --prefix contracts run verify:mst -- --address <deployed address> --owner <Account 1>`.

Things to know on MST (checked against the BridgeKey 0.2.5 extension itself):

- BridgeKey supports sign-in (`personal_sign`) and transactions, but **not EIP-712 signatures** (`eth_signTypedData_v4`). Moderator-panel approvals need EIP-712, so leave the **moderator panel** empty when every moderator uses BridgeKey (the form warns you).
- Phases follow real time: a 3-minute hunt closes after 3 minutes and open pages move on by themselves. `npm run advance-time` only works on the local chain, so fund the demo room about five minutes before you need it in peer review.
- BridgeKey only talks to HTTPS RPC endpoints (MST's is), which is why the local Hardhat chain is used with the built-in dev wallets instead.
- *Scripted alternative to step 4:* put `PRIVATE_KEY=` in `contracts/.env`, run `npm run deploy:mst`, and restart the app (it reads `contracts/deployments/mstTestnet.json`).

## Hero demo script (about 5 minutes, local or MST)

Local: pick **Dev #1** for the developer, **Dev #2–#4** for researchers A–C and **Dev #0** for the moderator from the wallet menu. MST: switch the matching BridgeKey account as in step 5 above.

1. **Developer** → *Fund a release* → *Upload artifact* → `demo/artifacts/releasebond-demo-telemetry-2.0.0.tgz`, with previous `…-1.0.0.tgz`. The app shows the hash, the diff (+`scripts/telemetry.js`, a new `postinstall`) and rule hits. Lock the bounty with a **3-minute hunt** and a **2-minute disclosure**.
2. **Researcher A** → *Submit private finding*: title, markdown report, PoC, proof file, and ticked observations (install script, sensitive read, network, secret env). The browser hashes the report and commits it on-chain. Others see only "Private finding (commitment 0x…)".
3. **Researcher B** commits an independent duplicate. **Researcher C** commits a bogus "persistence" claim.
4. After the hunt, the **developer** reads the reports and replies (`DEVELOPER_RESPONSE`). Researchers click **Reveal**.
5. In peer review, **B** clicks **Run reproduction**. Three fresh sandboxes record `open(~/.ssh/demo_key)`, `connect(203.0.113.10:443)` and a read of `AWS_SECRET_ACCESS_KEY`, and the agent correlates the key read with the request body. B posts `REPRODUCED` with the run attached. C posts a `REFUTED` reply, A answers it, and C withdraws.
6. **Moderator** marks A valid/high, B a duplicate of A and C invalid, ticks the material reviewers, then **freezes the record** and **signs `finalizeSettlement`**. The settlement tab recomputes the record hash in the browser and matches it against the chain.
7. Researchers **withdraw**, and profiles show on-chain reputation. For pacman, register `which` from the Arch repos to see the same pipeline (static rules, `.PKGINFO`/`.INSTALL` parsing, checksum verified against the repo database).

The demo package is harmless. It only reads a *demo* key file and targets `203.0.113.10`, an RFC 5737 documentation address that is never routed. The sandbox has no network anyway.

## Verification

```bash
npm run gates     # runs every automated gate below
```

| Gate | Check | What it proves |
|---|---|---|
| G1 | `scripts/check-contracts.mjs` | 25 contract tests: escrow, commit/reveal, settlement caps, refunds, access control, moderator panels |
| G2 | `scripts/check-mst-testnet.mjs` | live MST Testnet accepts the bytecode (chain ID and deploy gas estimate) |
| G3 | `scripts/check-web-unit.mjs` | 48 unit tests: Solidity hash parity, rule positive/negative controls, sandbox parser, visibility, payout |
| G4 | `scripts/check-web-build.mjs` | typecheck + lint (0 warnings) + production build |
| G5 | `scripts/check-e2e.mjs` | 107-check lifecycle (including verified-only rooms, appeals, moderator panels and queue, track records, health, in-app deploy verification, rate limits and upload quota) on a fresh chain through the real HTTP API and production server |
| G31 | `scripts/check-ui.mjs` | the hero demo clicked through a real browser with the dev wallets (fund, commit, respond, reveal, reproduce, refute, adjudicate, settle, withdraw), then every page audited in light/dark x desktop/mobile for console errors, horizontal overflow and colour contrast (screenshots in `web/.ui-tour/`) |
| G32 | `npm run check:bridgekey` | the real BridgeKey extension (downloaded from the Chrome Web Store) connects, signs in, deploys from `/admin`, follows account switches, funds a room and commits a finding through its approval popups; not part of `npm run gates` because it downloads a third-party extension |
| G6 | `scripts/check-sandbox.mjs` | Docker sandbox sees key read, egress, secret env and install hook, and stays silent on the benign control |
| G7 | `scripts/check-pacman.mjs` | real Arch package fetched, checksum-verified against the repo DB, normalized |
| G18 | `scripts/check-explorer.mjs` | explorer links resolve on MST Testnet's Blockscout (positive and negative control) |
| G19 | `scripts/check-backup.mjs` | backup restores byte-identical rows and files; tampered backup refused |
| G25 | `scripts/check-verify-payload.mjs` | Blockscout verification payload recompiles offline to the exact contract bytecode |
| G8 | `scripts/check-repo.mjs` | history, no co-author trailers, pushed and clean |

## REST API (selected)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/nonce`, `/api/auth/verify` | Sign-In with Ethereum (EIP-4361), HMAC session cookie |
| POST | `/api/artifacts` | JSON `{ecosystem,name,version}` fetches from the registry; multipart uploads an artifact (+previous) |
| POST | `/api/rooms/draft` | returns exact `createRoom` args for the wallet |
| POST | `/api/chain/sync` | `{txHash}`: the server reads the receipt and indexes events itself |
| GET | `/api/rooms/:id` | room, phase, public commitments, findings visible to the caller |
| POST | `/api/rooms/:id/findings` | private report; the server recomputes and must match the client's hash and commitment |
| GET | `/api/findings/:id` | report + thread (403 until the disclosure rules open it) |
| POST | `/api/findings/:id/comments` | typed responses; allowed kinds depend on phase and role |
| POST | `/api/findings/:id/reproduce` | queues an evidence run (rules + sandbox ×3 + agent); returns `202 {id}` |
| GET | `/api/evidence/:id` | run status (`queued`/`running`/`done`/`error`), queue position, report |
| POST | `/api/findings/:id/adjudicate` | room moderator only |
| GET/POST | `/api/rooms/:id/settlement` | preview / freeze the adjudication record and return `finalizeSettlement` args |
| POST | `/api/rooms/:id/scan` | queues a release triage (no researcher claim); returns `202 {id}` |
| POST | `/api/uploads` | proof files; their sha256 is bound into the report hash |
| GET | `/api/packages/:ecosystem/:name` | release security history of a package (JSON for CI/CD; never a safety verdict) |
| GET | `/api/developers/:address` | developer review track record |
| GET | `/api/moderators/:address` | moderator track record: rooms, verdicts issued, appeal outcomes, missed deadlines |
| GET | `/api/researchers/:address` | on-chain reputation plus findings overturned on appeal |
| GET | `/api/moderation/queue` | signed-in moderator's queue: pending verdicts, appeals to decide, panel approvals, deadlines |
| GET | `/api/health` | readiness: database, chain id, contract, indexer lag, evidence queue (503 when down) |

## Trust model (what is and is not on-chain)

- **On-chain:** escrow, artifact hash, phase timing, commitments and reveals, settlement rules (discovery-only for revealed commitments, review ≤ 30% of bounty and ≤ discovery total, total ≤ bounty, remainder refunded), pull-payment withdrawals, reputation counters, the adjudication record hash, and refund paths (no commitments; moderator missed the deadline).
- **Off-chain, accountable:** report contents (private until disclosure), threads, the evidence engine, and moderator reasoning. The report hash and adjudication hash let anyone check the server did not alter what was committed.
- **Votes never decide validity, severity or payout.** A completed review is evidence, not a claim that a release is safe.

## Configuration

See [`web/.env.example`](web/.env.example). Key variables: `RELEASEBOND_CHAIN`, `RELEASEBOND_RATE_LIMIT_SCALE` / `RELEASEBOND_TRUST_PROXY` / `RELEASEBOND_UPLOAD_QUOTA_BYTES` (abuse limits), `RELEASEBOND_CONTRACT_ADDRESS` + `RELEASEBOND_DEPLOY_BLOCK`, `RELEASEBOND_SANDBOX=docker`, `ANTHROPIC_API_KEY` (enables the Claude agent; model via `AGENT_MODEL`), `SESSION_SECRET`.

## Backups

Back up the default `web/data` directory with `npm run backup`; use `npm run backup -- --data /path/to/data --out /path/to/backups` for custom locations. Each timestamped backup contains an online SQLite snapshot, `session.secret`, release artifacts, proof uploads, and a SHA-256 manifest with database row counts.

Restore to an empty data directory with `npm run restore -- /path/to/releasebond-backup --data /path/to/data`. Add `--force` to replace a non-empty target. Restore verifies the complete manifest before writing and updates stored artifact and attachment paths when the target location differs from the original data directory.
