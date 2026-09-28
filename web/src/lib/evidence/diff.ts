import type { DiffSummary, ReleaseArtifact } from "./types";

function lineCounts(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of text.split("\n")) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
}

/** Multiset line difference: a cheap, order-insensitive +/- line count. */
function lineDelta(oldText: string, newText: string): { added: number; removed: number } {
  const a = lineCounts(oldText);
  const b = lineCounts(newText);
  let added = 0;
  let removed = 0;
  for (const [line, n] of b) added += Math.max(0, n - (a.get(line) ?? 0));
  for (const [line, n] of a) removed += Math.max(0, n - (b.get(line) ?? 0));
  return { added, removed };
}

export function diffReleases(prev: ReleaseArtifact, next: ReleaseArtifact): DiffSummary {
  const before = new Map(prev.files.map((f) => [f.path, f]));
  const after = new Map(next.files.map((f) => [f.path, f]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const [p, f] of after) {
    const old = before.get(p);
    if (!old) {
      added.push(p);
      if (f.text) linesAdded += f.text.split("\n").length;
    } else if (old.sha256 !== f.sha256) {
      changed.push(p);
      if (old.text !== undefined && f.text !== undefined) {
        const d = lineDelta(old.text, f.text);
        linesAdded += d.added;
        linesRemoved += d.removed;
      }
    }
  }
  for (const [p, f] of before) {
    if (!after.has(p)) {
      removed.push(p);
      if (f.text) linesRemoved += f.text.split("\n").length;
    }
  }

  const dependenciesAdded: Record<string, string> = {};
  const dependenciesRemoved: Record<string, string> = {};
  const dependenciesChanged: Record<string, { from: string; to: string }> = {};
  for (const [k, v] of Object.entries(next.dependencies)) {
    if (!(k in prev.dependencies)) dependenciesAdded[k] = v;
    else if (prev.dependencies[k] !== v) dependenciesChanged[k] = { from: prev.dependencies[k], to: v };
  }
  for (const [k, v] of Object.entries(prev.dependencies)) if (!(k in next.dependencies)) dependenciesRemoved[k] = v;

  const hooks = new Set([...Object.keys(prev.installScripts), ...Object.keys(next.installScripts)]);
  const installScriptsChanged = [...hooks].filter((h) => prev.installScripts[h] !== next.installScripts[h]);

  return {
    previousVersion: prev.version,
    previousSha256: prev.sha256,
    added,
    removed,
    changed,
    linesAdded,
    linesRemoved,
    dependenciesAdded,
    dependenciesRemoved,
    dependenciesChanged,
    installScriptsChanged,
  };
}

/** Unified-ish view of one file's change for the agent (bounded). */
export function fileDiff(prev: ReleaseArtifact | null, next: ReleaseArtifact, path: string, maxLines = 200): string {
  const a = prev?.files.find((f) => f.path === path)?.text;
  const b = next.files.find((f) => f.path === path)?.text;
  if (a === undefined && b === undefined) return `${path}: not present or binary in either version`;
  if (a === undefined) return `${path}: new file\n${(b ?? "").split("\n").slice(0, maxLines).map((l) => `+ ${l}`).join("\n")}`;
  if (b === undefined) return `${path}: removed`;
  const oldSet = lineCounts(a);
  const newSet = lineCounts(b);
  const out: string[] = [];
  for (const l of b.split("\n")) if (!oldSet.has(l)) out.push(`+ ${l}`);
  for (const l of a.split("\n")) if (!newSet.has(l)) out.push(`- ${l}`);
  return `${path}: ${out.length} changed lines\n${out.slice(0, maxLines).join("\n")}`;
}
