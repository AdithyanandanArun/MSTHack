// Suggested settlement. The moderator reviews (and may edit) these numbers
// before signing; the contract independently enforces the hard limits.
import type { Severity } from "./canonical";
import { severityCode } from "./canonical";

/** Share of the discovery budget one original finding can earn, by severity. */
export const SEVERITY_CAP_BPS: Record<Severity, bigint> = {
  critical: 10_000n,
  high: 5_000n,
  medium: 2_000n,
  low: 500n,
};
/** An independent duplicate earns this share of the original's award. */
export const DUPLICATE_BPS = 5_000n;
/** Review pool reserved when material reviewers exist. */
export const REVIEW_POOL_BPS = 1_000n;
/** Contract limit (ReleaseBond.MAX_REVIEW_BPS). */
export const MAX_REVIEW_BPS = 3_000n;
const BPS = 10_000n;

export interface AdjudicatedFinding {
  findingId: number;
  commitmentIndex: number | null;
  revealed: boolean;
  author: string;
  verdict: "valid" | "duplicate" | "invalid" | "inconclusive" | null;
  severity: Severity | null;
  duplicateOf: number | null; // finding id of the original
  materialReviewers: string[];
}

export interface SettlementPlan {
  discoveries: { findingId: number; commitmentIndex: number; researcher: string; severity: number; duplicate: boolean; amount: bigint }[];
  reviews: { reviewer: string; amount: bigint }[];
  rejected: number[]; // commitment indices
  excluded: { findingId: number; reason: string }[];
  discoveryTotal: bigint;
  reviewTotal: bigint;
  refund: bigint;
}

export function planSettlement(bounty: bigint, findings: AdjudicatedFinding[], exclude: { developer: string; moderator: string }): SettlementPlan {
  const excluded: SettlementPlan["excluded"] = [];
  const byId = new Map(findings.map((f) => [f.findingId, f]));
  const payable = (f: AdjudicatedFinding) => f.revealed && f.commitmentIndex !== null;

  const reviewers = new Set<string>();
  for (const f of findings) {
    if (f.verdict === null) continue;
    for (const r of f.materialReviewers) {
      const a = r.toLowerCase();
      if (a !== exclude.developer && a !== exclude.moderator) reviewers.add(a);
    }
  }
  const reviewPool = reviewers.size ? (bounty * REVIEW_POOL_BPS) / BPS : 0n;
  const budget = bounty - reviewPool;

  const originals = findings.filter((f) => f.verdict === "valid");
  const raw = new Map<number, bigint>();
  for (const f of originals) {
    if (!payable(f)) {
      excluded.push({ findingId: f.findingId, reason: "valid but never revealed on-chain" });
      continue;
    }
    if (!f.severity) {
      excluded.push({ findingId: f.findingId, reason: "valid finding has no final severity" });
      continue;
    }
    raw.set(f.findingId, (budget * SEVERITY_CAP_BPS[f.severity]) / BPS);
  }
  for (const f of findings.filter((x) => x.verdict === "duplicate")) {
    const orig = f.duplicateOf !== null ? byId.get(f.duplicateOf) : undefined;
    if (!orig || orig.verdict !== "valid" || !raw.has(orig.findingId)) {
      excluded.push({ findingId: f.findingId, reason: "duplicate of a finding that is not a paid valid finding" });
      continue;
    }
    if (!payable(f)) {
      excluded.push({ findingId: f.findingId, reason: "duplicate never revealed on-chain" });
      continue;
    }
    raw.set(f.findingId, (raw.get(orig.findingId)! * DUPLICATE_BPS) / BPS);
  }

  let sum = 0n;
  for (const v of raw.values()) sum += v;
  const scale = (v: bigint) => (sum > budget ? (v * budget) / sum : v);

  const discoveries: SettlementPlan["discoveries"] = [];
  for (const [id, v] of raw) {
    const f = byId.get(id)!;
    const sev = f.verdict === "duplicate" ? byId.get(f.duplicateOf!)!.severity! : f.severity!;
    const amount = scale(v);
    if (amount === 0n) continue;
    discoveries.push({
      findingId: id,
      commitmentIndex: f.commitmentIndex!,
      researcher: f.author,
      severity: severityCode(sev),
      duplicate: f.verdict === "duplicate",
      amount,
    });
  }
  const discoveryTotal = discoveries.reduce((a, d) => a + d.amount, 0n);

  let reviewTotalTarget = reviewPool;
  const cap = (bounty * MAX_REVIEW_BPS) / BPS;
  if (reviewTotalTarget > cap) reviewTotalTarget = cap;
  if (discoveryTotal > 0n && reviewTotalTarget > discoveryTotal) reviewTotalTarget = discoveryTotal;
  const reviewList = [...reviewers].sort();
  const each = reviewList.length ? reviewTotalTarget / BigInt(reviewList.length) : 0n;
  const reviews = each > 0n ? reviewList.map((reviewer) => ({ reviewer, amount: each })) : [];
  const reviewTotal = reviews.reduce((a, r) => a + r.amount, 0n);

  const rejected = findings
    .filter((f) => f.verdict === "invalid" && f.commitmentIndex !== null)
    .map((f) => f.commitmentIndex!)
    .sort((a, b) => a - b);

  return { discoveries, reviews, rejected, excluded, discoveryTotal, reviewTotal, refund: bounty - discoveryTotal - reviewTotal };
}
