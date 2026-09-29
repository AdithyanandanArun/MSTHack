import type { DiffSummary, Fact } from "@/lib/evidence/types";
import { Label } from "./Labels";

export interface ArtifactView {
  sha256: string;
  /** This developer's open room for the release, if any (a release can have one open room at a time). */
  activeRoom?: { id: number; message: string } | null;
  ecosystem: string;
  name: string;
  version: string;
  sourceUrl: string | null;
  size: number;
  metadata: {
    registryIntegrity: { value: string; verified: boolean } | null;
    installScripts: Record<string, string>;
    dependencies: Record<string, string>;
    previousVersion: string | null;
    fileCount: number;
    metadata?: Record<string, unknown>;
  };
  diff: DiffSummary | null;
  scan: Fact[];
}

const SEV_TONE = { high: "danger", medium: "attention", low: "muted", info: "muted" } as const;

export function FactTable({ facts, empty = "No findings from the deterministic rules." }: { facts: Fact[]; empty?: string }) {
  if (!facts.length) return <p className="muted text-sm">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-xs muted">
            <th className="py-1 pr-2">Fact</th>
            <th className="py-1 pr-2">Severity</th>
            <th className="py-1 pr-2">Observation</th>
            <th className="py-1 pr-2">Where</th>
            <th className="py-1">Detail</th>
          </tr>
        </thead>
        <tbody>
          {facts.map((f) => (
            <tr key={f.id} className="border-t align-top" style={{ borderColor: "var(--border-muted)" }}>
              <td className="py-1.5 pr-2 mono">{f.id}</td>
              <td className="py-1.5 pr-2">
                <Label tone={SEV_TONE[f.severity]}>{f.severity}</Label>
              </td>
              <td className="py-1.5 pr-2 mono">{f.observation ?? f.category}</td>
              <td className="py-1.5 pr-2 mono whitespace-nowrap">
                {f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "—"}
              </td>
              <td className="py-1.5">
                {f.detail}
                {f.snippet ? <pre className="mono mt-1 max-w-xl overflow-x-auto rounded p-1.5" style={{ background: "var(--bg-subtle)" }}>{f.snippet}</pre> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DiffStats({ diff }: { diff: DiffSummary | null }) {
  if (!diff) return <p className="text-sm muted">No previous release available for comparison.</p>;
  const deps = Object.keys(diff.dependenciesAdded).length;
  return (
    <div className="text-sm">
      <div className="flex flex-wrap gap-4">
        <span>Changes from <b>{diff.previousVersion}</b></span>
        <span style={{ color: "var(--success)" }}>+{diff.added.length} files</span>
        <span style={{ color: "var(--danger)" }}>−{diff.removed.length} files</span>
        <span>{diff.changed.length} changed</span>
        <span>
          <span style={{ color: "var(--success)" }}>+{diff.linesAdded}</span> / <span style={{ color: "var(--danger)" }}>−{diff.linesRemoved}</span> lines
        </span>
        <span>+{deps} dependenc{deps === 1 ? "y" : "ies"}</span>
      </div>
      {diff.installScriptsChanged.length > 0 && (
        <div className="flash flash-warn mt-2">Install-time hooks changed: <span className="mono">{diff.installScriptsChanged.join(", ")}</span></div>
      )}
      {(diff.added.length > 0 || diff.changed.length > 0) && (
        <details className="mt-2">
          <summary className="cursor-pointer muted">Changed files</summary>
          <ul className="mono mt-1 space-y-0.5">
            {diff.added.slice(0, 100).map((p) => <li key={`a${p}`} style={{ color: "var(--success)" }}>A {p}</li>)}
            {diff.changed.slice(0, 100).map((p) => <li key={`m${p}`}>M {p}</li>)}
            {diff.removed.slice(0, 100).map((p) => <li key={`d${p}`} style={{ color: "var(--danger)" }}>D {p}</li>)}
          </ul>
        </details>
      )}
      {deps > 0 && (
        <div className="mt-1 mono">
          new deps: {Object.entries(diff.dependenciesAdded).map(([k, v]) => `${k}@${v}`).join(", ")}
        </div>
      )}
    </div>
  );
}

export function ArtifactCard({ a }: { a: ArtifactView }) {
  const integrity = a.metadata.registryIntegrity;
  const scripts = Object.entries(a.metadata.installScripts);
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <span className="label mono mr-2" style={{ borderColor: "var(--border)" }}>{a.ecosystem}</span>
          <b>{a.name}@{a.version}</b>
        </div>
        <span className="text-xs muted">{a.metadata.fileCount} files · {(a.size / 1024).toFixed(1)} KB</span>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <div className="text-xs muted">Exact artifact (SHA-256)</div>
          <div className="mono break-all">{a.sha256}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            {integrity ? (
              integrity.verified ? <Label tone="success">matches registry digest</Label> : <Label tone="danger">registry digest mismatch</Label>
            ) : (
              <Label>no registry digest to cross-check</Label>
            )}
            {a.sourceUrl ? <a href={a.sourceUrl} className="mono break-all" target="_blank" rel="noreferrer">{a.sourceUrl}</a> : <Label>uploaded artifact</Label>}
          </div>
        </div>
        <div>
          <div className="text-xs muted">Install-time hooks</div>
          {scripts.length ? (
            <ul className="mono">{scripts.map(([k, v]) => <li key={k}><b>{k}</b>: {v.slice(0, 200)}</li>)}</ul>
          ) : (
            <span className="text-sm">none</span>
          )}
        </div>
        <DiffStats diff={a.diff} />
        <details open={a.scan.some((f) => f.severity === "high")}>
          <summary className="cursor-pointer text-sm font-semibold">
            Deterministic rule scan ({a.scan.filter((f) => f.severity !== "info").length} non-info facts)
          </summary>
          <div className="mt-2">
            <FactTable facts={a.scan.filter((f) => f.severity !== "info")} />
          </div>
        </details>
      </div>
    </div>
  );
}
