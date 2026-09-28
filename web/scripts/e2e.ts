/**
 * End-to-end lifecycle against a real local chain and the production server.
 * Five wallets drive the whole protocol through the HTTP API exactly as the
 * browser does: SIWE sign-in, fund, commit, privacy checks, reveal, threaded
 * review, evidence runs, adjudication, on-chain settlement and withdrawal.
 *
 * Usage (normally via scripts/check-e2e.mjs):
 *   E2E_BASE=http://127.0.0.1:3107 E2E_RPC=http://127.0.0.1:8547 E2E_CONTRACT=0x.. npx tsx scripts/e2e.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { adjudicationHash, computeCommitment, findingHash, randomNonce, type FindingContent } from "../src/lib/canonical";
import { localHardhat } from "../src/lib/chain/chains";
import { releaseBondAbi } from "../src/lib/chain/releaseBondArtifact";

const BASE = process.env.E2E_BASE!;
const RPC = process.env.E2E_RPC!;
const CONTRACT = process.env.E2E_CONTRACT as Address;
const ARTIFACTS = path.resolve(__dirname, "../../demo/artifacts");

const KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
];

const chain = { ...localHardhat, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const test = createTestClient({ chain, mode: "hardhat", transport: http(RPC) });

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  checks++;
  console.log(`  ✓ ${msg}`);
}

class Actor {
  cookie = "";
  wallet;
  constructor(
    public name: string,
    public account: PrivateKeyAccount,
  ) {
    this.wallet = createWalletClient({ account, chain, transport: http(RPC) });
  }
  get address() {
    return this.account.address.toLowerCase();
  }
  async req<T = unknown>(method: string, p: string, body?: unknown, raw = false): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${BASE}${p}`, { method, headers, body: payload, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set?.startsWith("rb_session=")) this.cookie = set.split(";")[0];
    const text = await res.text();
    return { status: res.status, data: (raw ? text : text ? JSON.parse(text) : null) as T };
  }
  async ok<T = unknown>(method: string, p: string, body?: unknown): Promise<T> {
    const r = await this.req<T>(method, p, body);
    if (r.status >= 400) throw new Error(`${this.name} ${method} ${p} -> ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
  async signIn() {
    const { nonce } = await this.ok<{ nonce: string }>("POST", "/api/auth/nonce");
    const message = createSiweMessage({
      domain: new URL(BASE).host,
      address: this.account.address,
      statement: "Sign in to ReleaseBond.",
      uri: BASE,
      version: "1",
      chainId: chain.id,
      nonce,
      issuedAt: new Date(),
    });
    const signature = await this.account.signMessage({ message });
    await this.ok("POST", "/api/auth/verify", { message, signature });
  }
  async tx(fn: string, args: unknown[], value?: bigint): Promise<Hex> {
    const hash = await this.wallet.writeContract({
      address: CONTRACT,
      abi: releaseBondAbi,
      functionName: fn as never,
      args: args as never,
      value,
      account: this.account,
      chain,
    } as never);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${fn} reverted`);
    const synced = await this.ok("POST", "/api/chain/sync", { txHash: hash });
    if (process.env.E2E_DEBUG) console.log(`    [debug] ${fn} block ${receipt.blockNumber} sync ->`, JSON.stringify(synced));
    return hash;
  }
}

async function advance(seconds: number, anyone: Actor) {
  await test.increaseTime({ seconds });
  await test.mine({ blocks: 1 });
  await anyone.ok("POST", "/api/chain/sync", {});
}

function content(roomId: number, over: Partial<FindingContent>): FindingContent {
  return {
    roomId,
    title: "postinstall reads ~/.ssh keys and posts them to 203.0.113.10",
    claimedSeverity: "critical",
    description:
      "## Summary\n`scripts/telemetry.js` runs on install, reads `~/.ssh/demo_key` and `AWS_SECRET_ACCESS_KEY`, and POSTs them to a hard-coded IP.",
    proofOfConcept: "```\nnpm install releasebond-demo-telemetry@2.0.0\n```",
    reproduction: "1. Clean sandbox with a canary key\n2. npm install\n3. Observe open() of the key and connect() to 203.0.113.10:443",
    observations: ["INSTALL_SCRIPT", "FS_SENSITIVE_READ", "NETWORK_EGRESS", "ENV_SECRET_READ"],
    attachments: [],
    ...over,
  };
}

async function submitFinding(who: Actor, roomId: number, artifactHash: Hex, c: FindingContent, attachmentIds: number[] = []) {
  const nonce = randomNonce();
  const fh = findingHash(c);
  const commitment = computeCommitment({ roomId, artifactHash, findingHash: fh, researcher: who.account.address, nonce });
  const created = await who.ok<{ id: number; commitment: Hex }>("POST", `/api/rooms/${roomId}/findings`, {
    ...c,
    attachmentIds,
    nonce,
    findingHash: fh,
    commitment,
  });
  assert(created.commitment.toLowerCase() === commitment.toLowerCase(), `${who.name}: server agrees on the commitment`);
  await who.tx("commitFinding", [BigInt(roomId), commitment]);
  return { id: created.id, fh, nonce, commitment };
}

async function main() {
  const [owner, dev, alice, bob, carol, dave] = KEYS.map((k, i) => new Actor(["owner/moderator", "developer", "alice", "bob", "carol", "dave"][i], privateKeyToAccount(k)));
  console.log("• sign in all wallets with SIWE");
  for (const a of [owner, dev, alice, bob, carol, dave]) await a.signIn();
  const me = await alice.ok<{ address: string }>("GET", "/api/auth/me");
  assert(me.address === alice.address, "session cookie identifies the signed-in wallet");
  const forged = await new Actor("anon", alice.account).req("GET", "/api/auth/me");
  assert((forged.data as { address: string | null }).address === null, "no cookie, no session");

  console.log("• config and moderator registry are indexed from chain events");
  await owner.ok("POST", "/api/chain/sync", {});
  const cfg = await owner.ok<{ contractAddress: string; moderators: string[] }>("GET", "/api/config");
  assert(cfg.contractAddress.toLowerCase() === CONTRACT.toLowerCase(), "server uses the deployed contract");
  assert(cfg.moderators.includes(owner.address), "owner is a registered moderator");

  console.log("• developer registers the exact artifact (upload + previous version)");
  const form = new FormData();
  form.set("ecosystem", "npm");
  form.set("file", new Blob([fs.readFileSync(path.join(ARTIFACTS, "releasebond-demo-telemetry-2.0.0.tgz"))]), "pkg.tgz");
  form.set("previous", new Blob([fs.readFileSync(path.join(ARTIFACTS, "releasebond-demo-telemetry-1.0.0.tgz"))]), "prev.tgz");
  const art = await dev.ok<{ sha256: string; diff: { added: string[] }; scan: { observation: string | null }[] }>("POST", "/api/artifacts", form);
  assert(/^[0-9a-f]{64}$/.test(art.sha256), "artifact hashed");
  assert(art.diff.added.includes("scripts/telemetry.js"), "diff against 1.0.0 shows the new install script");
  assert(art.scan.some((f) => f.observation === "FS_SENSITIVE_READ"), "static scan flags the sensitive read");

  const unauth = await new Actor("anon", dev.account).req("POST", "/api/rooms/draft", { artifactSha256: art.sha256, moderator: owner.address });
  assert(unauth.status === 401, "room drafts require sign-in");
  const selfMod = await owner.req("POST", "/api/rooms/draft", { artifactSha256: art.sha256, moderator: owner.address });
  assert(selfMod.status === 400, "developer cannot pick themselves as moderator");

  const draft = await dev.ok<{ params: { ecosystem: string; packageName: string; version: string; artifactHash: Hex; previousArtifactHash: Hex; moderator: Address } }>(
    "POST",
    "/api/rooms/draft",
    { artifactSha256: art.sha256, title: "E2E demo room", description: "Break the **2.0.0** release.", moderator: owner.address },
  );
  const bounty = parseEther("100");
  const createHash = await dev.tx("createRoom", [{ ...draft.params, huntDuration: 600n, disclosureDuration: 120n, adjudicationWindow: 86400n }], bounty);
  const receipt = await pub.getTransactionReceipt({ hash: createHash });
  const roomId = Number(
    receipt.logs
      .map((l) => {
        try {
          return decodeEventLog({ abi: releaseBondAbi, data: l.data, topics: l.topics });
        } catch {
          return null;
        }
      })
      .find((e) => e?.eventName === "RoomCreated")!.args.roomId as bigint,
  );
  const room = await alice.ok<{ phase: string; room: { bounty_wei: string; title: string; artifact_hash: Hex } }>("GET", `/api/rooms/${roomId}`);
  assert(room.phase === "hunting", "room is hunting");
  assert(room.room.bounty_wei === bounty.toString(), "escrowed bounty mirrored from chain");
  assert(room.room.title === "E2E demo room", "off-chain room description linked by artifact hash");
  const artifactHash = room.room.artifact_hash;

  console.log("• researchers submit private findings with on-chain commitments");
  const upload = new FormData();
  upload.set("file", new Blob(["open('/home/sandbox/.ssh/demo_key')\nconnect(203.0.113.10:443)\n"]), "strace-excerpt.log");
  const att = await alice.ok<{ id: number; sha256: string }>("POST", "/api/uploads", upload);
  const aliceF = await submitFinding(alice, roomId, artifactHash, content(roomId, { attachments: [att.sha256] }), [att.id]);
  const bobF = await submitFinding(
    bob,
    roomId,
    artifactHash,
    content(roomId, { title: "Install hook exfiltrates AWS secret", claimedSeverity: "high", observations: ["INSTALL_SCRIPT", "ENV_SECRET_READ", "NETWORK_EGRESS"] }),
  );
  const carolF = await submitFinding(
    carol,
    roomId,
    artifactHash,
    content(roomId, { title: "Package installs a cron job for persistence", claimedSeverity: "critical", observations: ["PERSISTENCE"], description: "It writes to /etc/cron.d on install, trust me." }),
  );
  const devFinding = await dev.req("POST", `/api/rooms/${roomId}/findings`, { ...content(roomId, {}), nonce: randomNonce(), findingHash: `0x${"0".repeat(64)}`, commitment: `0x${"1".repeat(64)}` });
  assert(devFinding.status === 403, "developer cannot submit findings to their own room");
  const tampered = await dave.req("POST", `/api/rooms/${roomId}/findings`, { ...content(roomId, {}), nonce: randomNonce(), findingHash: aliceF.fh, commitment: aliceF.commitment });
  assert(tampered.status === 400, "server rejects a report whose hashes it cannot reproduce");

  const aliceView = await alice.ok<{ finding: { status: string; commitmentIndex: number; nonce: string } }>("GET", `/api/findings/${aliceF.id}`);
  assert(aliceView.finding.status === "committed" && aliceView.finding.commitmentIndex === 0, "commitment linked to alice's report");
  assert((await bob.req("GET", `/api/findings/${aliceF.id}`)).status === 403, "hunt: other researchers cannot read alice's report");
  assert((await dev.req("GET", `/api/findings/${aliceF.id}`)).status === 403, "hunt: developer cannot read it either");
  assert((await bob.req("GET", `/api/uploads/${att.id}`, undefined, true)).status === 403, "hunt: proof files are private too");
  const listAsBob = await bob.ok<{ findings: { visible: boolean; title: string | null }[]; commitments: unknown[] }>("GET", `/api/rooms/${roomId}`);
  assert(listAsBob.commitments.length === 3, "all three commitments are public");
  assert(listAsBob.findings.filter((f) => f.visible).length === 1 && listAsBob.findings.every((f) => f.visible || f.title === null), "titles of others' findings are hidden");
  const early = await alice.req("POST", `/api/findings/${aliceF.id}/comments`, { kind: "COMMENT", body: "hi" });
  assert(early.status === 403, "no discussion during the hunt");

  console.log("• hunt closes -> private disclosure");
  await advance(601, owner);
  assert((await alice.ok<{ phase: string }>("GET", `/api/rooms/${roomId}`)).phase === "disclosure", "room in private disclosure");
  const lateF = await dave.req("POST", `/api/rooms/${roomId}/findings`, { ...content(roomId, {}), nonce: randomNonce(), findingHash: aliceF.fh, commitment: aliceF.commitment });
  assert(lateF.status === 409, "no new findings after the hunt");
  assert((await dev.req("GET", `/api/findings/${aliceF.id}`)).status === 200, "disclosure: developer reads the report");
  assert((await bob.req("GET", `/api/findings/${aliceF.id}`)).status === 403, "disclosure: other researchers still cannot");
  await dev.ok("POST", `/api/findings/${aliceF.id}/comments`, { kind: "DEVELOPER_RESPONSE", body: "Confirmed, 2.0.1 removes the postinstall hook." });

  for (const [who, f, idx] of [[alice, aliceF, 0], [bob, bobF, 1], [carol, carolF, 2]] as const) {
    await who.tx("revealFinding", [BigInt(roomId), idx, f.fh, f.nonce]);
  }
  const revealed = await alice.ok<{ finding: { onchain: { revealed: boolean; revealedHashMatches: boolean } } }>("GET", `/api/findings/${aliceF.id}`);
  assert(revealed.finding.onchain.revealed && revealed.finding.onchain.revealedHashMatches, "reveal verified on-chain against the stored report");

  console.log("• peer review opens");
  await advance(121, owner);
  assert((await bob.ok<{ phase: string }>("GET", `/api/rooms/${roomId}`)).phase === "review", "room in peer review");
  assert((await bob.req("GET", `/api/findings/${aliceF.id}`)).status === 200, "review: researchers can read findings");
  const proof = await bob.req<string>("GET", `/api/uploads/${att.id}`, undefined, true);
  assert(proof.status === 200 && proof.data.includes("demo_key"), "review: proof files readable");

  const run = await bob.ok<{ id: number; report: { outcome: string; claims: { observation: string; result: string }[]; environment: string; agent: { mode: string } } }>(
    "POST",
    `/api/findings/${aliceF.id}/reproduce`,
  );
  console.log(`    evidence: ${run.report.environment}; outcome ${run.report.outcome}; agent ${run.report.agent.mode}`);
  assert(run.report.outcome === "REPRODUCED", "evidence engine reproduces alice's claims");
  assert(run.report.claims.every((c) => c.result === "confirmed"), "every claimed observation confirmed");
  const vsCarol = await bob.ok<{ id: number; report: { outcome: string } }>("POST", `/api/findings/${carolF.id}/reproduce`);
  assert(vsCarol.report.outcome === "NOT_REPRODUCED", "carol's persistence claim is not reproduced");

  const repro = await bob.ok<{ id: number }>("POST", `/api/findings/${aliceF.id}/comments`, { kind: "REPRODUCED", body: "Reproduced in 3 fresh sandboxes.", evidenceRunId: run.id });
  const refute = await carol.ok<{ id: number }>("POST", `/api/findings/${aliceF.id}/comments`, { kind: "REFUTED", body: "Only happens if ~/.ssh/demo_key exists." });
  await alice.ok("POST", `/api/findings/${aliceF.id}/comments`, { kind: "COMMENT", parentId: refute.id, body: "The read is attempted unconditionally; see run evidence." });
  await carol.ok("POST", `/api/comments/${refute.id}/withdraw`);
  await dave.ok("POST", `/api/findings/${aliceF.id}/comments`, { kind: "ADDITIONAL_EVIDENCE", body: "The key bytes are placed in the request body (T_CORRELATE)." });
  await dave.ok("POST", `/api/findings/${carolF.id}/comments`, { kind: "REFUTED", body: "No cron path is ever written; sandbox shows no persistence." });
  const devRefutes = await dev.req("POST", `/api/findings/${aliceF.id}/comments`, { kind: "REPRODUCED", body: "x" });
  assert(devRefutes.status === 403, "developer cannot post REPRODUCED on their own release");
  const bobSteal = await bob.req("POST", `/api/findings/${aliceF.id}/comments`, { kind: "REPRODUCED", body: "x", evidenceRunId: vsCarol.id });
  assert(bobSteal.status === 400, "evidence runs must belong to the same finding");
  const voted = await dave.ok<{ votes: number }>("POST", "/api/votes", { targetType: "finding", targetId: aliceF.id });
  assert(voted.votes === 1, "upvote recorded");
  const thread = await dave.ok<{ comments: { id: number; withdrawn: boolean; parentId: number | null; evidenceRunId: number | null }[] }>("GET", `/api/findings/${aliceF.id}`);
  assert(thread.comments.find((c) => c.id === refute.id)?.withdrawn === true, "refutation withdrawn");
  assert(thread.comments.some((c) => c.parentId === refute.id), "threaded reply stored");
  assert(thread.comments.find((c) => c.id === repro.id)?.evidenceRunId === run.id, "evidence run attached to the reproduction");

  console.log("• moderator adjudicates and settles on-chain");
  const notMod = await bob.req("POST", `/api/findings/${aliceF.id}/adjudicate`, { verdict: "valid", finalSeverity: "high", reasoning: "looks right to me" });
  assert(notMod.status === 403, "only the room moderator adjudicates");
  const badReviewer = await owner.req("POST", `/api/findings/${aliceF.id}/adjudicate`, { verdict: "valid", finalSeverity: "high", reasoning: "Reproduced by rules and peers.", materialReviewers: [alice.address] });
  assert(badReviewer.status === 400, "the author cannot be a material reviewer of their own finding");
  await owner.ok("POST", `/api/findings/${aliceF.id}/adjudicate`, {
    verdict: "valid",
    finalSeverity: "high",
    reasoning: "Reproduced deterministically in fresh sandboxes; key read and egress confirmed. Exfiltration of a real key needs the file to exist, so HIGH not CRITICAL.",
    materialReviewers: [bob.address, dave.address],
  });
  await owner.ok("POST", `/api/findings/${bobF.id}/adjudicate`, { verdict: "duplicate", duplicateOf: aliceF.id, reasoning: "Independent discovery of the same install-time exfiltration." });
  await owner.ok("POST", `/api/findings/${carolF.id}/adjudicate`, { verdict: "invalid", reasoning: "No persistence was observed by rules, sandbox or peers.", materialReviewers: [dave.address] });

  const prepared = await owner.ok<{
    adjudicationHash: Hex;
    record: unknown;
    args: { discoveries: { commitmentIndex: number; severity: number; duplicate: boolean; amount: string }[]; reviews: { reviewer: Address; amount: string }[]; rejected: number[] };
  }>("POST", `/api/rooms/${roomId}/settlement`);
  assert(adjudicationHash(prepared.record) === prepared.adjudicationHash, "adjudication hash recomputes from the public record");
  assert(prepared.args.rejected.length === 1 && prepared.args.rejected[0] === 2, "carol's commitment rejected");
  const a0 = BigInt(prepared.args.discoveries.find((d) => d.commitmentIndex === 0)!.amount);
  const a1 = BigInt(prepared.args.discoveries.find((d) => d.commitmentIndex === 1)!.amount);
  assert(a1 * 2n === a0, "duplicate earns half of the original");
  assert(prepared.args.reviews.length === 2, "bob and dave receive review awards");

  const pendingBefore = (await pub.readContract({ address: CONTRACT, abi: releaseBondAbi, functionName: "pendingWithdrawals", args: [alice.account.address] })) as bigint;
  await owner.tx("finalizeSettlement", [
    BigInt(roomId),
    prepared.args.discoveries.map((d) => ({ ...d, amount: BigInt(d.amount) })),
    prepared.args.reviews.map((r) => ({ ...r, amount: BigInt(r.amount) })),
    prepared.args.rejected,
    prepared.adjudicationHash,
  ]);
  const settledRoom = await carol.ok<{ phase: string; room: { adjudication_hash: string; refunded_wei: string } }>("GET", `/api/rooms/${roomId}`);
  assert(settledRoom.phase === "settled", "room settled");
  assert(settledRoom.room.adjudication_hash === prepared.adjudicationHash.toLowerCase(), "on-chain adjudication hash matches the published record");
  const alicePending = (await pub.readContract({ address: CONTRACT, abi: releaseBondAbi, functionName: "pendingWithdrawals", args: [alice.account.address] })) as bigint;
  assert(alicePending - pendingBefore === a0, "alice credited her discovery award");
  const total = prepared.args.discoveries.reduce((s, d) => s + BigInt(d.amount), 0n) + prepared.args.reviews.reduce((s, r) => s + BigInt(r.amount), 0n);
  assert(BigInt(settledRoom.room.refunded_wei) === bounty - total, "remainder refunded to the developer");
  const stats = (await pub.readContract({ address: CONTRACT, abi: releaseBondAbi, functionName: "statsOf", args: [carol.account.address] })) as { rejectedFindings: number };
  assert(stats.rejectedFindings === 1, "carol's rejected report recorded in on-chain reputation");

  console.log("• withdrawal pays the wallet");
  const before = await pub.getBalance({ address: alice.account.address });
  const wHash = await alice.tx("withdraw", []);
  const wr = await pub.getTransactionReceipt({ hash: wHash });
  const after = await pub.getBalance({ address: alice.account.address });
  assert(after - before + wr.gasUsed * wr.effectiveGasPrice === a0, "alice's balance grew by exactly her award (net of gas)");

  console.log("• public disclosure after settlement and server-rendered pages");
  const anon = new Actor("anon", dave.account);
  assert((await anon.req("GET", `/api/findings/${aliceF.id}`)).status === 200, "settled findings are public");
  for (const [p, needle] of [
    ["/", "releasebond-demo-telemetry"],
    [`/rooms/${roomId}`, "releasebond-demo-telemetry"],
    [`/rooms/${roomId}?tab=settlement`, "Public adjudication record"],
    [`/rooms/${roomId}?tab=release`, "Deterministic rule scan"],
    [`/rooms/${roomId}/findings/${aliceF.id}`, "postinstall reads ~/.ssh keys"],
    [`/researchers/${alice.address}`, "On-chain security reputation"],
    ["/admin", "Contract deployment"],
  ] as const) {
    const r = await anon.req<string>("GET", p, undefined, true);
    assert(r.status === 200 && r.data.includes(needle), `page ${p} renders`);
  }

  console.log(`\nE2E LIFECYCLE PASSED (${checks} checks)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
