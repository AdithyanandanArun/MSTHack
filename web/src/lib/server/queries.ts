import "server-only";
import type { Severity } from "@/lib/canonical";
import type { ArtifactSummary, DiffSummary, Fact } from "@/lib/evidence/types";
import { canViewFinding, phaseOf, type CommentKind, type Phase, type Viewer } from "@/lib/phase";
import { sessionAddress } from "./auth";
import { db } from "./db";

export interface RoomRow {
  id: number;
  developer: string;
  moderator: string;
  artifact_hash: string;
  ecosystem: string;
  package_name: string;
  version: string;
  bounty_wei: string;
  created_at: number;
  hunt_ends_at: number;
  disclosure_ends_at: number;
  adjudication_deadline: number;
  status: string;
  title: string | null;
  description: string | null;
  create_tx: string | null;
  settle_tx: string | null;
  adjudication_hash: string | null;
  adjudication_json: string | null;
  total_awarded_wei: string | null;
  refunded_wei: string | null;
  require_verified: number;
}

export interface FindingRow {
  id: number;
  room_id: number;
  author: string;
  title: string;
  claimed_severity: Severity;
  description: string;
  proof_of_concept: string;
  reproduction: string;
  observations_json: string;
  attachments_json: string;
  finding_hash: string;
  nonce: string;
  commitment: string;
  commitment_index: number | null;
  status: string;
  verdict: string | null;
  final_severity: Severity | null;
  duplicate_of: number | null;
  verdict_reasoning: string | null;
  material_reviewers_json: string | null;
  adjudicated_by: string | null;
  adjudicated_at: number | null;
  award_wei: string | null;
  created_at: number;
}

export interface CommitmentRow {
  room_id: number;
  idx: number;
  researcher: string;
  commitment: string;
  block_number: number;
  committed_at: number;
  tx_hash: string;
  revealed: number;
  finding_hash: string | null;
  reveal_tx: string | null;
}

export interface UserRow {
  address: string;
  researcher_no: number;
  handle: string | null;
  bio: string | null;
  verified: number;
  created_at: number;
}

export interface CommentRow {
  id: number;
  finding_id: number;
  parent_id: number | null;
  author: string;
  kind: CommentKind;
  body: string;
  proposed_severity: string | null;
  duplicate_of: number | null;
  evidence_run_id: number | null;
  withdrawn: number;
  created_at: number;
}

export interface AttachmentRow {
  id: number;
  uploader: string;
  finding_id: number | null;
  comment_id: number | null;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  storage_path: string;
  created_at: number;
}

import { HttpError } from "./httpError";

export { HttpError };

export async function currentViewer(): Promise<Viewer & { user: UserRow | null }> {
  const address = await sessionAddress();
  if (!address) return { address: null, isModerator: false, user: null };
  return { address, isModerator: isModerator(address), user: getUser(address) };
}

export function isModerator(address: string): boolean {
  const row = db().prepare("SELECT enabled FROM moderators WHERE address = ?").get(address.toLowerCase()) as
    | { enabled: number }
    | undefined;
  return !!row?.enabled;
}

export function listModerators(): string[] {
  return (db().prepare("SELECT address FROM moderators WHERE enabled = 1 ORDER BY address").all() as { address: string }[]).map(
    (r) => r.address,
  );
}

export function getUser(address: string): UserRow | null {
  return (db().prepare("SELECT * FROM users WHERE address = ?").get(address.toLowerCase()) as UserRow) ?? null;
}

export function usersByAddress(addresses: string[]): Map<string, UserRow> {
  const uniq = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (!uniq.length) return new Map();
  const rows = db()
    .prepare(`SELECT * FROM users WHERE address IN (${uniq.map(() => "?").join(",")})`)
    .all(...uniq) as UserRow[];
  return new Map(rows.map((r) => [r.address, r]));
}

export function listRooms(): RoomRow[] {
  return db().prepare("SELECT * FROM rooms ORDER BY id DESC").all() as RoomRow[];
}

export function getRoom(id: number): RoomRow | null {
  return (db().prepare("SELECT * FROM rooms WHERE id = ?").get(id) as RoomRow) ?? null;
}

export function requireRoom(id: number): RoomRow {
  const r = getRoom(id);
  if (!r) throw new HttpError(404, "security room not found (it may still be syncing from the chain)");
  return r;
}

export function roomArtifact(room: RoomRow): { summary: ArtifactSummary | null; diff: DiffSummary | null; scan: Fact[] } {
  const row = db()
    .prepare("SELECT metadata_json, diff_json, scan_json FROM artifacts WHERE sha256 = ?")
    .get(room.artifact_hash.slice(2)) as { metadata_json: string; diff_json: string | null; scan_json: string | null } | undefined;
  if (!row) return { summary: null, diff: null, scan: [] };
  return {
    summary: JSON.parse(row.metadata_json),
    diff: row.diff_json ? JSON.parse(row.diff_json) : null,
    scan: row.scan_json ? JSON.parse(row.scan_json) : [],
  };
}

export function roomCommitments(roomId: number): CommitmentRow[] {
  return db().prepare("SELECT * FROM commitments WHERE room_id = ? ORDER BY idx").all(roomId) as CommitmentRow[];
}

export function roomFindings(roomId: number): FindingRow[] {
  return db().prepare("SELECT * FROM findings WHERE room_id = ? ORDER BY id").all(roomId) as FindingRow[];
}

