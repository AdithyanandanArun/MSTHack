// The analysis agent. It reasons over the release, the rule engine's facts and
// a researcher's claim, asks the rule engine for targeted follow-up tests, and
// produces a structured, *grounded* analysis. It has no authority: it cannot
// mark a finding valid, change severity or move funds.
import Anthropic from "@anthropic-ai/sdk";
import type { Observation } from "@/lib/canonical";
import { OBSERVATION_LABELS } from "@/lib/canonical";
import { correlateFile, describeCorrelation } from "./correlate";
import { fileDiff } from "./diff";
import type { AgentHypothesis, AgentReport, ClaimCheck, Fact, ReleaseArtifact } from "./types";

export interface AgentInput {
  artifact: ReleaseArtifact;
  previous: ReleaseArtifact | null;
  facts: Fact[];
  claims: ClaimCheck[];
  finding?: { title: string; claimedSeverity: string; description: string; proofOfConcept: string; reproduction: string; observations: Observation[] };
  /** Lets the agent request one more sandbox execution. */
  runDynamic?: () => Promise<Fact[]>;
}

export const AGENT_MODEL = process.env.AGENT_MODEL || "claude-sonnet-5";
const MAX_TURNS = 10;

// ---------------------------------------------------------------------------
// Grounding: every evidence reference must resolve to a real fact or file line.
// ---------------------------------------------------------------------------

export function groundRefs(refs: string[], facts: Fact[], artifact: ReleaseArtifact): boolean {
  if (!refs.length) return false;
  const ids = new Set(facts.map((f) => f.id));
  return refs.every((ref) => {
    if (ids.has(ref)) return true;
    const m = ref.match(/^(.+?):(\d+)$/);
    if (!m) return false;
    const file = artifact.files.find((f) => f.path === m[1]);
    return !!file?.text && Number(m[2]) >= 1 && Number(m[2]) <= file.text.split("\n").length;
  });
}

// ---------------------------------------------------------------------------
// Heuristic analyst (no LLM configured). Deterministic and clearly labelled.
// ---------------------------------------------------------------------------

