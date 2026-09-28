import type { Observation } from "@/lib/canonical";

export type Ecosystem = "npm" | "pacman";

export interface ArtifactFile {
  path: string; // normalized, package-root relative (npm strips "package/")
  size: number;
  sha256: string;
  mode: number;
  /** UTF-8 content for text files under the capture limit. */
  text?: string;
  binary: boolean;
}

/** Normalized release model shared by every ecosystem adapter. */
export interface ReleaseArtifact {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  artifactHash: string; // "sha256:<hex>"
  sha256: string; // hex
  size: number;
  sourceUrl: string | null;
  sourceKind: "registry" | "upload";
  /** Registry-published integrity (npm dist.integrity / Arch sha256sum) and whether it matched. */
  registryIntegrity: { value: string; verified: boolean } | null;
  dependencies: Record<string, string>;
  /** Install-time hooks: npm lifecycle scripts, pacman .INSTALL functions. */
  installScripts: Record<string, string>;
  metadata: Record<string, unknown>;
  previousVersion: string | null;
  files: ArtifactFile[];
}

export type ArtifactSummary = Omit<ReleaseArtifact, "files"> & {
  fileCount: number;
  files: Omit<ArtifactFile, "text">[];
};

export type FactCategory =
  | "integrity"
  | "install-script"
  | "network"
  | "filesystem"
  | "process"
  | "environment"
  | "code-exec"
  | "obfuscation"
  | "persistence"
  | "permissions"
  | "metadata";

export type FactSeverity = "info" | "low" | "medium" | "high";

/** One objective observation made by a deterministic rule. */
export interface Fact {
  id: string; // stable within a report, e.g. "S3" (static) or "D1.4" (dynamic run 1)
  rule: string;
  category: FactCategory;
  severity: FactSeverity;
  observation: Observation | null;
  source: "static" | "dynamic";
  file?: string;
  line?: number;
  snippet?: string;
  detail: string;
}

export interface DiffSummary {
  previousVersion: string;
  previousSha256: string;
  added: string[];
  removed: string[];
  changed: string[];
  linesAdded: number;
  linesRemoved: number;
  dependenciesAdded: Record<string, string>;
  dependenciesRemoved: Record<string, string>;
  dependenciesChanged: Record<string, { from: string; to: string }>;
  installScriptsChanged: string[];
}

export interface DynamicRun {
  run: number;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  command: string;
  facts: Fact[];
  error?: string;
}

export interface AgentHypothesis {
  claim: string;
  status: "supported" | "unsupported" | "contradicted" | "untested";
  evidence: string[]; // fact ids or file:line refs
  grounded: boolean; // every reference resolved to a real fact / file
}

export interface AgentReport {
  mode: "claude" | "heuristic";
  model: string | null;
  summary: string;
  hypotheses: AgentHypothesis[];
  missingEvidence: string[];
  challenges: string[];
  followUpTests: { id: string; reason: string; executed: boolean; result?: string }[];
  transcript: { role: "agent" | "rule-engine"; content: string }[];
}

export type Outcome = "REPRODUCED" | "PARTIALLY_REPRODUCED" | "NOT_REPRODUCED" | "INCONCLUSIVE";

export interface ClaimCheck {
  observation: Observation;
  staticFacts: string[];
  dynamicRunsObserved: number;
  dynamicRuns: number;
  /** What the verdict rests on: sandbox observation, code-level rules, or nothing. */
  basis: "dynamic" | "static" | "none";
  result: "confirmed" | "not-observed" | "inconclusive";
}

export interface EvidenceReport {
  version: 1;
  generatedAt: string;
  artifact: { ecosystem: Ecosystem; name: string; version: string; sha256: string; verified: boolean };
  environment: string;
  staticFacts: Fact[];
  dynamic: { enabled: boolean; reason?: string; runs: DynamicRun[] };
  claims: ClaimCheck[];
  outcome: Outcome | null; // null for a release scan (no claims)
  confidence: "SUSPICIOUS" | "REPRODUCED_EVIDENCE" | "NONE";
  agent: AgentReport;
}
