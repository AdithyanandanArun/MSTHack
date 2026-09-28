import "server-only";
import { adjudicationHash } from "@/lib/canonical";
import { canDecideAppeal } from "@/lib/appeals";
import { phaseOf, type Phase } from "@/lib/phase";
import { db } from "./db";
import { isModerator, type FindingRow, type RoomRow } from "./queries";

interface AppealRow {
  id: number;
  finding_id: number;
  appellant: string;
  reason: string;
  status: string;
  reviewer: string | null;
  new_verdict: string | null;
  original_verdict: string | null;
  created_at: number;
}

/**
 * Spec §38 moderator dashboard: everything waiting on this moderator right
 * now, across all rooms, with deadlines.
 */
export function moderatorQueue(address: string, now: number) {
  const me = address.toLowerCase();
  const d = db();

  const myRooms = d.prepare("SELECT * FROM rooms WHERE moderator = ? AND status = 'active' ORDER BY adjudication_deadline").all(me) as RoomRow[];
  const rooms = myRooms.map((room) => {
    const phase = phaseOf(room, now);
    const findings = d
      .prepare("SELECT id, title, verdict, commitment_index FROM findings WHERE room_id = ? AND status = 'committed' ORDER BY id")
      .all(room.id) as Pick<FindingRow, "id" | "title" | "verdict" | "commitment_index">[];
    const openAppeals = (
      d
        .prepare("SELECT COUNT(*) AS n FROM appeals a JOIN findings f ON f.id = a.finding_id WHERE f.room_id = ? AND a.status = 'open'")
        .get(room.id) as { n: number }
    ).n;
    return {
      roomId: room.id,
      packageName: room.package_name,
      version: room.version,
      phase,
      adjudicationDeadline: room.adjudication_deadline,
      secondsToDeadline: room.adjudication_deadline - now,
      pendingVerdicts: findings.filter((f) => !f.verdict).map((f) => ({ findingId: f.id, title: f.title })),
      openAppeals,
      recordFrozen: !!room.adjudication_json,
      // What blocks settlement, in order.
      nextAction:
        phase === "hunting" || phase === "disclosure"
          ? "wait for peer review"
          : phase === "expired"
            ? "deadline missed: the pool can be refunded by anyone"
            : findings.some((f) => !f.verdict)
              ? "record verdicts"
              : openAppeals
                ? "wait for appeals to be decided"
                : room.adjudication_json
                  ? "sign finalizeSettlement"
                  : "freeze the adjudication record",
    };
  });

  // Open appeals anywhere that this moderator is allowed to decide.
  const moderator = isModerator(me);
  const appealRows = d
    .prepare(
      `SELECT a.*, f.room_id, f.author, f.status AS finding_status, f.verdict, f.title
       FROM appeals a JOIN findings f ON f.id = a.finding_id WHERE a.status = 'open' ORDER BY a.created_at`,
    )
    .all() as (AppealRow & { room_id: number; author: string; finding_status: string; verdict: string | null; title: string })[];
  const appeals = appealRows.flatMap((a) => {
    const room = d.prepare("SELECT * FROM rooms WHERE id = ?").get(a.room_id) as RoomRow | undefined;
    if (!room) return [];
    const phase = phaseOf(room, now);
    const ok = canDecideAppeal({
      address: me,
      isModerator: moderator,
      room,
      finding: { author: a.author, status: a.finding_status, verdict: a.verdict },
      appeal: { appellant: a.appellant, status: a.status },
      phase,
    }).ok;
    return ok
      ? [{ appealId: a.id, findingId: a.finding_id, title: a.title, roomId: room.id, contestedVerdict: a.verdict, filedAt: a.created_at, secondsToDeadline: room.adjudication_deadline - now }]
      : [];
  });

  // Panel settlements waiting for this moderator's EIP-712 approval.
  const panelRooms = (d.prepare("SELECT room_id, panel_json, quorum FROM room_panels").all() as { room_id: number; panel_json: string; quorum: number }[]).filter(
    (p) => (JSON.parse(p.panel_json) as string[]).includes(me),
  );
  const panelApprovals = panelRooms.flatMap((p) => {
    const room = d.prepare("SELECT * FROM rooms WHERE id = ?").get(p.room_id) as RoomRow | undefined;
    if (!room || room.status !== "active") return [];
    const phase = phaseOf(room, now);
    if (phase !== "review") return [];
    const hash = room.adjudication_json ? adjudicationHash(JSON.parse(room.adjudication_json)).toLowerCase() : null;
    const approved = hash
      ? !!d.prepare("SELECT 1 FROM panel_approvals WHERE room_id = ? AND adjudication_hash = ? AND signer = ?").get(room.id, hash, me)
      : false;
    if (approved) return [];
    return [
      {
        roomId: room.id,
        packageName: room.package_name,
        version: room.version,
        quorum: p.quorum,
        state: hash ? "awaiting your signature" : "waiting for the room moderator to freeze the record",
        adjudicationHash: hash,
        secondsToDeadline: room.adjudication_deadline - now,
      },
    ];
  });

  return { address: me, isModerator: moderator, rooms, appeals, panelApprovals };
}

