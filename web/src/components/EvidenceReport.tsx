import { OBSERVATION_LABELS } from "@/lib/canonical";
import type { EvidenceReport } from "@/lib/evidence/types";
import { FactTable } from "./ArtifactCard";
import { Label, OutcomeLabel } from "./Labels";

const CONF: Record<EvidenceReport["confidence"], { tone: "accent" | "attention" | "muted"; text: string }> = {
  REPRODUCED_EVIDENCE: { tone: "accent", text: "REPRODUCED EVIDENCE — deterministic execution confirmed observable behaviour; still requires human interpretation." },
  SUSPICIOUS: { tone: "attention", text: "SUSPICIOUS — something worth investigating; no bounty implication." },
  NONE: { tone: "muted", text: "No suspicious observable behaviour recorded. This does not mean the release is safe." },
};

export function EvidenceReportView({ report, hash }: { report: EvidenceReport; hash?: string | null }) {
  const conf = CONF[report.confidence];
  const dynFacts = report.dynamic.runs.flatMap((r) => r.facts);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {report.outcome && <OutcomeLabel outcome={report.outcome} />}
        <Label tone={conf.tone}>{report.confidence.replace("_", " ")}</Label>
        <span className="muted text-xs">{conf.text}</span>
      </div>
      <div className="text-xs muted">
        Artifact <span className="mono">{report.artifact.sha256.slice(0, 16)}…</span> ✓ re-verified · Environment: {report.environment} ·{" "}
        {new Date(report.generatedAt).toLocaleString()}
        {hash ? <> · report sha256 <span className="mono">{hash.slice(0, 16)}…</span></> : null}
      </div>

      {report.claims.length > 0 && (
        <div>
          <div className="font-semibold">Claimed observations</div>
          <table className="mt-1 w-full text-sm">
            <tbody>
              {report.claims.map((c) => (
                <tr key={c.observation} className="border-t" style={{ borderColor: "var(--border-muted)" }}>
                  <td className="py-1 pr-2">{OBSERVATION_LABELS[c.observation]}</td>
                  <td className="py-1 pr-2">
                    <Label tone={c.result === "confirmed" ? "success" : c.result === "inconclusive" ? "attention" : "danger"}>{c.result}</Label>
                  </td>
                  <td className="py-1 text-xs muted">
                    basis: {c.basis}
                    {c.dynamicRuns ? ` · sandbox ${c.dynamicRunsObserved}/${c.dynamicRuns} runs` : ""}
                    {c.staticFacts.length ? ` · code facts ${c.staticFacts.join(", ")}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <div className="font-semibold">Rule engine — sandbox runs</div>
        {!report.dynamic.enabled ? (
          <p className="muted text-xs">Dynamic execution not performed: {report.dynamic.reason}</p>
        ) : (
          <>
            <div className="text-xs muted">
              {report.dynamic.runs.map((r) => `run ${r.run}: ${r.ok ? "ok" : "error"} (${r.facts.length} facts, ${r.durationMs} ms)`).join(" · ")}
            </div>
            <FactTable facts={dedupe(dynFacts)} empty="No observable behaviour in any run." />
          </>
        )}
      </div>

      <details>
        <summary className="cursor-pointer font-semibold">Rule engine — static facts ({report.staticFacts.filter((f) => f.severity !== "info").length})</summary>
        <div className="mt-1">
          <FactTable facts={report.staticFacts.filter((f) => f.severity !== "info")} />
        </div>
      </details>

      <div className="rounded-md border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-subtle)" }}>
        <div className="flex items-center gap-2 font-semibold">
          Agent analysis
          <Label>{report.agent.mode === "claude" ? `Claude (${report.agent.model})` : "heuristic analyst (no LLM configured)"}</Label>
          <span className="text-xs font-normal muted">advisory only — cannot validate findings or move funds</span>
        </div>
        <p className="mt-1">{report.agent.summary}</p>
        {report.agent.hypotheses.length > 0 && (
          <ul className="mt-2 space-y-1">
            {report.agent.hypotheses.map((h, i) => (
              <li key={i}>
                <Label tone={h.status === "supported" ? "success" : h.status === "contradicted" ? "danger" : "muted"}>{h.status}</Label>{" "}
                {h.claim} <span className="mono muted">[{h.evidence.join(", ")}]</span>
                {!h.grounded && <Label tone="danger">ungrounded — ignore</Label>}
              </li>
            ))}
          </ul>
        )}
        {report.agent.challenges.length > 0 && (
          <div className="mt-2">
            <div className="text-xs font-semibold muted">Challenges</div>
            <ul className="list-disc pl-5">{report.agent.challenges.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
        )}
        {report.agent.missingEvidence.length > 0 && (
          <div className="mt-2">
            <div className="text-xs font-semibold muted">Missing evidence</div>
            <ul className="list-disc pl-5">{report.agent.missingEvidence.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
        )}
        {report.agent.followUpTests.length > 0 && (
          <div className="mt-2">
            <div className="text-xs font-semibold muted">Follow-up tests</div>
            <ul className="space-y-1">
              {report.agent.followUpTests.map((t, i) => (
                <li key={i}>
                  <span className="mono">{t.id}</span> {t.executed ? <Label tone="success">executed</Label> : <Label>proposed</Label>} <span className="muted">{t.reason}</span>
                  {t.result ? <pre className="mono mt-1 overflow-x-auto rounded p-2" style={{ background: "var(--bg)" }}>{t.result}</pre> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function dedupe<T extends { detail: string }>(facts: T[]): T[] {
  const seen = new Set<string>();
  return facts.filter((f) => {
    const k = f.detail;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
