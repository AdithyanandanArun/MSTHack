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
import { signInTypedData } from "../src/lib/signIn";
import { adjudicationHash, computeCommitment, findingHash, randomNonce, type FindingContent } from "../src/lib/canonical";
import { localHardhat } from "../src/lib/chain/chains";
import { releaseBondAbi, releaseBondBytecode } from "../src/lib/chain/releaseBondArtifact";

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
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
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
  async signInMessage(domain = new URL(BASE).host) {
    const { nonce } = await this.ok<{ nonce: string }>("POST", "/api/auth/nonce");
    return createSiweMessage({
      domain,
      address: this.account.address,
      statement: "Sign in to ReleaseBond.",
      uri: BASE,
      version: "1",
      chainId: chain.id,
      nonce,
      issuedAt: new Date(),
    });
  }
  /** eip712 is the fallback for wallets without personal_sign (e.g. Bridgekey). */
  async signIn(scheme: "eip191" | "eip712" = "eip191") {
    const message = await this.signInMessage();
    const signature =
      scheme === "eip712"
        ? await this.account.signTypedData(signInTypedData(chain.id, message))
        : await this.account.signMessage({ message });
    await this.ok("POST", "/api/auth/verify", { message, signature, scheme });
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

/** Polls a background evidence run until it is done. */
async function waitRun<R>(who: Actor, id: number): Promise<{ id: number; report: R }> {
  for (let i = 0; i < 600; i++) {
    const s = await who.ok<{ id: number; status: string; error: string | null; report: R | null }>("GET", `/api/evidence/${id}`);
    if (s.status === "done") return { id: s.id, report: s.report! };
    if (s.status === "error") throw new Error(`evidence run #${id} failed: ${s.error}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`evidence run #${id} did not finish`);
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
      "## Summary\n`scripts/telemetry.js` runs on install, reads `~/.ssh/demo_key` and `AWS_SECRET_ACCESS_KEY`, and POSTs them to a hard-coded IP.\n", // trailing newline, as the editor template leaves it
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
  const [owner, dev, alice, bob, carol, dave, erin, frank] = KEYS.map(
    (k, i) =>
      new Actor(["owner/moderator", "developer", "alice", "bob", "carol", "dave", "erin (appeals moderator)", "frank (panel moderator)"][i], privateKeyToAccount(k)),
  );
  console.log("• sign in all wallets with SIWE");
  for (const a of [owner, dev, alice, carol, dave, erin]) await a.signIn();
  {
    // BridgeKey only accepts a SIWE domain equal to the page hostname (no port); the server allows both.
    const message = await frank.signInMessage(new URL(BASE).hostname);
    await frank.ok("POST", "/api/auth/verify", { message, signature: await frank.account.signMessage({ message }) });
    const foreign = await frank.signInMessage("evil.example");
    const r = await frank.req("POST", "/api/auth/verify", { message: foreign, signature: await frank.account.signMessage({ message: foreign }) });
    assert(r.status === 401, "sign-in accepts the bare hostname but still rejects another domain");
  }
  {
    // A personal_sign signature must not pass as the EIP-712 scheme (and vice versa).
    const message = await bob.signInMessage();
    const r = await bob.req("POST", "/api/auth/verify", { message, signature: await bob.account.signMessage({ message }), scheme: "eip712" });
    assert(r.status === 401, "sign-in rejects a personal_sign signature presented as EIP-712");
  }
  await bob.signIn("eip712");
  assert((await bob.ok<{ address: string | null }>("GET", "/api/auth/me")).address === bob.account.address.toLowerCase(), "EIP-712 sign-in (wallets without personal_sign) starts a session");
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

  await owner.tx("setModerator", [frank.account.address, true]);
  const badPanel = await dev.req("POST", "/api/rooms/draft", { artifactSha256: art.sha256, moderator: owner.address, panel: [dave.address], panelQuorum: 1 });
  assert(badPanel.status === 400, "only registered moderators can sit on a panel");
  const unauth = await new Actor("anon", dev.account).req("POST", "/api/rooms/draft", { artifactSha256: art.sha256, moderator: owner.address });
  assert(unauth.status === 401, "room drafts require sign-in");
  const selfMod = await owner.req("POST", "/api/rooms/draft", { artifactSha256: art.sha256, moderator: owner.address });
  assert(selfMod.status === 400, "developer cannot pick themselves as moderator");

  const draft = await dev.ok<{ params: { ecosystem: string; packageName: string; version: string; artifactHash: Hex; previousArtifactHash: Hex; moderator: Address; panel: Address[]; panelQuorum: number } }>(
    "POST",
    "/api/rooms/draft",
    { artifactSha256: art.sha256, title: "E2E demo room", description: "Break the **2.0.0** release.", moderator: owner.address, requireVerified: true, panel: [frank.address], panelQuorum: 1 },
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
  assert((room.room as unknown as { require_verified: number }).require_verified === 1, "verified-only requirement mirrored from the draft");
  for (const who of [alice, bob, carol]) await owner.ok("POST", "/api/admin/verify-researcher", { address: who.address, verified: true });
  assert((await alice.req("POST", "/api/admin/verify-researcher", { address: dave.address, verified: true })).status === 403, "only moderators can verify researchers");
  const artifactHash = room.room.artifact_hash;

  console.log("• researchers submit private findings with on-chain commitments");
  const upload = new FormData();
  upload.set("file", new Blob(["open('/home/sandbox/.ssh/demo_key')\nconnect(203.0.113.10:443)\n"]), "strace-excerpt.log");
  const att = await alice.ok<{ id: number; sha256: string }>("POST", "/api/uploads", upload);
  const unverified = await dave.req("POST", `/api/rooms/${roomId}/findings`, { ...content(roomId, {}), nonce: randomNonce(), findingHash: `0x${"2".repeat(64)}`, commitment: `0x${"3".repeat(64)}` });
  assert(unverified.status === 403, "unverified researcher refused in a verified-only room");
  const aliceF = await submitFinding(alice, roomId, artifactHash, content(roomId, { attachments: [att.sha256] }), [att.id]);
  assert(aliceF.id > 0, "verified researcher accepted");
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
  const tampered = await bob.req("POST", `/api/rooms/${roomId}/findings`, { ...content(roomId, {}), nonce: randomNonce(), findingHash: aliceF.fh, commitment: aliceF.commitment });
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

  type Report = { outcome: string; claims: { observation: string; result: string }[]; environment: string; agent: { mode: string } };
  const t0 = Date.now();
  const queued = await bob.req<{ id: number; status: string }>("POST", `/api/findings/${aliceF.id}/reproduce`);
  assert(queued.status === 202 && ["queued", "running"].includes(queued.data.status), "reproduction is queued, not run inside the request");
  assert(Date.now() - t0 < 2_000, "queuing returns immediately");
  const dupRun = await bob.req("POST", `/api/findings/${aliceF.id}/reproduce`);
  assert(dupRun.status === 429, "one pending evidence run per researcher");
  const run = await waitRun<Report>(bob, queued.data.id);
  console.log(`    evidence: ${run.report.environment}; outcome ${run.report.outcome}; agent ${run.report.agent.mode}`);
  assert(run.report.outcome === "REPRODUCED", "evidence engine reproduces alice's claims");
  assert(run.report.claims.every((c) => c.result === "confirmed"), "every claimed observation confirmed");
  const carolQueued = await bob.ok<{ id: number }>("POST", `/api/findings/${carolF.id}/reproduce`);
  const vsCarol = await waitRun<Report>(bob, carolQueued.id);
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
  type Queue = {
    rooms: { roomId: number; pendingVerdicts: { findingId: number }[]; nextAction: string }[];
    appeals: { appealId: number; findingId: number }[];
    panelApprovals: { roomId: number; state: string }[];
  };
  const q0 = await owner.ok<Queue>("GET", "/api/moderation/queue");
  const qRoom = q0.rooms.find((r) => r.roomId === roomId);
  assert(qRoom?.pendingVerdicts.length === 3 && qRoom.nextAction === "record verdicts", "moderator queue lists pending verdicts");
  const carolObj = await dave.ok<{ unresolvedObjections: number }>("GET", `/api/findings/${carolF.id}`);
  const aliceObj = await dave.ok<{ unresolvedObjections: number }>("GET", `/api/findings/${aliceF.id}`);
  assert(carolObj.unresolvedObjections === 1 && aliceObj.unresolvedObjections === 0, "unresolved objections counted on the finding");
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

  console.log("• appeal of a verdict");
  await owner.tx("setModerator", [erin.account.address, true]);
  const appeal = await carol.req<{ id: number }>("POST", `/api/findings/${carolF.id}/appeals`, { reason: "The cron write happens only on the second install; please re-run twice." });
  assert(appeal.status === 201 && appeal.data.id > 0, "appeal filed by the author");
  assert((await carol.req("POST", `/api/findings/${carolF.id}/appeals`, { reason: "Filing a second appeal for the same finding." })).status >= 400, "only one appeal per finding");
  assert((await bob.req("POST", `/api/findings/${carolF.id}/appeals`, { reason: "Bystanders should not be able to appeal." })).status === 403, "bystanders cannot appeal");
  const selfDecide = await owner.req("POST", `/api/appeals/${appeal.data.id}/decide`, { decision: "overturned", newVerdict: "valid", newSeverity: "low", reasoning: "Room moderator trying to decide." });
  assert(selfDecide.status === 403, "room moderator cannot decide an appeal");
  assert((await owner.req("POST", `/api/rooms/${roomId}/settlement`)).status === 409, "settlement blocked while an appeal is open");
  const erinQueue = await erin.ok<Queue>("GET", "/api/moderation/queue");
  const ownerQueue = await owner.ok<Queue>("GET", "/api/moderation/queue");
  assert(
    erinQueue.appeals.some((a) => a.appealId === appeal.data.id) && !ownerQueue.appeals.some((a) => a.appealId === appeal.data.id),
    "appeals moderator sees the open appeal in their queue",
  );
  await erin.ok("POST", `/api/appeals/${appeal.data.id}/decide`, {
    decision: "overturned",
    newVerdict: "inconclusive",
    reasoning: "The claim was not reproduced, but the evidence is not strong enough to call it invalid either.",
  });
  assert(true, "appeal decided by a second moderator");
  const readj = await owner.req("POST", `/api/findings/${carolF.id}/adjudicate`, { verdict: "valid", finalSeverity: "low", reasoning: "Changing my mind after the appeal." });
  assert(readj.status === 409, "the room moderator cannot change a verdict after an appeal");
  const carolView = await carol.ok<{ appeal: { status: string } | null }>("GET", `/api/findings/${carolF.id}`);
  assert(carolView.appeal?.status === "overturned", "appeal outcome visible on the finding");

  const prepared = await owner.ok<{
    adjudicationHash: Hex;
    record: unknown;
    args: { discoveries: { commitmentIndex: number; severity: number; duplicate: boolean; amount: string }[]; reviews: { reviewer: Address; amount: string }[]; rejected: number[] };
  }>("POST", `/api/rooms/${roomId}/settlement`);
  assert(adjudicationHash(prepared.record) === prepared.adjudicationHash, "adjudication hash recomputes from the public record");
  const recCarol = (prepared.record as { findings: { findingId: number; appeal: { status: string; reviewer: string } | null }[] }).findings.find((f) => f.findingId === carolF.id);
  assert(recCarol?.appeal?.status === "overturned" && recCarol.appeal.reviewer === erin.address, "appeal recorded in the adjudication record");
  assert(prepared.args.rejected.length === 0, "carol's overturned (inconclusive) finding is neither paid nor rejected");
  const a0 = BigInt(prepared.args.discoveries.find((d) => d.commitmentIndex === 0)!.amount);
  const a1 = BigInt(prepared.args.discoveries.find((d) => d.commitmentIndex === 1)!.amount);
  assert(a1 * 2n === a0, "duplicate earns half of the original");
  assert(prepared.args.reviews.length === 2, "bob and dave receive review awards");

  const pendingBefore = (await pub.readContract({ address: CONTRACT, abi: releaseBondAbi, functionName: "pendingWithdrawals", args: [alice.account.address] })) as bigint;
  const settleArgs = (sigs: Hex[]) => [
    BigInt(roomId),
    prepared.args.discoveries.map((d) => ({ ...d, amount: BigInt(d.amount) })),
    prepared.args.reviews.map((r) => ({ ...r, amount: BigInt(r.amount) })),
    prepared.args.rejected,
    prepared.adjudicationHash,
    sigs,
  ];

  console.log("• moderator panel approval");
  const status = await frank.ok<{ panel: { panel: string[]; quorum: number; frozen: { adjudicationHash: Hex; awardsHash: Hex }; approvals: unknown[] } }>("GET", `/api/rooms/${roomId}/settlement`);
  assert(status.panel.quorum === 1 && status.panel.panel[0] === frank.address && status.panel.approvals.length === 0, "panel indexed from chain with no approvals yet");
  assert(status.panel.frozen.adjudicationHash === prepared.adjudicationHash, "panel signs the frozen record the moderator will submit");
  let refused = false;
  try {
    await owner.tx("finalizeSettlement", settleArgs([]));
  } catch {
    refused = true;
  }
  assert(refused, "settlement refused without panel approval");
  const typed = {
    domain: { name: "ReleaseBond", version: "1", chainId: chain.id, verifyingContract: CONTRACT },
    types: { Settlement: [{ name: "roomId", type: "uint256" }, { name: "adjudicationHash", type: "bytes32" }, { name: "awardsHash", type: "bytes32" }] },
    primaryType: "Settlement",
    message: { roomId: BigInt(roomId), adjudicationHash: status.panel.frozen.adjudicationHash, awardsHash: status.panel.frozen.awardsHash },
  } as const;
  const erinSig = await erin.account.signTypedData(typed);
  assert((await erin.req("POST", `/api/rooms/${roomId}/settlement/approve`, { signature: erinSig })).status === 403, "non-panelists cannot approve");
  const wrongSig = await frank.account.signTypedData({ ...typed, message: { ...typed.message, awardsHash: `0x${"9".repeat(64)}` } });
  assert((await frank.req("POST", `/api/rooms/${roomId}/settlement/approve`, { signature: wrongSig })).status === 400, "approvals of different awards are rejected");
  const frankQueue = await frank.ok<Queue>("GET", "/api/moderation/queue");
  assert(frankQueue.panelApprovals.some((p) => p.roomId === roomId && p.state === "awaiting your signature"), "panelist sees the settlement awaiting their signature");
  const frankSig = await frank.account.signTypedData(typed);
  const approved = await frank.ok<{ approvals: number; quorum: number }>("POST", `/api/rooms/${roomId}/settlement/approve`, { signature: frankSig });
  assert(approved.approvals === 1 && approved.quorum === 1, "panelist approval collected");
  const collected = await owner.ok<{ panel: { approvals: { signature: Hex }[] } }>("GET", `/api/rooms/${roomId}/settlement`);
  await owner.tx("finalizeSettlement", settleArgs(collected.panel.approvals.map((a) => a.signature)));
  assert(true, "panel room settled with the panel signature");
  const settledRoom = await carol.ok<{ phase: string; room: { adjudication_hash: string; refunded_wei: string } }>("GET", `/api/rooms/${roomId}`);
  assert(settledRoom.phase === "settled", "room settled");
  assert(settledRoom.room.adjudication_hash === prepared.adjudicationHash.toLowerCase(), "on-chain adjudication hash matches the published record");
  const alicePending = (await pub.readContract({ address: CONTRACT, abi: releaseBondAbi, functionName: "pendingWithdrawals", args: [alice.account.address] })) as bigint;
  assert(alicePending - pendingBefore === a0, "alice credited her discovery award");
  const total = prepared.args.discoveries.reduce((s, d) => s + BigInt(d.amount), 0n) + prepared.args.reviews.reduce((s, r) => s + BigInt(r.amount), 0n);
  assert(BigInt(settledRoom.room.refunded_wei) === bounty - total, "remainder refunded to the developer");
  const stats = (await pub.readContract({ address: CONTRACT, abi: releaseBondAbi, functionName: "statsOf", args: [carol.account.address] })) as { rejectedFindings: number };
  assert(stats.rejectedFindings === 0, "an overturned verdict is not recorded as a rejected report on-chain");

  console.log("• withdrawal pays the wallet");
  const before = await pub.getBalance({ address: alice.account.address });
  const wHash = await alice.tx("withdraw", []);
  const wr = await pub.getTransactionReceipt({ hash: wHash });
  const after = await pub.getBalance({ address: alice.account.address });
  assert(after - before + wr.gasUsed * wr.effectiveGasPrice === a0, "alice's balance grew by exactly her award (net of gas)");

  console.log("• release security history and developer track record");
  type Hist = {
    disclaimer: string;
    releases: { version: string; phase: string; summary: string; acceptedFindings: { total: number; final: boolean; bySeverity: Record<string, number> } }[];
  };
  const hist = await new Actor("anon", dave.account).ok<Hist>("GET", "/api/packages/npm/releasebond-demo-telemetry");
  const rel = hist.releases[0];
  assert(
    hist.releases.length === 1 && rel.version === "2.0.0" && rel.phase === "settled" && rel.acceptedFindings.total === 1 && rel.acceptedFindings.bySeverity.high === 1 && rel.acceptedFindings.final,
    "package history lists the reviewed release with its accepted findings",
  );
  const withoutDisclaimer = JSON.stringify(hist).replace(hist.disclaimer, "");
  assert(
    !/\bsafe\b/i.test(withoutDisclaimer) && /does not prove the absence of vulnerabilities/.test(hist.disclaimer) && rel.summary.includes("completed a ReleaseBond security review"),
    "package history API is decision support, not a safety verdict",
  );
  const track = await new Actor("anon", dave.account).ok<{
    releasesFunded: number;
    releasesReviewed: number;
    poolsFundedWei: string;
    acceptedFindings: { total: number; bySeverity: Record<string, number> };
  }>("GET", `/api/developers/${dev.address}`);
  assert(
    track.releasesFunded === 1 && track.releasesReviewed === 1 && track.poolsFundedWei === bounty.toString() && track.acceptedFindings.bySeverity.high === 1,
    "developer track record shows funded pools and accepted findings",
  );

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
    ["/signin?next=%2Fadmin", "Sign in to ReleaseBond"],
    ["/packages/npm/releasebond-demo-telemetry", "Release security history"],
    [`/researchers/${dev.address}`, "Review track record"],
  ] as const) {
    const r = await anon.req<string>("GET", p, undefined, true);
    assert(r.status === 200 && r.data.includes(needle), `page ${p} renders`);
  }
  for (const p of ["/admin", "/dashboard", "/rooms/new", `/rooms/${roomId}/findings/new`]) {
    const r = await fetch(`${BASE}${p}`, { redirect: "manual" });
    const to = r.headers.get("location") ?? "";
    assert(r.status >= 300 && r.status < 400 && to.includes(`/signin?next=${encodeURIComponent(p)}`), `signed out, ${p} redirects to the sign-in page`);
  }
  assert((await owner.req<string>("GET", "/admin", undefined, true)).data.includes("Contract deployment"), "admin page opens for a moderator");
  assert((await alice.req<string>("GET", "/admin", undefined, true)).data.includes("Admin is for ReleaseBond moderators"), "admin page is refused to a researcher");
  assert((await alice.req<string>("GET", "/dashboard", undefined, true)).data.includes("Your findings"), "dashboard opens for a signed-in researcher");

  console.log("• abuse limits");
  let limited: Response | null = null;
  for (let i = 0; i < 100 && !limited; i++) {
    const r = await fetch(`${BASE}/api/votes`, {
      method: "POST",
      headers: { cookie: dave.cookie, "content-type": "application/json" },
      body: JSON.stringify({ targetType: "finding", targetId: aliceF.id }),
    });
    if (r.status === 429) limited = r;
    else if (r.status !== 200) throw new Error(`vote returned ${r.status}`);
  }
  assert(limited && Number(limited.headers.get("retry-after")) > 0, "write endpoints rate limited with Retry-After");
  assert((await dave.req("GET", `/api/findings/${aliceF.id}`)).status === 200, "reads unaffected by write limits");
  let verifyLimited = false;
  for (let i = 0; i < 20 && !verifyLimited; i++) {
    const { nonce } = await dave.ok<{ nonce: string }>("POST", "/api/auth/nonce");
    const message = createSiweMessage({ domain: new URL(BASE).host, address: dave.account.address, uri: BASE, version: "1", chainId: chain.id, nonce, issuedAt: new Date() });
    const r = await dave.req("POST", "/api/auth/verify", { message, signature: `0x${"ab".repeat(65)}` });
    verifyLimited = r.status === 429;
  }
  await alice.signIn();
  assert(verifyLimited, "sign-in limits are per wallet: a flooded wallet is throttled while others still sign in");
  const blob = () => {
    const f = new FormData();
    f.set("file", new Blob([Buffer.alloc(600_000, 97)]), "big-log.txt");
    return f;
  };
  assert((await carol.req("POST", "/api/uploads", blob())).status === 201, "upload within quota accepted");
  const overQuota = await carol.req("POST", "/api/uploads", blob());
  const otherWallet = await dave.req("POST", "/api/uploads", blob());
  assert(overQuota.status === 413 && otherWallet.status === 201, "upload quota enforced per wallet");

  console.log("• moderator and researcher accountability, health");
  const ownerTrack = await dave.ok<{
    roomsModerated: number;
    roomsSettled: number;
    verdicts: Record<string, number>;
    appealsAgainstTheirVerdicts: { overturned: number };
  }>("GET", `/api/moderators/${owner.address}`);
  const erinTrack = await dave.ok<{ appealsDecided: { overturned: number } }>("GET", `/api/moderators/${erin.address}`);
  assert(
    ownerTrack.roomsModerated === 1 &&
      ownerTrack.roomsSettled === 1 &&
      ownerTrack.verdicts.valid === 1 &&
      ownerTrack.verdicts.duplicate === 1 &&
      ownerTrack.verdicts.invalid === 1 &&
      ownerTrack.appealsAgainstTheirVerdicts.overturned === 1 &&
      erinTrack.appealsDecided.overturned === 1,
    "moderator track record counts rooms, verdicts and appeal outcomes",
  );
  const carolRep = await dave.ok<{ appeals: { findingsOverturnedOnAppeal: number; overturned: { from: string; to: string }[] } }>(
    "GET",
    `/api/researchers/${carol.address}`,
  );
  assert(
    carolRep.appeals.findingsOverturnedOnAppeal === 1 && carolRep.appeals.overturned[0].from === "invalid" && carolRep.appeals.overturned[0].to === "inconclusive",
    "reputation counts findings overturned on appeal",
  );
  const health = await fetch(`${BASE}/api/health`);
  const hj = (await health.json()) as { status: string; checks: Record<string, string>; chainId: number };
  assert(health.status === 200 && hj.status === "ready" && hj.checks.rpc === "ok" && hj.chainId === chain.id, "health endpoint reports ready against the local chain");

  console.log("• funding the same release again: guided while a room is open, allowed once its pool is reclaimed");
  {
    const register = async () => {
      const f = new FormData();
      f.set("ecosystem", "npm");
      f.set("file", new Blob([fs.readFileSync(path.join(ARTIFACTS, "releasebond-benign-utils-1.0.0.tgz"))]), "benign.tgz");
      return dev.ok<{ sha256: string; activeRoom: { id: number; message: string } | null }>("POST", "/api/artifacts", f);
    };
    const benign = await register();
    assert(benign.activeRoom === null, "a release with no open room can be funded");
    const draftBody = { artifactSha256: benign.sha256, moderator: owner.address };
    const fund = async () => {
      const d = await dev.ok<{ params: Record<string, unknown> }>("POST", "/api/rooms/draft", draftBody);
      const hash = await dev.tx("createRoom", [{ ...d.params, huntDuration: 60n, disclosureDuration: 60n, adjudicationWindow: 86400n }], parseEther("1"));
      const logs = (await pub.getTransactionReceipt({ hash })).logs;
      await dev.ok("POST", "/api/chain/sync", { txHash: hash });
      for (const l of logs) {
        try {
          const ev = decodeEventLog({ abi: releaseBondAbi, data: l.data, topics: l.topics });
          if (ev.eventName === "RoomCreated") return Number(ev.args.roomId);
        } catch {
          /* other logs */
        }
      }
      throw new Error("no RoomCreated event");
    };
    const first = await fund();
    const hunting = await dev.req<{ error: string }>("POST", "/api/rooms/draft", draftBody);
    assert(hunting.status === 409 && hunting.data.error.includes(`Room #${first}`) && hunting.data.error.includes("still hunting"), "funding the release again while its room hunts is refused, naming the room");
    assert((await register()).activeRoom?.id === first, "the funding form learns about the open room as soon as the artifact is verified");
    await advance(61, dev);
    const empty = await dev.req<{ error: string }>("POST", "/api/rooms/draft", draftBody);
    assert(empty.status === 409 && empty.data.error.includes("Reclaim unused pool"), "after an empty hunt the refusal says to reclaim the pool first (the contract allows one open room per release)");
    const reclaim = await dev.tx("reclaimUnused", [BigInt(first)]);
    await dev.ok("POST", "/api/chain/sync", { txHash: reclaim });
    const old = await dev.ok<{ room: { status: string; refunded_wei: string } }>("GET", `/api/rooms/${first}`);
    assert(old.room.status === "refunded" && old.room.refunded_wei === parseEther("1").toString(), "the empty room's pool is reclaimed and the room shows as refunded");
    assert((await register()).activeRoom === null, "no open-room notice once the pool is reclaimed");
    const second = await fund();
    assert(second > first, "the same release can be funded again after reclaiming");
  }

  console.log("• in-app deployment registration (/admin)");
  const deployAndRegister = async (who: Actor, bytecode: Hex, args: unknown[] = []) => {
    const hash = await who.wallet.deployContract({ abi: args.length ? releaseBondAbi : [], bytecode, args, account: who.account, chain } as never);
    await pub.waitForTransactionReceipt({ hash });
    return who.req("POST", "/api/admin/contract", { txHash: hash });
  };
  const genuine = await deployAndRegister(owner, releaseBondBytecode, [owner.account.address]);
  assert(genuine.status === 200, "genuine deployment accepted despite immutables");
  // Tiny contract whose runtime just returns 42: must not pass as ReleaseBond.
  const foreign = await deployAndRegister(owner, "0x600a600c600039600a6000f3602a60005260206000f3");
  assert(foreign.status === 400, "foreign bytecode rejected");
  const notOwner = await deployAndRegister(dev, releaseBondBytecode, [dev.account.address]);
  assert(notOwner.status === 403, "only the current owner can register a replacement deployment");

  console.log(`\nE2E LIFECYCLE PASSED (${checks} checks)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
