import type { Observation } from "@/lib/canonical";
import type { ClaimCheck, DynamicRun, Fact, Outcome } from "./types";

/**
 * Checks each claimed observation against static facts and repeated sandbox
 * runs. Dynamic observation outranks static code evidence; inconsistent runs
 * are surfaced as inconclusive rather than rounded to a verdict.
 */
export function checkClaims(claims: Observation[], staticFacts: Fact[], runs: DynamicRun[]): ClaimCheck[] {
  const okRuns = runs.filter((r) => r.ok);
  return claims.map((observation) => {
    const st = staticFacts.filter((f) => f.observation === observation).map((f) => f.id);
    const observedIn = okRuns.filter((r) => r.facts.some((f) => f.observation === observation)).length;
    let result: ClaimCheck["result"];
    let basis: ClaimCheck["basis"];
    if (okRuns.length > 0 && observedIn === okRuns.length) {
      result = "confirmed";
      basis = "dynamic";
    } else if (observedIn > 0) {
      result = "inconclusive"; // flaky across fresh environments
      basis = "dynamic";
    } else if (st.length) {
      // Present in code but not observed at runtime (or no sandbox): code-level confirmation only
      // when no sandbox ran; if the sandbox ran and never saw it, that's inconclusive.
      result = okRuns.length ? "inconclusive" : "confirmed";
      basis = "static";
    } else {
      result = "not-observed";
      basis = "none";
    }
    return { observation, staticFacts: st, dynamicRunsObserved: observedIn, dynamicRuns: okRuns.length, basis, result };
  });
}

export function outcomeOf(checks: ClaimCheck[]): Outcome {
  if (!checks.length) return "INCONCLUSIVE";
  const confirmed = checks.filter((c) => c.result === "confirmed").length;
  const inconclusive = checks.filter((c) => c.result === "inconclusive").length;
  if (confirmed === checks.length) return "REPRODUCED";
  if (confirmed > 0) return "PARTIALLY_REPRODUCED";
  if (inconclusive > 0) return "INCONCLUSIVE";
  return "NOT_REPRODUCED";
}