/** Spec §33 "moderator histories": public, measured from indexed data. */
export function moderatorHistory(address: string, now: number) {
  const me = address.toLowerCase();
  const d = db();
  const rooms = d.prepare("SELECT * FROM rooms WHERE moderator = ?").all(me) as RoomRow[];
  const phases = rooms.map((r) => phaseOf(r, now));
  const commitCount = (roomId: number) => (d.prepare("SELECT COUNT(*) AS n FROM commitments WHERE room_id = ?").get(roomId) as { n: number }).n;
  // Count the verdict this moderator issued, even if an appeal later overturned it.
  const verdicts = d
    .prepare(
      `SELECT COALESCE(CASE WHEN a.status = 'overturned' THEN a.original_verdict END, f.verdict) AS verdict, COUNT(*) AS n
       FROM findings f LEFT JOIN appeals a ON a.finding_id = f.id
       WHERE f.adjudicated_by = ? AND f.verdict IS NOT NULL GROUP BY 1`,
    )
    .all(me) as {
    verdict: string;
    n: number;
  }[];
  const appealsAgainst = d
    .prepare("SELECT a.status, COUNT(*) AS n FROM appeals a JOIN findings f ON f.id = a.finding_id WHERE f.adjudicated_by = ? GROUP BY a.status")
    .all(me) as { status: string; n: number }[];
  const appealsDecided = d.prepare("SELECT status, COUNT(*) AS n FROM appeals WHERE reviewer = ? GROUP BY status").all(me) as { status: string; n: number }[];
  const count = (rows: { status: string; n: number }[], s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  return {
    address: me,
    isModerator: isModerator(me),
    roomsModerated: rooms.length,
    roomsSettled: phases.filter((p) => p === "settled").length,
    roomsActive: phases.filter((p): p is Phase => ["hunting", "disclosure", "review"].includes(p)).length,
    // A refund with commitments present can only be refundExpired: the moderator missed the deadline.
    deadlinesMissed: rooms.filter((r, i) => phases[i] === "expired" || (r.status === "refunded" && commitCount(r.id) > 0)).length,
    verdicts: Object.fromEntries(verdicts.map((v) => [v.verdict, v.n])),
    appealsAgainstTheirVerdicts: { upheld: count(appealsAgainst, "upheld"), overturned: count(appealsAgainst, "overturned"), open: count(appealsAgainst, "open") },
    appealsDecided: { upheld: count(appealsDecided, "upheld"), overturned: count(appealsDecided, "overturned") },
    panelApprovalsGiven: (d.prepare("SELECT COUNT(*) AS n FROM panel_approvals WHERE signer = ?").get(me) as { n: number }).n,
  };
}

/** Spec §26 "findings later overturned": appeal outcomes on a researcher's findings. */
export function researcherAppealOutcomes(address: string) {
  const rows = db()
    .prepare(
      `SELECT a.finding_id, a.status, a.original_verdict, a.new_verdict FROM appeals a JOIN findings f ON f.id = a.finding_id
       WHERE f.author = ? ORDER BY a.id`,
    )
    .all(address.toLowerCase()) as { finding_id: number; status: string; original_verdict: string | null; new_verdict: string | null }[];
  const overturned = rows.filter((r) => r.status === "overturned");
  return {
    findingsOverturnedOnAppeal: overturned.length,
    appealsUpheld: rows.filter((r) => r.status === "upheld").length,
    appealsOpen: rows.filter((r) => r.status === "open").length,
    overturned: overturned.map((r) => ({ findingId: r.finding_id, from: r.original_verdict, to: r.new_verdict })),
  };
}

/** Spec §15: refutations still standing (not withdrawn by their author). */
export function unresolvedObjections(findingId: number): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM comments WHERE finding_id = ? AND kind = 'REFUTED' AND withdrawn = 0").get(findingId) as { n: number }).n;
}
