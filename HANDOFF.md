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
7. **Governance**: one moderator per room, chosen by the developer from the on-chain registry. **Appeals exist:** the author or developer can appeal a verdict once, a *different* registered moderator decides, settlement is blocked while an appeal is open, and the decision is part of the hashed adjudication record. Multi-moderator panels for high-value rooms are still open (spec §20, §33).
8. **Hardening before a public deployment**: rate limits on every write endpoint (`web/src/lib/server/rateLimit.ts`: per wallet, plus per IP behind `RELEASEBOND_TRUST_PROXY=1`, `429` + `Retry-After`) and a per-wallet upload quota are **done**. The limiter is in-memory, so move it to Redis if you run several instances. Still needed: a persistent `SESSION_SECRET` and backups of `web/data/`. **Reports and threads exist only in that SQLite file plus uploads.** The chain holds only their hashes. Consider encrypted report storage (e.g. IPFS with keys released at disclosure).
9. The researcher's reveal **nonce is stored server-side** (plus a localStorage backup in the browser), trading some trust for recoverability. The alternative is client-only storage with an export or backup UX.
10. Explorer link formats (`/tx/`, `/address/` on testnet.mstscan.com) are assumed; confirm them.

## Traps already found (don't repeat them)

- **viem caches `getBlockNumber` for ~4 s.** The indexer read a stale head and silently skipped new blocks. The server client now uses `cacheTime: 0` (`web/src/lib/server/config.ts`). `syncChain({force:true})` also waits for any in-flight pass, and `syncAfterTx` loops until the receipt's block is indexed.
- **Solidity "stack too deep"** in `finalizeSettlement`: it is split into `_validateAwards`, `_pay*` and `_recordRejected`. Don't just flip `viaIR` without re-running the tests and the MST gas estimate.
- **Sandbox runs as an unprivileged user.** It works in `/home/sandbox/work`, not `/work`. `--cap-add SYS_PTRACE` is required for strace.
- **Sensitive-path rules must match path segments** such as `path.join(os.homedir(), ".ssh", …)`, not just the literal `"/.ssh/"`.
- **Install hooks must be observed dynamically.** If a hook only appears as a static fact, claim checks go "inconclusive" once the sandbox runs. Code-only properties (obfuscation, eval, setuid) are confirmed statically on purpose (`STATIC_NATURE` in `claims.ts`).
- `vitest.config.mts` must stay ESM, and `server-only` is aliased to a stub for tests.
- Don't `pkill -f "<pattern>"` when your own shell command line contains that pattern; it kills the shell.
- `next start` sets NODE_ENV=production, which makes cookies `Secure`. Use HTTPS, or set `RELEASEBOND_INSECURE_COOKIES=1` for plain-http testing.

## Conventions

- Commits are small and topical. The owner asked for **no AI co-author trailers** in commit messages.
- Anything run in the browser must go through `sendTx` in `WalletProvider`: it switches the chain, waits for the receipt, then POSTs `/api/chain/sync {txHash}` so the server indexes from the receipt rather than trusting the client.
- The server never trusts client-computed hashes blindly. It recomputes the finding hash and commitment and rejects mismatches.
