# Handoff: ReleaseBond (MST Blockchain Buildathon)

Read this first if you are picking the project up. `README.md` covers what the product is. This file covers the current state, what is left, and the traps already found.

## State at handoff

Everything in the MVP loop works end to end: **Fund → Hunt → Commit → Reveal → Reproduce/Refute → Adjudicate → Pay → Withdraw**. It is verified on a local chain through the real HTTP API and production server (`node scripts/check-e2e.mjs`, 61 checks).

Run `npm run gates` to re-verify everything. Expected: 8 × PASS. G5/G6 need Docker, and G2/G7 need internet.

| Gate (GATES.md) | Status |
|---|---|
| G0–G8 automated | passing at handoff (re-run `npm run gates`) |
| **G9: deploy to MST Testnet from the owner's Bridgekey wallet** | **NOT DONE — needs a human** (faucet captcha + wallet signature). See below. |

### Do this first: G9 (deploy on MST Testnet)

1. Install Bridgekey, create 3+ accounts, select MST Testnet, and claim MSTC for each at https://faucet.masterstroke.academy.
2. `cd web && cp .env.example .env.local && npm run build && npm start`, then open http://localhost:3000/admin.
3. Connect Bridgekey → sign in → **Deploy ReleaseBond from my wallet** (≈0.0033 MSTC). The server verifies the bytecode and stores the address in `web/data/releasebond.sqlite` (`settings` table, key `contract:91562037`).
4. For a shared or production deployment, also pin it in env: `RELEASEBOND_CONTRACT_ADDRESS=0x…` and `RELEASEBOND_DEPLOY_BLOCK=<block>`. Without the deploy block, the indexer would scan from genesis (about 5.8M blocks in 5k chunks).
5. Record the address and tx in GATES.md G9 `EVIDENCE:` and in the README.
6. Publish the verified source on the explorer: `npm --prefix contracts run verify:mst -- --address <address> --owner <owner>`. The payload is proven offline (G25) to recompile to the exact bytecode, and MST's Blockscout supports standard-input verification with solc `v0.8.28+commit.7893614a`. The real submission is untested until the contract is deployed.

**Untested with the real extension:** no browser was available in the build environment, so Bridgekey itself was never clicked through. The wallet code (`web/src/components/WalletProvider.tsx`) discovers wallets via **EIP-6963** and falls back to `window.ethereum`. If Bridgekey injects under another global, add it in the discovery `useEffect`. Chain switching uses `wallet_switchEthereumChain` and falls back to `wallet_addEthereumChain`.

## Where things live

- `contracts/contracts/ReleaseBond.sol`: the only contract (escrow, commit/reveal, settlement rules, refunds, reputation). Tests are in `contracts/test/`. After changing it, run `npm --prefix contracts run export` to regenerate `web/src/lib/chain/releaseBondArtifact.ts` (ABI, creation and runtime bytecode).
- `web/src/lib/canonical.ts`: **the hashing contract between browser, server and chain**. Changing it breaks reveal of existing commitments.
- `web/src/lib/phase.ts`: phases (mirroring `phaseOf` in Solidity), visibility, and which comment kinds each role may post in each phase.
- `web/src/lib/server/sync.ts`: event indexer. The chain is the source of truth for rooms, commitments, reveals, payouts and moderators.
- `web/src/lib/server/findings.ts`: finding creation (server recomputes hashes), threads, adjudication, settlement record freezing.
- `web/src/lib/evidence/`: `adapters/{npm,pacman}.ts` → `ReleaseArtifact`; `rules.ts` (static facts with file:line); `sandbox.ts` (Docker + strace + Node preload hook); `correlate.ts` (T_CORRELATE data-flow); `claims.ts` (claim → outcome); `agent.ts` (Claude tool loop + heuristic fallback, grounding checks).
- `web/src/lib/payout.ts`: suggested settlement. Parameters (severity caps, 50% duplicates, 10% review pool) are a recommendation; the spec lists the formula as an open decision.

## Known gaps / recommended next steps (in priority order)