export function getFinding(id: number): FindingRow | null {
  return (db().prepare("SELECT * FROM findings WHERE id = ?").get(id) as FindingRow) ?? null;
}

export function requireFinding(id: number): FindingRow {
  const f = getFinding(id);
  if (!f) throw new HttpError(404, "finding not found");
  return f;
}

export function commitmentOfFinding(f: FindingRow): CommitmentRow | null {
  if (f.commitment_index === null) return null;
  return (
    (db().prepare("SELECT * FROM commitments WHERE room_id = ? AND idx = ?").get(f.room_id, f.commitment_index) as CommitmentRow) ?? null
  );
}

export function findingComments(findingId: number): CommentRow[] {
  return db().prepare("SELECT * FROM comments WHERE finding_id = ? ORDER BY id").all(findingId) as CommentRow[];
}

export function attachmentsFor(kind: "finding" | "comment", id: number): AttachmentRow[] {
  return db()
    .prepare(`SELECT * FROM attachments WHERE ${kind === "finding" ? "finding_id" : "comment_id"} = ? ORDER BY id`)
    .all(id) as AttachmentRow[];
}

export function voteCounts(targetType: "finding" | "comment", ids: number[], viewer: string | null) {
  const counts = new Map<number, { votes: number; mine: boolean }>();
  if (!ids.length) return counts;
  const rows = db()
    .prepare(
      `SELECT target_id, COUNT(*) AS n, SUM(CASE WHEN voter = ? THEN 1 ELSE 0 END) AS mine
       FROM votes WHERE target_type = ? AND target_id IN (${ids.map(() => "?").join(",")}) GROUP BY target_id`,
    )
    .all(viewer ?? "", targetType, ...ids) as { target_id: number; n: number; mine: number }[];
  for (const r of rows) counts.set(r.target_id, { votes: r.n, mine: r.mine > 0 });
  return counts;
}

export function commentKindCounts(findingIds: number[]): Map<number, Partial<Record<CommentKind, number>>> {
  const out = new Map<number, Partial<Record<CommentKind, number>>>();
  if (!findingIds.length) return out;
  const rows = db()
    .prepare(
      `SELECT finding_id, kind, COUNT(*) AS n FROM comments WHERE withdrawn = 0 AND finding_id IN (${findingIds
        .map(() => "?")
        .join(",")}) GROUP BY finding_id, kind`,
    )
    .all(...findingIds) as { finding_id: number; kind: CommentKind; n: number }[];
  for (const r of rows) {
    const m = out.get(r.finding_id) ?? {};
    m[r.kind] = r.n;
    out.set(r.finding_id, m);
  }
  return out;
}

export function roomPhase(room: RoomRow, now: number): Phase {
  return phaseOf(room, now);
}

export function canView(viewer: Viewer, room: RoomRow, finding: FindingRow, now: number): boolean {
  return canViewFinding(viewer, { room, finding, now });
}

/** Public, non-sensitive view of a finding for list pages. */
export function findingListItem(viewer: Viewer, room: RoomRow, f: FindingRow, now: number) {
  const visible = canView(viewer, room, f, now);
  return {
    id: f.id,
    author: f.author,
    status: f.status,
    commitmentIndex: f.commitment_index,
    createdAt: f.created_at,
    visible,
    title: visible ? f.title : null,
    claimedSeverity: visible ? f.claimed_severity : null,
    verdict: f.verdict,
    finalSeverity: f.final_severity,
    awardWei: f.award_wei,
  };
}

export function evidenceRun(id: number) {
  return db().prepare("SELECT * FROM evidence_runs WHERE id = ?").get(id) as
    | { id: number; room_id: number; finding_id: number | null; requested_by: string; status: string; outcome: string | null; report_json: string | null; report_hash: string | null; error: string | null; created_at: number; finished_at: number | null }
    | undefined;
}

/** Artifact in the shape the UI's ArtifactCard renders. */
export function getArtifactRow(sha256: string) {
  const row = db()
    .prepare("SELECT sha256, ecosystem, name, version, source_url, size, metadata_json, diff_json, scan_json FROM artifacts WHERE sha256 = ?")
    .get(sha256.replace(/^0x/, "").toLowerCase()) as
    | { sha256: string; ecosystem: string; name: string; version: string; source_url: string | null; size: number; metadata_json: string; diff_json: string | null; scan_json: string | null }
    | undefined;
  if (!row) return null;
  return {
    sha256: row.sha256,
    ecosystem: row.ecosystem,
    name: row.name,
    version: row.version,
    sourceUrl: row.source_url,
    size: row.size,
    metadata: JSON.parse(row.metadata_json),
    diff: row.diff_json ? (JSON.parse(row.diff_json) as DiffSummary) : null,
    scan: row.scan_json ? (JSON.parse(row.scan_json) as Fact[]) : [],
  };
}

/** Moderator panel of a room (null when the room has none). */
export function roomPanel(roomId: number): { panel: string[]; quorum: number } | null {
  const row = db().prepare("SELECT panel_json, quorum FROM room_panels WHERE room_id = ?").get(roomId) as
    | { panel_json: string; quorum: number }
    | undefined;
  return row ? { panel: JSON.parse(row.panel_json), quorum: row.quorum } : null;
}
