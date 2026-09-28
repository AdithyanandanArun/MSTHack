import "server-only";
import { formatEther } from "viem";
import type { Severity } from "@/lib/canonical";
import { phaseOf, type Phase } from "@/lib/phase";
import { db } from "./db";
import type { RoomRow } from "./queries";

/** Spec §45: a review produces evidence; it never proves a release is free of vulnerabilities. */
export const REVIEW_DISCLAIMER =
  "A ReleaseBond review produces evidence about one exact artifact. It does not prove the absence of vulnerabilities, and it says nothing about other versions.";

type SeverityCounts = Record<Severity, number>;
const emptyCounts = (): SeverityCounts => ({ critical: 0, high: 0, medium: 0, low: 0 });

interface FindingVerdictRow {
  room_id: number;
  verdict: string | null;
  final_severity: Severity | null;
}

function verdictsByRoom(roomIds: number[]): Map<number, FindingVerdictRow[]> {
  const out = new Map<number, FindingVerdictRow[]>();
  if (!roomIds.length) return out;
  const rows = db()
    .prepare(
      `SELECT room_id, verdict, final_severity FROM findings
       WHERE status = 'committed' AND room_id IN (${roomIds.map(() => "?").join(",")})`,
    )
    .all(...roomIds) as FindingVerdictRow[];
  for (const r of rows) out.set(r.room_id, [...(out.get(r.room_id) ?? []), r]);
  return out;
}

function mstcText(wei: string): string {
  const [i, f = ""] = formatEther(BigInt(wei)).split(".");
  const frac = f.slice(0, 4).replace(/0+$/, "");
  return `${i}${frac ? `.${frac}` : ""} MSTC`;
}

export interface ReleaseReview {
  roomId: number;
  ecosystem: string;
  packageName: string;
  version: string;
  artifactHash: string;
  phase: Phase;
  bountyWei: string;
  developer: string;
  openedAt: number;
  commitments: number;
  /** Distinct accepted issues (valid verdicts; independent duplicates are the same issue). */
  acceptedFindings: { total: number; bySeverity: SeverityCounts; final: boolean };
  rejectedFindings: number;
  newerReviewedRelease: string | null;
  summary: string;
}

function summarize(room: RoomRow, phase: Phase, accepted: number, newer: string | null): string {
  const pool = mstcText(room.bounty_wei);
  switch (phase) {
    case "hunting":
      return `Security review in progress: the hunt is open with a ${pool} pool.`;
    case "disclosure":
      return "Security review in progress: the hunt closed and findings are in private disclosure.";
    case "review":
      return "Security review in progress: findings are in adversarial peer review.";
    case "expired":
      return "The review ended without adjudication; the pool can be returned to the developer.";
    case "refunded":
      return "The review closed without adjudication and the pool was returned to the developer.";
    case "settled": {
      const base = `This exact release completed a ReleaseBond security review with a ${pool} bounty.`;
      const found =
        accepted === 0
          ? " No valid findings were accepted during this review."
          : ` ${accepted} valid finding${accepted === 1 ? " was" : "s were"} accepted during this review.`;
      const next = newer && accepted > 0 ? ` A newer release (${newer}) was subsequently submitted for review.` : "";
      return base + found + next;
    }
  }
}

function reviewsFor(rooms: RoomRow[], now: number): ReleaseReview[] {
  const verdicts = verdictsByRoom(rooms.map((r) => r.id));
  const commitCounts = new Map(
    (rooms.length
      ? (db()
          .prepare(`SELECT room_id, COUNT(*) AS n FROM commitments WHERE room_id IN (${rooms.map(() => "?").join(",")}) GROUP BY room_id`)
          .all(...rooms.map((r) => r.id)) as { room_id: number; n: number }[])
      : []
    ).map((r) => [r.room_id, r.n]),
  );
  return rooms.map((room) => {
    const phase = phaseOf(room, now);
    const rows = verdicts.get(room.id) ?? [];
    const bySeverity = emptyCounts();
    let total = 0;
    for (const f of rows) {
      if (f.verdict === "valid" && f.final_severity) {
        bySeverity[f.final_severity]++;
        total++;
      }
    }
    const newer =
      rooms
        .filter((r) => r.package_name === room.package_name && r.ecosystem === room.ecosystem && r.created_at > room.created_at && r.version !== room.version)
        .sort((a, b) => a.created_at - b.created_at)[0]?.version ?? null;
    return {
      roomId: room.id,
      ecosystem: room.ecosystem,
      packageName: room.package_name,
      version: room.version,
      artifactHash: room.artifact_hash,
      phase,
      bountyWei: room.bounty_wei,
      developer: room.developer,
      openedAt: room.created_at,
      commitments: commitCounts.get(room.id) ?? 0,
      acceptedFindings: { total, bySeverity, final: phase === "settled" },
      rejectedFindings: rows.filter((f) => f.verdict === "invalid").length,
      newerReviewedRelease: newer,
      summary: summarize(room, phase, total, newer),
    };
  });
}

/** Spec §25: review history of every funded release of one package, newest first. */
export function packageHistory(ecosystem: string, name: string, now: number) {
  const rooms = db()
    .prepare("SELECT * FROM rooms WHERE ecosystem = ? AND package_name = ? ORDER BY created_at DESC, id DESC")
    .all(ecosystem, name) as RoomRow[];
  return { ecosystem, name, releases: reviewsFor(rooms, now), disclaimer: REVIEW_DISCLAIMER };
}

/** Spec §27: a developer's review track record. Historical evidence, not a guarantee. */
export function developerHistory(address: string, now: number) {
  const rooms = db().prepare("SELECT * FROM rooms WHERE developer = ? ORDER BY created_at DESC").all(address.toLowerCase()) as RoomRow[];
  // "Followed by a newer reviewed release" counts only this developer's own newer rooms.
  const reviews = reviewsFor(rooms, now);
  const bySeverity = emptyCounts();
  let accepted = 0;
  let followedUp = 0;
  for (const r of reviews) {
    if (r.phase !== "settled") continue;
    accepted += r.acceptedFindings.total;
    for (const k of Object.keys(bySeverity) as Severity[]) bySeverity[k] += r.acceptedFindings.bySeverity[k];
    if (r.acceptedFindings.total > 0 && r.newerReviewedRelease) followedUp++;
  }
  const settledWithFindings = reviews.filter((r) => r.phase === "settled" && r.acceptedFindings.total > 0).length;
  return {
    address: address.toLowerCase(),
    releasesFunded: rooms.length,
    releasesReviewed: reviews.filter((r) => r.phase === "settled").length,
    activeReviews: reviews.filter((r) => ["hunting", "disclosure", "review"].includes(r.phase)).length,
    poolsFundedWei: rooms.reduce((a, r) => a + BigInt(r.bounty_wei), 0n).toString(),
    acceptedFindings: { total: accepted, bySeverity },
    releasesWithFindingsFollowedByNewerReview: { count: followedUp, of: settledWithFindings },
    packages: [...new Set(rooms.map((r) => `${r.ecosystem}:${r.package_name}`))],
    reviews,
    disclaimer: REVIEW_DISCLAIMER,
  };
}