> Dependency-tree execution in the npm sandbox (#4) and a pacman dynamic sandbox (#5) were scoped as GATES.md G10–G12 and then **abandoned without implementation**: testing them needed new fixture packages that imitate credential theft and persistence, and building those was stopped. The owner needs to decide on a test approach (for example, benign canary behaviour only) before anyone picks them up.


1. **G9 deployment + Bridgekey click-through** (above).
2. **Claude agent path not exercised by tests** (no API key in the build env). Set `ANTHROPIC_API_KEY` and run a reproduction. The default model is `claude-sonnet-5`, overridable with `AGENT_MODEL`. The heuristic analyst runs whenever no key is set, and it is labelled as such in the UI.
3. ~~Evidence runs are synchronous HTTP requests~~ **Done:** runs are queued in `web/src/lib/server/evidenceQueue.ts` (the `evidence_runs` table is the queue, with `RELEASEBOND_EVIDENCE_CONCURRENCY` runs at a time, default 2). The API returns `202 {id}`, clients poll `GET /api/evidence/:id`, and runs interrupted by a restart are marked as errors. It is still in-process, so for multi-instance deployments move it to a real worker (e.g. BullMQ or a separate process polling the same table).
4. **npm dependencies are not installed inside the sandbox** (it has no network by design). Only the package's own lifecycle hooks and `require()` run. Next step: pre-fetch the dependency tree into an offline cache that is mounted read-only.
5. **pacman dynamic sandbox**: pacman gets static analysis only (`.PKGINFO`, `.INSTALL` hooks, setuid bits, FHS locations). Next step: an `archlinux` container that sources `.INSTALL` and runs `post_install` under strace. Old `.pkg.tar.xz` archives are rejected (there is no pure-JS xz decoder wired in).
6. **Identity**: "verified human" is a moderator-granted badge (`/admin`). A room can now **require verified researchers** (checkbox when funding; enforced when reports are submitted; `rooms.require_verified`). The contract still accepts any commitment, but an unverified commitment has no report to review or pay. Which identity provider backs the badge is still an open decision (spec §8, §46).
7. **Governance**: one moderator per room, chosen by the developer from the on-chain registry. **Appeals exist:** the author or developer can appeal a verdict once, a *different* registered moderator decides, and settlement is blocked while an appeal is open. **Moderator panels exist** (contract-enforced): a room can name up to 5 co-moderators and a quorum, and `finalizeSettlement` then requires EIP-712 signatures from a quorum over the exact award arrays (`hashAwards`/`settlementDigest`), so the room moderator cannot change amounts after approval. Panelists approve from the settlement tab.
8. **Hardening**: done — per-wallet rate limits on every write endpoint (sign-in is limited per claimed wallet plus a high global nonce cap, never one shared bucket), per-wallet upload quota, and `npm run backup` / `npm run restore` (consistent SQLite snapshot plus files, sha256 manifest, verified staged restore that rewrites absolute paths). The session secret is already persistent (`data/session.secret`, mode 600, included in backups) unless you set `SESSION_SECRET`. The limiter is in-memory, so move it to Redis for several instances.
9. The researcher's reveal **nonce is stored server-side** (plus a localStorage backup in the browser), trading some trust for recoverability. The alternative is client-only storage with an export or backup UX.
10. Explorer links are verified: testnet.mstscan.com is Blockscout, and `/tx/<hash>` and `/address/<addr>` resolve (`scripts/check-explorer.mjs`). Blockscout also has a contract-verification API; publishing the ReleaseBond source there after G9 is a nice next step.

## Backend status (audited against the spec)

Every backend requirement in the spec is implemented and covered by gates, except the items that need an owner: G9 (deploy), G10–G12 (the npm dependency and pacman sandboxes, abandoned pending a test approach) and the Claude agent (needs an API key). The most recent additions are:
- **Moderation queue** (`/api/moderation/queue`, dashboard): pending verdicts, appeals this moderator may decide, panel settlements awaiting their signature, deadlines.
- **Moderator track record** (§33 "moderator histories"): `/api/moderators/:address` and the profile page. It counts the verdicts a moderator *issued*, even when an appeal later overturned them.
- **Findings overturned on appeal** (§26) and **unresolved objections** (§15). Appeals record the contested verdict at filing time.
- **`/api/health`** (built by Codex): 503 on DB failure, unreachable RPC or wrong chain; 200 "degraded" on a missing contract, indexer lag or queue backlog. Use it for uptime monitoring.

## Recently added (spec §25, §27, §43)

- **Release security history:** `/packages/<ecosystem>/<name>` plus `GET /api/packages/<ecosystem>/<name>` (JSON for CI/CD; scoped npm names work, e.g. `/api/packages/npm/@scope/pkg`). Each funded release shows its phase, pool and accepted findings by severity, plus a product-language summary (§45) and a disclaimer. It never says "safe".
- **Developer track record:** on `/researchers/<address>` and `GET /api/developers/<address>`: releases funded and reviewed, pools funded, accepted findings by severity, and how many releases with findings were followed by a newer reviewed release (a patch signal, not proof of a fix).

## Traps already found (don't repeat them)

- **viem caches `getBlockNumber` for ~4 s.** The indexer read a stale head and silently skipped new blocks. The server client now uses `cacheTime: 0` (`web/src/lib/server/config.ts`). `syncChain({force:true})` also waits for any in-flight pass, and `syncAfterTx` loops until the receipt's block is indexed.
- **Solidity "stack too deep"** in `finalizeSettlement`: it is split into `_validateAwards`, `_pay*` and `_recordRejected`. Don't just flip `viaIR` without re-running the tests and the MST gas estimate.
- **Sandbox runs as an unprivileged user.** It works in `/home/sandbox/work`, not `/work`. `--cap-add SYS_PTRACE` is required for strace.
- **Sensitive-path rules must match path segments** such as `path.join(os.homedir(), ".ssh", …)`, not just the literal `"/.ssh/"`.
- **Install hooks must be observed dynamically.** If a hook only appears as a static fact, claim checks go "inconclusive" once the sandbox runs. Code-only properties (obfuscation, eval, setuid) are confirmed statically on purpose (`STATIC_NATURE` in `claims.ts`).
- `vitest.config.mts` must stay ESM, and `server-only` is aliased to a stub for tests.
- Don't `pkill -f "<pattern>"` when your own shell command line contains that pattern; it kills the shell.
- `next start` sets NODE_ENV=production, which makes cookies `Secure`. Use HTTPS, or set `RELEASEBOND_INSECURE_COOKIES=1` for plain-http testing.

- **EIP-712 immutables change the runtime code at deploy time.** Deployed code never equals the compiled `deployedBytecode`. Compare with the immutable ranges masked (`contracts/scripts/immutables.js`, `web/src/lib/chain/runtimeCode.ts`; the ranges are exported by `npm --prefix contracts run export`). An exact comparison rejects every genuine deployment.
- A signed-out sign-in rate limit must never be one shared bucket, or one client can lock everyone out. Sign-in is limited per claimed wallet.

## Conventions

- Commits are small and topical. The owner asked for **no AI co-author trailers** in commit messages.
- Anything run in the browser must go through `sendTx` in `WalletProvider`: it switches the chain, waits for the receipt, then POSTs `/api/chain/sync {txHash}` so the server indexes from the receipt rather than trusting the client.
- The server never trusts client-computed hashes blindly. It recomputes the finding hash and commitment and rejects mismatches.
