import "server-only";
import { z } from "zod";
import type { Address, Hex } from "viem";
import {
  adjudicationHash,
  canonicalJson,
  computeCommitment,
  findingHash,
  OBSERVATIONS,
  SEVERITIES,
  type Observation,
  type Severity,
} from "@/lib/canonical";
import { planSettlement, type AdjudicatedFinding } from "@/lib/payout";
import { allowedCommentKinds, COMMENT_KINDS, phaseOf, type Viewer } from "@/lib/phase";
import { appConfig, chainNow } from "./config";
import { db, nowSec } from "./db";
import {
  attachmentsFor,
  canView,
  commentKindCounts,
  commitmentOfFinding,
  evidenceRun,
  findingComments,
  HttpError,
  requireFinding,
  requireRoom,
  roomFindings,
  usersByAddress,
  voteCounts,
  type AttachmentRow,
  type FindingRow,
  type RoomRow,
} from "./queries";

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const CreateFinding = z.object({
  title: z.string().trim().min(5).max(200),
  claimedSeverity: z.enum(SEVERITIES),
  description: z.string().trim().min(20).max(50_000),
  proofOfConcept: z.string().max(50_000).default(""),
  reproduction: z.string().max(20_000).default(""),
  observations: z.array(z.enum(OBSERVATIONS)).max(OBSERVATIONS.length).default([]),
  attachmentIds: z.array(z.number().int().positive()).max(20).default([]),
  nonce: hex32,
  findingHash: hex32,
  commitment: hex32,
});

function ownUnlinkedAttachments(ids: number[], owner: string): AttachmentRow[] {
  if (!ids.length) return [];
  const rows = db()
    .prepare(`SELECT * FROM attachments WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as AttachmentRow[];
  if (rows.length !== new Set(ids).size) throw new HttpError(400, "unknown attachment");
  for (const r of rows) {
    if (r.uploader !== owner) throw new HttpError(403, "attachment belongs to someone else");
    if (r.finding_id !== null || r.comment_id !== null) throw new HttpError(400, "attachment already used");
  }
  return rows;
}

/** Creates the private report whose hash the researcher then commits on-chain. */
export async function createFinding(roomId: number, author: string, input: z.infer<typeof CreateFinding>) {
  const room = requireRoom(roomId);
  const now = await chainNow();
  if (phaseOf(room, now) !== "hunting") throw new HttpError(409, "the hunt is closed for this release");
  if (author === room.developer || author === room.moderator) throw new HttpError(403, "the developer and moderator cannot submit findings");

  const attachments = ownUnlinkedAttachments(input.attachmentIds, author);
  const content = {
    roomId,
    title: input.title,
    claimedSeverity: input.claimedSeverity,
    description: input.description,
    proofOfConcept: input.proofOfConcept,
    reproduction: input.reproduction,
    observations: input.observations as Observation[],
    attachments: attachments.map((a) => a.sha256),
  };
  const fh = findingHash(content);
  const commitment = computeCommitment({
    roomId,
    artifactHash: room.artifact_hash as Hex,
    findingHash: fh,
    researcher: author as Address,
    nonce: input.nonce as Hex,
  });
  if (fh.toLowerCase() !== input.findingHash.toLowerCase() || commitment.toLowerCase() !== input.commitment.toLowerCase()) {
    throw new HttpError(400, "client and server computed different hashes; refusing to store a report you could not reveal");
  }

  const d = db();
  const tx = d.transaction(() => {
    const id = Number(
      d
        .prepare(
          `INSERT INTO findings(room_id, author, title, claimed_severity, description, proof_of_concept, reproduction,
             observations_json, attachments_json, finding_hash, nonce, commitment, created_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          roomId,
          author,
          content.title.trim(),
          content.claimedSeverity,
          content.description,
          content.proofOfConcept,
          content.reproduction,
          JSON.stringify([...new Set(content.observations)].sort()),
          JSON.stringify(content.attachments),
          fh.toLowerCase(),
          input.nonce.toLowerCase(),
          commitment.toLowerCase(),
          nowSec(),
        ).lastInsertRowid,
    );
    for (const a of attachments) d.prepare("UPDATE attachments SET finding_id = ? WHERE id = ?").run(id, a.id);
    // The commitment may already be on-chain (tx confirmed before this request).
    const onchain = d
      .prepare("SELECT idx FROM commitments WHERE commitment = ? AND researcher = ? AND room_id = ?")
      .get(commitment.toLowerCase(), author, roomId) as { idx: number } | undefined;
    if (onchain) d.prepare("UPDATE findings SET status = 'committed', commitment_index = ? WHERE id = ?").run(onchain.idx, id);
    return id;
  });
  return { id: tx(), findingHash: fh, commitment };
}

