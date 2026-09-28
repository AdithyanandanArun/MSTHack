import { describe, expect, it } from "vitest";
import { MAX_REVIEW_BPS, planSettlement, type AdjudicatedFinding } from "@/lib/payout";
import { allowedCommentKinds, canViewFinding, phaseOf } from "@/lib/phase";

const room = { status: "active", hunt_ends_at: 100, disclosure_ends_at: 200, adjudication_deadline: 300, developer: "0xdev", moderator: "0xmod" };
const committed = { author: "0xalice", status: "committed" };

describe("phases", () => {
  it("mirrors the contract's phase boundaries", () => {
    expect(phaseOf(room, 99)).toBe("hunting");
    expect(phaseOf(room, 100)).toBe("disclosure");
    expect(phaseOf(room, 200)).toBe("review");
    expect(phaseOf(room, 300)).toBe("review");
    expect(phaseOf(room, 301)).toBe("expired");
    expect(phaseOf({ ...room, status: "settled" }, 50)).toBe("settled");
  });
});

describe("finding visibility", () => {
  const v = (address: string | null) => ({ address, isModerator: false });
  const can = (address: string | null, now: number, finding = committed) => canViewFinding(v(address), { room, finding, now });

  it("keeps findings private to their author during the hunt", () => {
    expect(can("0xalice", 50)).toBe(true);
    expect(can("0xbob", 50)).toBe(false);
    expect(can("0xdev", 50)).toBe(false);
    expect(can("0xmod", 50)).toBe(false);
  });
  it("discloses to developer and moderator first", () => {
    expect(can("0xdev", 150)).toBe(true);
    expect(can("0xmod", 150)).toBe(true);
    expect(can("0xbob", 150)).toBe(false);
  });
  it("opens peer review to signed-in researchers, and to everyone after settlement", () => {
    expect(can("0xbob", 250)).toBe(true);
    expect(can(null, 250)).toBe(false);
    expect(canViewFinding(v(null), { room: { ...room, status: "settled" }, finding: committed, now: 400 })).toBe(true);
  });
  it("never exposes uncommitted drafts", () => {
    expect(can("0xbob", 250, { author: "0xalice", status: "draft" })).toBe(false);
  });
  it("limits who can post what", () => {
    const k = (address: string, now: number) => allowedCommentKinds(v(address), { room, finding: committed, now });
    expect(k("0xbob", 50)).toEqual([]);
    expect(k("0xdev", 150)).toContain("DEVELOPER_RESPONSE");
    expect(k("0xbob", 250)).toContain("REFUTED");
    expect(k("0xbob", 250)).not.toContain("DEVELOPER_RESPONSE");
  });
});

describe("settlement planner", () => {
  const E = 10n ** 18n;
  const f = (id: number, over: Partial<AdjudicatedFinding>): AdjudicatedFinding => ({
    findingId: id,
    commitmentIndex: id - 1,
    revealed: true,
    author: `0xr${id}`,
    verdict: "valid",
    severity: "high",
    duplicateOf: null,
    materialReviewers: [],
    ...over,
  });
  const ex = { developer: "0xdev", moderator: "0xmod" };

  it("pays by severity cap, halves duplicates and refunds the rest", () => {
    const plan = planSettlement(500n * E, [f(1, {}), f(2, { verdict: "duplicate", duplicateOf: 1 }), f(3, { verdict: "invalid" })], ex);
    const a = plan.discoveries.find((d) => d.findingId === 1)!;
    const b = plan.discoveries.find((d) => d.findingId === 2)!;
    expect(a.amount).toBe(250n * E);
    expect(b.amount).toBe(125n * E);
    expect(b.duplicate).toBe(true);
    expect(b.severity).toBe(3);
    expect(plan.rejected).toEqual([2]);
    expect(plan.refund).toBe(125n * E);
    expect(plan.discoveryTotal + plan.reviewTotal + plan.refund).toBe(500n * E);
  });

  it("scales down when awards exceed the budget, never exceeding the bounty", () => {
    const plan = planSettlement(100n * E, [f(1, { severity: "critical" }), f(2, { severity: "critical" })], ex);
    expect(plan.discoveryTotal).toBeLessThanOrEqual(100n * E);
    expect(plan.discoveries[0].amount).toBe(plan.discoveries[1].amount);
  });

  it("respects the contract's review caps and excludes conflicted reviewers", () => {
    const plan = planSettlement(1000n * E, [f(1, { severity: "low", materialReviewers: ["0xrev", "0xdev", "0xmod"] })], ex);
    expect(plan.reviews.map((r) => r.reviewer)).toEqual(["0xrev"]);
    expect(plan.reviewTotal).toBeLessThanOrEqual(plan.discoveryTotal);
    expect(plan.reviewTotal * 10_000n).toBeLessThanOrEqual(1000n * E * MAX_REVIEW_BPS);
  });

  it("cannot pay unrevealed commitments", () => {
    const plan = planSettlement(100n * E, [f(1, { revealed: false })], ex);
    expect(plan.discoveries).toEqual([]);
    expect(plan.excluded[0].reason).toMatch(/never revealed/);
    expect(plan.refund).toBe(100n * E);
  });
});