export function heuristicAgent(input: AgentInput): AgentReport {
  const { artifact, facts, claims, finding } = input;
  const hypotheses: AgentHypothesis[] = [];
  const missing: string[] = [];
  const challenges: string[] = [];
  const tests: AgentReport["followUpTests"] = [];
  const transcript: AgentReport["transcript"] = [];

  const byObs = (o: Observation) => facts.filter((f) => f.observation === o);
  const sensitive = byObs("FS_SENSITIVE_READ");
  const network = byObs("NETWORK_EGRESS");
  const dynamicRan = facts.some((f) => f.source === "dynamic") || claims.some((c) => c.dynamicRuns > 0);

  // Correlate sensitive reads with network sinks inside the same file.
  const files = new Set(sensitive.filter((f) => f.source === "static" && f.file).map((f) => f.file!));
  for (const path of files) {
    const file = artifact.files.find((f) => f.path === path);
    if (!file?.text || !network.some((n) => n.file === path || n.source === "dynamic")) continue;
    const result = correlateFile(file);
    const desc = describeCorrelation(result);
    tests.push({ id: `T_CORRELATE:${path}`, reason: `sensitive source and network sink both present in ${path}`, executed: true, result: desc });
    transcript.push({ role: "rule-engine", content: `T_CORRELATE ${path}\n${desc}` });
    if (result.flows.length) {
      const f = result.flows[0];
      hypotheses.push({
        claim: `Data read from a sensitive location in ${path} reaches a network sink (possible exfiltration).`,
        status: "supported",
        evidence: [`${path}:${f.source.line}`, `${path}:${f.sink.line}`, ...sensitive.filter((s) => s.file === path).map((s) => s.id)],
        grounded: true,
      });
    } else {
      hypotheses.push({
        claim: `${path} reads sensitive data and uses the network, but no direct data flow between them was found.`,
        status: "untested",
        evidence: sensitive.filter((s) => s.file === path).map((s) => s.id),
        grounded: true,
      });
    }
  }

  const install = byObs("INSTALL_SCRIPT");
  if (install.length && (sensitive.length || network.length)) {
    hypotheses.push({
      claim: "Install-time code touches sensitive files or the network, so simply installing the release triggers it.",
      status: dynamicRan ? (sensitive.some((f) => f.source === "dynamic") || network.some((f) => f.source === "dynamic") ? "supported" : "unsupported") : "untested",
      evidence: [...install.map((f) => f.id), ...sensitive.slice(0, 2).map((f) => f.id), ...network.slice(0, 2).map((f) => f.id)],
      grounded: true,
    });
    if (!dynamicRan) {
      missing.push("No dynamic execution: install-time behaviour is inferred from code, not observed.");
      tests.push({ id: "T_DYNAMIC_INSTALL", reason: "observe lifecycle scripts in the sandbox", executed: false });
    }
  }

  for (const c of claims) {
    const label = OBSERVATION_LABELS[c.observation];
    if (c.result === "not-observed") {
      challenges.push(`Claim "${label}" was not observed by any rule${c.dynamicRuns ? ` or in ${c.dynamicRuns} sandbox run(s)` : ""}.`);
    } else if (c.result === "inconclusive") {
      challenges.push(
        `Claim "${label}" is inconclusive: observed in ${c.dynamicRunsObserved}/${c.dynamicRuns} sandbox runs${c.staticFacts.length ? ", present in code" : ""}.`,
      );
    }
  }

  if (finding) {
    const text = `${finding.title} ${finding.description}`.toLowerCase();
    const claimsExfil = /exfiltrat|steal|leak|send|upload|sends/.test(text);
    const netDynamic = network.some((f) => f.source === "dynamic");
    if (claimsExfil && sensitive.length && !netDynamic && !hypotheses.some((h) => h.status === "supported" && h.claim.includes("reaches a network sink"))) {
      challenges.push("The evidence confirms a sensitive read but does not prove the data leaves the machine.");
      missing.push("A trace linking the sensitive read to an outbound request (run T_CORRELATE / dynamic install).");
    }
    if ((finding.claimedSeverity === "critical" || finding.claimedSeverity === "high") && !facts.some((f) => f.severity === "high")) {
      challenges.push(`Claimed severity '${finding.claimedSeverity}' is not backed by any high-severity observable fact.`);
    }
    if (!finding.reproduction.trim()) missing.push("The report has no reproduction steps.");
    if (!finding.observations.length) missing.push("The report does not declare any machine-checkable observations.");
  }

  const high = facts.filter((f) => f.severity === "high");
  const summary = finding
    ? `Checked ${claims.length} claimed observation(s) against ${facts.length} deterministic facts. ` +
      `${claims.filter((c) => c.result === "confirmed").length} confirmed, ${claims.filter((c) => c.result === "not-observed").length} not observed, ` +
      `${claims.filter((c) => c.result === "inconclusive").length} inconclusive.`
    : high.length
      ? `${high.length} high-severity fact(s) worth investigating: ${[...new Set(high.map((f) => f.detail))].slice(0, 3).join("; ")}.`
      : "No high-severity observable behaviour found by the deterministic rules. This is not a statement that the release is safe.";

  return {
    mode: "heuristic",
    model: null,
    summary,
    hypotheses,
    missingEvidence: missing,
    challenges,
    followUpTests: tests,
    transcript,
  };
}

// ---------------------------------------------------------------------------
// Claude-backed agent with rule-engine tools.
// ---------------------------------------------------------------------------

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_files",
    description: "List files in the release (path and size). Optionally filter by path prefix.",
    input_schema: { type: "object", properties: { prefix: { type: "string" } } },
  },
  {
    name: "read_file",
    description: "Read numbered lines from a text file in the release. Max 200 lines per call.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, start_line: { type: "integer" }, end_line: { type: "integer" } },
      required: ["path"],
    },
  },
  {
    name: "search",
    description: "Regex search across all text files. Returns up to 40 path:line matches.",
    input_schema: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
  },
  {
    name: "show_diff",
    description: "Show lines added/removed in a file compared with the previous release.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "run_test",
    description:
      "Ask the deterministic rule engine to execute a test. T_CORRELATE (arg: file path) traces whether data from a sensitive source reaches a network sink. T_DYNAMIC_INSTALL (no arg) runs the install lifecycle in the no-network sandbox and returns observed facts.",
    input_schema: {
      type: "object",
      properties: { test_id: { type: "string", enum: ["T_CORRELATE", "T_DYNAMIC_INSTALL"] }, arg: { type: "string" } },
      required: ["test_id"],
    },
  },
  {
    name: "submit_analysis",
    description:
      "Submit the final analysis. Every hypothesis must cite evidence as fact ids (e.g. S4, D1.2) or file:line references. Be adversarial: say when evidence is missing or contradicts the claim.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        hypotheses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              claim: { type: "string" },
              status: { type: "string", enum: ["supported", "unsupported", "contradicted", "untested"] },
              evidence: { type: "array", items: { type: "string" } },
            },
            required: ["claim", "status", "evidence"],
          },
        },
        missing_evidence: { type: "array", items: { type: "string" } },
        challenges: { type: "array", items: { type: "string" } },
        follow_up_tests: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id", "reason"] },
        },
      },
      required: ["summary", "hypotheses", "missing_evidence", "challenges", "follow_up_tests"],
    },
  },
];