export function deleteDraft(findingId: number, author: string) {
  const f = requireFinding(findingId);
  if (f.author !== author) throw new HttpError(403, "not your finding");
  if (f.status !== "draft") throw new HttpError(409, "committed findings are permanent");
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM attachments WHERE finding_id = ?").run(findingId);
    d.prepare("DELETE FROM findings WHERE id = ?").run(findingId);
  })();
}

function publicAttachment(a: AttachmentRow) {
  return { id: a.id, filename: a.filename, mime: a.mime, size: a.size, sha256: a.sha256, uploader: a.uploader, url: `/api/uploads/${a.id}` };
}

function userLabel(users: ReturnType<typeof usersByAddress>, address: string) {
  const u = users.get(address);
  return { address, researcherNo: u?.researcher_no ?? null, handle: u?.handle ?? null, verified: !!u?.verified };
}

/** Full finding + thread, or 403 when the viewer may not read it yet. */
export async function findingDetail(findingId: number, viewer: Viewer) {
  const f = requireFinding(findingId);
  const room = requireRoom(f.room_id);
  const now = await chainNow();
  if (!canView(viewer, room, f, now)) throw new HttpError(403, "this finding is private until the room's disclosure rules open it");

  const comments = findingComments(f.id);
  const users = usersByAddress([f.author, room.developer, room.moderator, ...comments.map((c) => c.author)]);
  const cVotes = voteCounts("comment", comments.map((c) => c.id), viewer.address);
  const fVotes = voteCounts("finding", [f.id], viewer.address).get(f.id) ?? { votes: 0, mine: false };
  const commitment = commitmentOfFinding(f);
  const runIds = [...new Set(comments.map((c) => c.evidence_run_id).filter((x): x is number => !!x))];
  const runs = Object.fromEntries(
    runIds.map((id) => {
      const r = evidenceRun(id);
      return [id, r ? { id: r.id, status: r.status, outcome: r.outcome, reportHash: r.report_hash, report: r.report_json ? JSON.parse(r.report_json) : null } : null];
    }),
  );
  const isAuthor = viewer.address === f.author;

  return {
    room: {
      id: room.id,
      packageName: room.package_name,
      version: room.version,
      ecosystem: room.ecosystem,
      artifactHash: room.artifact_hash,
      developer: room.developer,
      moderator: room.moderator,
      phase: phaseOf(room, now),
      bountyWei: room.bounty_wei,
      huntEndsAt: room.hunt_ends_at,
      disclosureEndsAt: room.disclosure_ends_at,
    },
    finding: {
      id: f.id,
      author: userLabel(users, f.author),
      title: f.title,
      claimedSeverity: f.claimed_severity,
      description: f.description,
      proofOfConcept: f.proof_of_concept,
      reproduction: f.reproduction,
      observations: JSON.parse(f.observations_json) as Observation[],
      attachmentHashes: JSON.parse(f.attachments_json) as string[],
      attachments: attachmentsFor("finding", f.id).map(publicAttachment),
      findingHash: f.finding_hash,
      commitment: f.commitment,
      nonce: isAuthor || (commitment?.revealed ?? false) ? f.nonce : null,
      status: f.status,
      commitmentIndex: f.commitment_index,
      onchain: commitment
        ? {
            blockNumber: commitment.block_number,
            committedAt: commitment.committed_at,
            txHash: commitment.tx_hash,
            revealed: !!commitment.revealed,
            revealTx: commitment.reveal_tx,
            revealedHashMatches: commitment.finding_hash ? commitment.finding_hash === f.finding_hash : null,
          }
        : null,
      verdict: f.verdict,
      finalSeverity: f.final_severity,
      duplicateOf: f.duplicate_of,
      verdictReasoning: f.verdict_reasoning,
      materialReviewers: f.material_reviewers_json ? (JSON.parse(f.material_reviewers_json) as string[]) : [],
      adjudicatedAt: f.adjudicated_at,
      awardWei: f.award_wei,
      createdAt: f.created_at,
      votes: fVotes.votes,
      votedByMe: fVotes.mine,
    },
    comments: comments.map((c) => ({
      id: c.id,
      parentId: c.parent_id,
      author: userLabel(users, c.author),
      kind: c.kind,
      body: c.body,
      proposedSeverity: c.proposed_severity,
      duplicateOf: c.duplicate_of,
      evidenceRunId: c.evidence_run_id,
      withdrawn: !!c.withdrawn,
      createdAt: c.created_at,
      votes: cVotes.get(c.id)?.votes ?? 0,
      votedByMe: cVotes.get(c.id)?.mine ?? false,
      attachments: attachmentsFor("comment", c.id).map(publicAttachment),
      role: c.author === room.developer ? "developer" : c.author === room.moderator ? "moderator" : c.author === f.author ? "author" : null,
    })),
    evidenceRuns: runs,
    viewer: {
      address: viewer.address,
      allowedKinds: allowedCommentKinds(viewer, { room, finding: f, now }),
      isAuthor,
      isRoomModerator: viewer.address === room.moderator,
      isDeveloper: viewer.address === room.developer,
    },
  };
}

