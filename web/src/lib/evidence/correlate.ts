// T_CORRELATE: a deterministic, intra-file data-flow approximation. It asks
// "does a value read from a sensitive source reach a network sink?" and
// answers with concrete line numbers, never with an opinion.
import type { ArtifactFile } from "./types";

const SOURCE = /(readFileSync|readFile|createReadStream)\s*\(|process\.env(\.|\[)|\bkey\b.*=|\.ssh|credentials/;
const SINK = /\.(end|write|send|post|put)\s*\(|\bfetch\s*\(|\.request\s*\(|\bsocket\.write\(|axios|got\s*\(/;
const ASSIGN = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|^\s*([A-Za-z_$][\w$]*)\s*=(?!=)/;

export interface CorrelationResult {
  file: string;
  flows: { source: { line: number; variable: string }; via: { line: number; variable: string }[]; sink: { line: number; code: string } }[];
  sourceLines: number[];
  sinkLines: number[];
}

export function correlateFile(file: ArtifactFile): CorrelationResult {
  const lines = (file.text ?? "").split("\n");
  const tainted = new Map<string, { line: number; chain: { line: number; variable: string }[]; origin: { line: number; variable: string } }>();
  const sourceLines: number[] = [];
  const sinkLines: number[] = [];
  const flows: CorrelationResult["flows"] = [];

  const mentions = (line: string, v: string) => new RegExp(`(^|[^\\w$.])${v.replace(/\$/g, "\\$")}([^\\w$]|$)`).test(line);

  lines.forEach((raw, i) => {
    const ln = i + 1;
    const line = raw.replace(/\/\/.*$/, "");
    const assign = line.match(ASSIGN);
    const target = assign?.[1] ?? assign?.[2];
    const isSource = SOURCE.test(line) && /readFile|process\.env|\.ssh|credentials/.test(line);
    if (isSource) sourceLines.push(ln);

    // Propagate taint through assignments that mention a tainted variable.
    const parents = [...tainted.entries()].filter(([v]) => mentions(line, v));
    if (target) {
      if (isSource) tainted.set(target, { line: ln, chain: [], origin: { line: ln, variable: target } });
      else if (parents.length) {
        const [, p] = parents[0];
        tainted.set(target, { line: ln, chain: [...p.chain, { line: ln, variable: target }], origin: p.origin });
      }
    }
    if (SINK.test(line)) {
      sinkLines.push(ln);
      for (const [v, t] of tainted) {
        if (mentions(line, v) && v !== target) {
          flows.push({ source: t.origin, via: t.chain, sink: { line: ln, code: raw.trim().slice(0, 160) } });
        }
      }
    }
    // Assignment inside a source line (e.g. `key = fs.readFileSync(...)` after `let key`)
    if (!target && isSource) {
      const m = line.match(/([A-Za-z_$][\w$]*)\s*=\s*[^=]/);
      if (m) tainted.set(m[1], { line: ln, chain: [], origin: { line: ln, variable: m[1] } });
    }
  });

  // One flow per (source, sink) pair.
  const uniq = new Map(flows.map((f) => [`${f.source.line}->${f.sink.line}`, f]));
  return { file: file.path, flows: [...uniq.values()], sourceLines, sinkLines };
}

export function describeCorrelation(r: CorrelationResult): string {
  if (!r.flows.length) {
    return `${r.file}: no data flow found from ${r.sourceLines.length} sensitive source line(s) to ${r.sinkLines.length} network sink line(s)`;
  }
  return r.flows
    .map((f) => {
      const via = f.via.length ? ` via ${f.via.map((v) => `${v.variable} (L${v.line})`).join(" -> ")}` : "";
      return `${r.file}: ${f.source.variable} (L${f.source.line})${via} reaches sink at L${f.sink.line}: ${f.sink.code}`;
    })
    .join("\n");
}
