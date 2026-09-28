import type { Phase } from "@/lib/phase";
import { COMMENT_KIND_LABEL, PHASE_LABEL, type CommentKind } from "@/lib/phase";

type Tone = "accent" | "success" | "danger" | "attention" | "done" | "severe" | "muted";

const TONE: Record<Tone, React.CSSProperties> = {
  accent: { color: "var(--accent)", borderColor: "var(--accent)", background: "var(--accent-subtle)" },
  success: { color: "var(--success)", borderColor: "var(--success)", background: "var(--success-subtle)" },
  danger: { color: "var(--danger)", borderColor: "var(--danger)", background: "var(--danger-subtle)" },
  attention: { color: "var(--attention)", borderColor: "var(--attention)", background: "var(--attention-subtle)" },
  done: { color: "var(--done)", borderColor: "var(--done)", background: "var(--done-subtle)" },
  severe: { color: "var(--severe)", borderColor: "var(--severe)", background: "var(--severe-subtle)" },
  muted: { color: "var(--fg-muted)", borderColor: "var(--border)", background: "transparent" },
};

export function Label({ tone = "muted", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span className="label" style={TONE[tone]} title={title}>
      {children}
    </span>
  );
}

const PHASE_TONE: Record<Phase, Tone> = {
  hunting: "success",
  disclosure: "attention",
  review: "accent",
  expired: "danger",
  settled: "done",
  refunded: "muted",
};

export function PhaseBadge({ phase, large }: { phase: Phase; large?: boolean }) {
  const style = TONE[PHASE_TONE[phase]];
  if (!large) return <Label tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Label>;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold text-white"
      style={{ background: style.color as string }}
    >
      {PHASE_LABEL[phase]}
    </span>
  );
}

const SEV_TONE: Record<string, Tone> = { critical: "danger", high: "severe", medium: "attention", low: "muted" };

export function SeverityLabel({ severity, prefix }: { severity: string | null; prefix?: string }) {
  if (!severity) return null;
  return (
    <Label tone={SEV_TONE[severity] ?? "muted"}>
      {prefix ? `${prefix}: ` : ""}
      {severity}
    </Label>
  );
}

const VERDICT_TONE: Record<string, Tone> = { valid: "success", duplicate: "done", invalid: "danger", inconclusive: "attention" };

export function VerdictLabel({ verdict }: { verdict: string | null }) {
  if (!verdict) return <Label tone="muted">awaiting adjudication</Label>;
  return <Label tone={VERDICT_TONE[verdict] ?? "muted"}>{verdict.toUpperCase()}</Label>;
}

const KIND_TONE: Record<CommentKind, Tone> = {
  COMMENT: "muted",
  REPRODUCED: "success",
  PARTIALLY_REPRODUCED: "attention",
  REFUTED: "danger",
  ADDITIONAL_EVIDENCE: "accent",
  DUPLICATE: "done",
  SEVERITY_CHALLENGE: "severe",
  CONDITION: "attention",
  DEVELOPER_RESPONSE: "accent",
  MODERATOR_NOTE: "done",
};

export function KindLabel({ kind }: { kind: CommentKind }) {
  if (kind === "COMMENT") return null;
  return <Label tone={KIND_TONE[kind]}>{COMMENT_KIND_LABEL[kind]}</Label>;
}

const OUTCOME_TONE: Record<string, Tone> = {
  REPRODUCED: "success",
  PARTIALLY_REPRODUCED: "attention",
  NOT_REPRODUCED: "danger",
  INCONCLUSIVE: "attention",
};

export function OutcomeLabel({ outcome }: { outcome: string | null }) {
  if (!outcome) return null;
  return <Label tone={OUTCOME_TONE[outcome] ?? "muted"}>{outcome.replace(/_/g, " ")}</Label>;
}