export const CreateComment = z.object({
  kind: z.enum(COMMENT_KINDS),
  body: z.string().trim().min(1).max(20_000),
  parentId: z.number().int().positive().nullable().optional(),
  proposedSeverity: z.enum(SEVERITIES).nullable().optional(),
  duplicateOf: z.number().int().positive().nullable().optional(),
  evidenceRunId: z.number().int().positive().nullable().optional(),
  attachmentIds: z.array(z.number().int().positive()).max(10).default([]),
});

export async function addComment(findingId: number, viewer: Viewer, input: z.infer<typeof CreateComment>) {
  if (!viewer.address) throw new HttpError(401, "sign in first");
  const f = requireFinding(findingId);
  const room = requireRoom(f.room_id);
  const now = await chainNow();
  const allowed = allowedCommentKinds(viewer, { room, finding: f, now });
  if (!allowed.includes(input.kind)) {
    throw new HttpError(403, allowed.length ? `you may post: ${allowed.join(", ")}` : "you cannot comment on this finding right now");
  }
  const d = db();
  if (input.parentId) {
    const parent = d.prepare("SELECT finding_id FROM comments WHERE id = ?").get(input.parentId) as { finding_id: number } | undefined;
    if (!parent || parent.finding_id !== findingId) throw new HttpError(400, "reply target is not in this thread");
  }
  if (input.kind === "DUPLICATE") {
    const other = input.duplicateOf ? (d.prepare("SELECT room_id, status FROM findings WHERE id = ?").get(input.duplicateOf) as { room_id: number; status: string } | undefined) : undefined;
    if (!other || other.room_id !== room.id || input.duplicateOf === findingId || other.status !== "committed") {
      throw new HttpError(400, "DUPLICATE must reference another committed finding in this room");
    }
  }
  if (input.kind === "SEVERITY_CHALLENGE" && !input.proposedSeverity) throw new HttpError(400, "propose a severity");
  if (input.evidenceRunId) {
    const run = evidenceRun(input.evidenceRunId);
    if (!run || run.finding_id !== findingId || run.requested_by !== viewer.address || run.status !== "done") {
      throw new HttpError(400, "evidence run must be your own completed run for this finding");
    }
  }
  const attachments = ownUnlinkedAttachments(input.attachmentIds, viewer.address);
  const id = d.transaction(() => {
    const cid = Number(
      d
        .prepare(
          `INSERT INTO comments(finding_id, parent_id, author, kind, body, proposed_severity, duplicate_of, evidence_run_id, created_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          findingId,
          input.parentId ?? null,
          viewer.address,
          input.kind,
          input.body,
          input.kind === "SEVERITY_CHALLENGE" ? input.proposedSeverity : null,
          input.kind === "DUPLICATE" ? input.duplicateOf : null,
          input.evidenceRunId ?? null,
          nowSec(),
        ).lastInsertRowid,
    );
    for (const a of attachments) d.prepare("UPDATE attachments SET comment_id = ? WHERE id = ?").run(cid, a.id);
    return cid;
  })();
  return { id };
}

export function withdrawComment(commentId: number, address: string) {
  const c = db().prepare("SELECT author, withdrawn FROM comments WHERE id = ?").get(commentId) as { author: string; withdrawn: number } | undefined;
  if (!c) throw new HttpError(404, "comment not found");
  if (c.author !== address) throw new HttpError(403, "only the author can withdraw a comment");
  db().prepare("UPDATE comments SET withdrawn = 1 WHERE id = ?").run(commentId);
}

export const Adjudication = z
  .object({
    verdict: z.enum(["valid", "duplicate", "invalid", "inconclusive"]),
    finalSeverity: z.enum(SEVERITIES).nullable().optional(),
    duplicateOf: z.number().int().positive().nullable().optional(),
    reasoning: z.string().trim().min(10).max(10_000),
    materialReviewers: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).max(20).default([]),
  })
  .refine((a) => a.verdict !== "valid" || !!a.finalSeverity, { message: "valid findings need a final severity", path: ["finalSeverity"] })
  .refine((a) => a.verdict !== "duplicate" || !!a.duplicateOf, { message: "duplicates must reference the original", path: ["duplicateOf"] });

export async function adjudicate(findingId: number, moderator: string, input: z.infer<typeof Adjudication>) {
  const f = requireFinding(findingId);
  const room = requireRoom(f.room_id);
  if (room.moderator !== moderator) throw new HttpError(403, "only this room's moderator can adjudicate");
  const phase = phaseOf(room, await chainNow());
  if (phase !== "review") throw new HttpError(409, `adjudication happens during peer review (room is ${phase})`);
  if (f.status !== "committed") throw new HttpError(409, "only committed findings can be adjudicated");

  if (input.verdict === "duplicate") {
    const orig = requireFinding(input.duplicateOf!);
    if (orig.room_id !== room.id || orig.id === f.id) throw new HttpError(400, "original must be another finding in this room");
    if (orig.verdict !== "valid") throw new HttpError(400, "mark the original finding valid first");
  }
  const commenters = new Set(findingComments(f.id).filter((c) => !c.withdrawn).map((c) => c.author));
  const reviewers = [...new Set(input.materialReviewers.map((r) => r.toLowerCase()))];
  for (const r of reviewers) {
    if (!commenters.has(r)) throw new HttpError(400, `${r} has not contributed to this thread`);
    if (r === f.author || r === room.developer || r === room.moderator) throw new HttpError(400, `${r} cannot receive a review award here`);
  }
  db()
    .prepare(
      `UPDATE findings SET verdict = ?, final_severity = ?, duplicate_of = ?, verdict_reasoning = ?, material_reviewers_json = ?,
         adjudicated_by = ?, adjudicated_at = ? WHERE id = ?`,
    )
    .run(
      input.verdict,
      input.verdict === "valid" ? input.finalSeverity : input.verdict === "duplicate" ? requireFinding(input.duplicateOf!).final_severity : null,
      input.verdict === "duplicate" ? input.duplicateOf : null,
      input.reasoning,
      JSON.stringify(reviewers),
      moderator,
      nowSec(),
      f.id,
    );
}

function adjudicatedFindings(room: RoomRow): { rows: FindingRow[]; list: AdjudicatedFinding[] } {
  const rows = roomFindings(room.id).filter((f) => f.status === "committed");
  const revealed = new Map(
    (db().prepare("SELECT idx, revealed, finding_hash FROM commitments WHERE room_id = ?").all(room.id) as {
      idx: number;
      revealed: number;
      finding_hash: string | null;
    }[]).map((c) => [c.idx, c]),
  );
  const list = rows.map((f) => {
    const c = f.commitment_index !== null ? revealed.get(f.commitment_index) : undefined;
    return {
      findingId: f.id,
      commitmentIndex: f.commitment_index,
      revealed: !!c?.revealed && c.finding_hash === f.finding_hash,
      author: f.author,
      verdict: f.verdict as AdjudicatedFinding["verdict"],
      severity: f.final_severity as Severity | null,
      duplicateOf: f.duplicate_of,
      materialReviewers: f.material_reviewers_json ? (JSON.parse(f.material_reviewers_json) as string[]) : [],
    };
  });
  return { rows, list };
}

export async function settlementPreview(roomId: number) {
  const room = requireRoom(roomId);
  const { rows, list } = adjudicatedFindings(room);
  const plan = planSettlement(BigInt(room.bounty_wei), list, { developer: room.developer, moderator: room.moderator });
  const pending = list.filter((f) => f.verdict === null).map((f) => f.findingId);
  const counts = commentKindCounts(rows.map((r) => r.id));
  return {
    room,
    phase: phaseOf(room, await chainNow()),
    plan,
    pendingVerdicts: pending,
    findings: rows.map((f, i) => ({
      id: f.id,
      title: f.title,
      author: f.author,
      commitmentIndex: f.commitment_index,
      revealed: list[i].revealed,
      claimedSeverity: f.claimed_severity,
      verdict: f.verdict,
      finalSeverity: f.final_severity,
      duplicateOf: f.duplicate_of,
      reasoning: f.verdict_reasoning,
      materialReviewers: list[i].materialReviewers,
      counts: counts.get(f.id) ?? {},
    })),
  };
}

/**
 * Freezes the public adjudication record and returns the exact
 * finalizeSettlement arguments plus the record's keccak256 hash.
 */
export async function prepareSettlement(roomId: number, moderator: string) {
  const preview = await settlementPreview(roomId);
  const { room, plan } = preview;
  if (room.moderator !== moderator) throw new HttpError(403, "only this room's moderator can settle");
  if (preview.phase !== "review") throw new HttpError(409, `settlement happens during peer review (room is ${preview.phase})`);
  const pending = preview.findings.filter((f) => f.revealed && !f.verdict);
  if (pending.length) throw new HttpError(409, `adjudicate every revealed finding first (#${pending.map((f) => f.id).join(", #")})`);

  const cfg = appConfig();
  const record = {
    v: 1,
    chainId: cfg.chainId,
    contract: cfg.contractAddress?.toLowerCase(),
    roomId: room.id,
    artifactHash: room.artifact_hash,
    moderator,
    bountyWei: room.bounty_wei,
    findings: preview.findings.map((f) => ({
      findingId: f.id,
      commitmentIndex: f.commitmentIndex,
      findingHash: roomFindings(room.id).find((x) => x.id === f.id)?.finding_hash,
      revealed: f.revealed,
      verdict: f.verdict,
      severity: f.finalSeverity,
      duplicateOf: f.duplicateOf,
      reasoning: f.reasoning,
      materialReviewers: f.materialReviewers,
    })),
    awards: {
      discoveries: plan.discoveries.map((d) => ({ ...d, amount: d.amount.toString() })),
      reviews: plan.reviews.map((r) => ({ ...r, amount: r.amount.toString() })),
      rejected: plan.rejected,
      refundWei: plan.refund.toString(),
    },
  };
  const hash = adjudicationHash(record);
  db().prepare("UPDATE rooms SET adjudication_json = ? WHERE id = ?").run(canonicalJson(record), room.id);
  return {
    adjudicationHash: hash,
    record,
    args: {
      discoveries: plan.discoveries.map((d) => ({ commitmentIndex: d.commitmentIndex, severity: d.severity, duplicate: d.duplicate, amount: d.amount.toString() })),
      reviews: plan.reviews.map((r) => ({ reviewer: r.reviewer, amount: r.amount.toString() })),
      rejected: plan.rejected,
    },
  };
}