const SYSTEM = `You are the ReleaseBond evidence analyst. You investigate one exact software release (and optionally a researcher's security claim) together with a deterministic rule engine.

Rules:
- You investigate; the rule engine establishes facts; humans adjudicate. You never declare a finding valid, assign payouts or final severity.
- Be adversarial in both directions: look for behaviour the rules missed, and challenge claims the evidence does not support (e.g. a sensitive read is not proof of exfiltration).
- Every hypothesis must cite concrete evidence: fact ids from the rule engine or file:line references you have read. Uncited claims are discarded.
- Prefer running a targeted test (run_test) over speculation. Deterministic results override your intuition.
- Finish by calling submit_analysis exactly once.`;

function textOf(file: { text?: string }, start = 1, end = start + 199): string {
  const lines = (file.text ?? "").split("\n");
  const s = Math.max(1, start);
  const e = Math.min(lines.length, end, s + 199);
  return lines
    .slice(s - 1, e)
    .map((l, i) => `${s + i}: ${l.slice(0, 400)}`)
    .join("\n");
}

async function claudeAgent(input: AgentInput): Promise<AgentReport> {
  const client = new Anthropic();
  const { artifact, previous, finding } = input;
  const facts = [...input.facts];
  const transcript: AgentReport["transcript"] = [];
  const executed: AgentReport["followUpTests"] = [];

  const factLines = facts
    .slice(0, 150)
    .map((f) => `${f.id} [${f.source}/${f.severity}] ${f.observation ?? f.category} ${f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : ""} - ${f.detail}`)
    .join("\n");
  const claimLines = input.claims
    .map((c) => `${c.observation}: ${c.result} (static facts: ${c.staticFacts.join(", ") || "none"}; sandbox ${c.dynamicRunsObserved}/${c.dynamicRuns})`)
    .join("\n");

  const intro = [
    `Release: ${artifact.ecosystem} ${artifact.name}@${artifact.version} sha256:${artifact.sha256}`,
    previous ? `Previous release: ${previous.version} (diff available via show_diff)` : "No previous release available.",
    `Install hooks: ${JSON.stringify(artifact.installScripts)}`,
    `Dependencies: ${JSON.stringify(artifact.dependencies)}`,
    `Files: ${artifact.files.length}`,
    "",
    "Deterministic facts:",
    factLines || "(none)",
    finding
      ? `\nResearcher claim:\nTitle: ${finding.title}\nClaimed severity: ${finding.claimedSeverity}\nDeclared observations: ${finding.observations.join(", ") || "none"}\n\nDescription:\n${finding.description.slice(0, 4000)}\n\nProof of concept:\n${finding.proofOfConcept.slice(0, 3000)}\n\nReproduction:\n${finding.reproduction.slice(0, 2000)}\n\nClaim checks:\n${claimLines}`
      : "\nNo researcher claim: produce a release triage (what should researchers investigate?).",
  ].join("\n");

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: intro }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      tools: TOOLS,
      tool_choice: turn === MAX_TURNS - 1 ? { type: "tool", name: "submit_analysis" } : { type: "auto" },
      messages,
    });
    messages.push({ role: "assistant", content: res.content });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
    if (text.trim()) transcript.push({ role: "agent", content: text.trim().slice(0, 2000) });

    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!uses.length) {
      messages.push({ role: "user", content: "Call submit_analysis with your grounded conclusions." });
      continue;
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const args = (use.input ?? {}) as Record<string, unknown>;
      if (use.name === "submit_analysis") {
        const hyps = ((args.hypotheses as AgentHypothesis[]) ?? []).map((h) => ({
          claim: String(h.claim),
          status: h.status,
          evidence: (h.evidence ?? []).map(String),
          grounded: groundRefs((h.evidence ?? []).map(String), facts, artifact),
        }));
        const proposed = ((args.follow_up_tests as { id: string; reason: string }[]) ?? []).map((t) => ({
          id: String(t.id),
          reason: String(t.reason),
          executed: false,
        }));
        return {
          mode: "claude",
          model: AGENT_MODEL,
          summary: String(args.summary ?? ""),
          hypotheses: hyps,
          missingEvidence: ((args.missing_evidence as string[]) ?? []).map(String),
          challenges: ((args.challenges as string[]) ?? []).map(String),
          followUpTests: [...executed, ...proposed],
          transcript,
        };
      }
      let out: string;
      try {
        out = await runTool(use.name, args, input, facts, executed);
      } catch (e) {
        out = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (use.name === "run_test") transcript.push({ role: "rule-engine", content: out.slice(0, 2000) });
      results.push({ type: "tool_result", tool_use_id: use.id, content: out.slice(0, 12_000) });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("agent did not submit an analysis");
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  input: AgentInput,
  facts: Fact[],
  executed: AgentReport["followUpTests"],
): Promise<string> {
  const { artifact, previous } = input;
  switch (name) {
    case "list_files": {
      const prefix = String(args.prefix ?? "");
      return artifact.files
        .filter((f) => f.path.startsWith(prefix))
        .slice(0, 300)
        .map((f) => `${f.path} (${f.size}b${f.binary ? ", binary" : ""})`)
        .join("\n");
    }
    case "read_file": {
      const f = artifact.files.find((x) => x.path === args.path);
      if (!f) return "no such file";
      if (!f.text) return "binary or too large to display";
      return textOf(f, Number(args.start_line ?? 1), Number(args.end_line ?? Number(args.start_line ?? 1) + 199));
    }
    case "search": {
      let re: RegExp;
      try {
        re = new RegExp(String(args.pattern), "i");
      } catch {
        return "invalid regex";
      }
      const hits: string[] = [];
      for (const f of artifact.files) {
        if (!f.text) continue;
        f.text.split("\n").forEach((l, i) => {
          if (hits.length < 40 && l.length < 5000 && re.test(l)) hits.push(`${f.path}:${i + 1}: ${l.trim().slice(0, 200)}`);
        });
      }
      return hits.join("\n") || "no matches";
    }
    case "show_diff":
      return fileDiff(previous, artifact, String(args.path));
    case "run_test": {
      if (args.test_id === "T_CORRELATE") {
        const f = artifact.files.find((x) => x.path === args.arg);
        if (!f?.text) return "T_CORRELATE needs a text file path from list_files";
        const r = describeCorrelation(correlateFile(f));
        executed.push({ id: `T_CORRELATE:${f.path}`, reason: "requested by agent", executed: true, result: r });
        return r;
      }
      if (args.test_id === "T_DYNAMIC_INSTALL") {
        if (!input.runDynamic) return "dynamic sandbox is not available in this deployment";
        if (executed.some((t) => t.id === "T_DYNAMIC_INSTALL")) return "already executed once in this analysis";
        const newFacts = await input.runDynamic();
        facts.push(...newFacts);
        const r = newFacts.map((f) => `${f.id} ${f.observation ?? f.category}: ${f.detail}`).join("\n") || "no observable behaviour";
        executed.push({ id: "T_DYNAMIC_INSTALL", reason: "requested by agent", executed: true, result: r });
        return r;
      }
      return "unknown test";
    }
    default:
      return "unknown tool";
  }
}

export async function runAgent(input: AgentInput): Promise<AgentReport> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await claudeAgent(input);
    } catch (e) {
      const fallback = heuristicAgent(input);
      fallback.transcript.unshift({ role: "agent", content: `Claude agent failed (${e instanceof Error ? e.message : e}); heuristic analyst used instead.` });
      return fallback;
    }
  }
  return heuristicAgent(input);
}
