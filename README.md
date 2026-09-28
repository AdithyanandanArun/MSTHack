# ReleaseBond

> **Put a bounty on your release. Let verified researchers try to break it before users have to trust it.**

ReleaseBond turns one exact software release (npm or pacman) into a funded, time-boxed security competition on the **MST blockchain**:

**Fund → Hunt → Commit → Reveal → Reproduce/Refute → Adjudicate → Pay → Patch → Repeat**

- A developer locks MSTC in the `ReleaseBond` contract against the **SHA-256 of the exact artifact**.
- Researchers hunt privately. Only `keccak256(roomId, artifactHash, reportHash, researcher, nonce)` goes on-chain, so they get timestamped priority without publishing a zero-day.
- After the hunt, the developer and moderator see the reports first (private disclosure). Then each finding becomes a **GitHub-issue-style thread** where peers post typed responses: `REPRODUCED`, `REFUTED`, `ADDITIONAL EVIDENCE`, `DUPLICATE`, `SEVERITY CHALLENGE` and so on. Researchers can attach proof files and evidence runs.
- A hybrid **Agent + Rule evidence engine** re-verifies the artifact hash, runs deterministic static rules and repeated no-network Docker sandbox runs, and has an agent (Claude, or a heuristic fallback) challenge the claim. The agent can never mark anything valid.
- The room's moderator records public verdicts. The server freezes a canonical adjudication record, and the moderator signs `finalizeSettlement` with that record's hash. The **contract** enforces the payout rules: only revealed commitments can win discovery awards, review awards are capped, and any remainder goes back to the developer.
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

Deploying the contract costs about 3.2M gas (≈0.0033 MSTC). `node scripts/check-mst-testnet.mjs` proves the compiled bytecode is accepted by the live chain.

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
Use `npm run advance-time -- 600` to move a room from hunting to disclosure to review.

### B. MST Testnet with Bridgekey

1. Install Bridgekey, create a wallet, select **MST Testnet**, and claim MSTC from the faucet. Create **at least three accounts** (owner/moderator, developer, researcher), because the contract rejects conflicts of interest.
2. `cd web && cp .env.example .env.local` (the defaults target MST Testnet), then `npm run build && npm start`. You can also use `npm run dev`.
3. Open `/admin`, connect Bridgekey, sign in, and click **Deploy ReleaseBond from my wallet**. The server reads the receipt, checks that the runtime bytecode matches this build, and stores the address. Add more moderators on the same page.

   *Alternative:* put `PRIVATE_KEY=` in `contracts/.env`, run `npm run deploy:mst`, then restart the web app (it picks up `contracts/deployments/mstTestnet.json`).

## Hero demo script (about 5 minutes, local or MST)

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
| G1 | `scripts/check-contracts.mjs` | 21 contract tests: escrow, commit/reveal, settlement caps, refunds, access control |
| G2 | `scripts/check-mst-testnet.mjs` | live MST Testnet accepts the bytecode (chain ID and deploy gas estimate) |
| G3 | `scripts/check-web-unit.mjs` | 38 unit tests: Solidity hash parity, rule positive/negative controls, sandbox parser, visibility, payout |
| G4 | `scripts/check-web-build.mjs` | typecheck + lint (0 warnings) + production build |
| G5 | `scripts/check-e2e.mjs` | 68-check lifecycle (including rate limits and upload quota) on a fresh chain through the real HTTP API and production server |
| G6 | `scripts/check-sandbox.mjs` | Docker sandbox sees key read, egress, secret env and install hook, and stays silent on the benign control |
| G7 | `scripts/check-pacman.mjs` | real Arch package fetched, checksum-verified against the repo DB, normalized |
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

## Trust model (what is and is not on-chain)

- **On-chain:** escrow, artifact hash, phase timing, commitments and reveals, settlement rules (discovery-only for revealed commitments, review ≤ 30% of bounty and ≤ discovery total, total ≤ bounty, remainder refunded), pull-payment withdrawals, reputation counters, the adjudication record hash, and refund paths (no commitments; moderator missed the deadline).
- **Off-chain, accountable:** report contents (private until disclosure), threads, the evidence engine, and moderator reasoning. The report hash and adjudication hash let anyone check the server did not alter what was committed.
- **Votes never decide validity, severity or payout.** A completed review is evidence, not a claim that a release is safe.

## Configuration

See [`web/.env.example`](web/.env.example). Key variables: `RELEASEBOND_CHAIN`, `RELEASEBOND_RATE_LIMIT_SCALE` / `RELEASEBOND_TRUST_PROXY` / `RELEASEBOND_UPLOAD_QUOTA_BYTES` (abuse limits), `RELEASEBOND_CONTRACT_ADDRESS` + `RELEASEBOND_DEPLOY_BLOCK`, `RELEASEBOND_SANDBOX=docker`, `ANTHROPIC_API_KEY` (enables the Claude agent; model via `AGENT_MODEL`), `SESSION_SECRET`.
