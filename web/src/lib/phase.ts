// Room phase and permission rules. Pure functions shared by server and client;
// they mirror ReleaseBond.phaseOf so the UI never disagrees with the contract.

export type Phase = "hunting" | "disclosure" | "review" | "expired" | "settled" | "refunded";

export interface RoomTiming {
  status: string; // active | settled | refunded
  hunt_ends_at: number;
  disclosure_ends_at: number;
  adjudication_deadline: number;
}

export function phaseOf(room: RoomTiming, now: number): Phase {
  if (room.status === "settled") return "settled";
  if (room.status === "refunded") return "refunded";
  if (now < room.hunt_ends_at) return "hunting";
  if (now < room.disclosure_ends_at) return "disclosure";
  if (now <= room.adjudication_deadline) return "review";
  return "expired";
}

export const PHASE_LABEL: Record<Phase, string> = {
  hunting: "Hunting",
  disclosure: "Private disclosure",
  review: "Peer review",
  expired: "Adjudication expired",
  settled: "Settled",
  refunded: "Refunded",
};

export const PHASE_HELP: Record<Phase, string> = {
  hunting: "Researchers work independently. Findings stay private; only hash commitments are public.",
  disclosure: "Hunt closed. The developer and moderator see committed findings and can patch before public review.",
  review: "Findings are open to adversarial peer review: reproduce, refute, add evidence, challenge severity.",
  expired: "The moderator missed the adjudication deadline. Anyone can return the pool to the developer.",
  settled: "The moderator adjudicated and the contract distributed the bounty.",
  refunded: "The pool was returned to the developer.",
};

export interface Viewer {
  address: string | null;
  isModerator: boolean;
}

export interface FindingAccessContext {
  room: RoomTiming & { developer: string; moderator: string };
  finding: { author: string; status: string };
  now: number;
}

/** Who may read a finding's full report. */
export function canViewFinding(viewer: Viewer, ctx: FindingAccessContext): boolean {
  const a = viewer.address;
  const { room, finding } = ctx;
  if (a && a === finding.author) return true;
  if (finding.status !== "committed") return false; // drafts are private forever
  const phase = phaseOf(room, ctx.now);
  if (phase === "hunting") return false;
  if (phase === "disclosure") return !!a && (a === room.developer || a === room.moderator);
  if (phase === "settled" || phase === "refunded") return true; // public disclosure
  return !!a; // peer review: any signed-in researcher
}

export const COMMENT_KINDS = [
  "COMMENT",
  "REPRODUCED",
  "PARTIALLY_REPRODUCED",
  "REFUTED",
  "ADDITIONAL_EVIDENCE",
  "DUPLICATE",
  "SEVERITY_CHALLENGE",
  "CONDITION",
  "DEVELOPER_RESPONSE",
  "MODERATOR_NOTE",
] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export const COMMENT_KIND_LABEL: Record<CommentKind, string> = {
  COMMENT: "Comment",
  REPRODUCED: "Reproduced",
  PARTIALLY_REPRODUCED: "Partially reproduced",
  REFUTED: "Refutation",
  ADDITIONAL_EVIDENCE: "Additional evidence",
  DUPLICATE: "Duplicate",
  SEVERITY_CHALLENGE: "Severity challenge",
  CONDITION: "Condition / edge case",
  DEVELOPER_RESPONSE: "Developer response",
  MODERATOR_NOTE: "Moderator note",
};

/** Which comment kinds a viewer may post on a finding right now (empty = none). */
export function allowedCommentKinds(viewer: Viewer, ctx: FindingAccessContext): CommentKind[] {
  const a = viewer.address;
  if (!a || !canViewFinding(viewer, ctx)) return [];
  const { room } = ctx;
  const phase = phaseOf(room, ctx.now);
  const isDev = a === room.developer;
  const isMod = a === room.moderator || viewer.isModerator;
  if (phase === "hunting") return [];
  if (phase === "disclosure") {
    if (isDev) return ["COMMENT", "DEVELOPER_RESPONSE"];
    if (a === room.moderator) return ["COMMENT", "MODERATOR_NOTE"];
    if (a === ctx.finding.author) return ["COMMENT", "ADDITIONAL_EVIDENCE"];
    return [];
  }
  if (phase === "review") {
    if (isDev) return ["COMMENT", "DEVELOPER_RESPONSE", "REFUTED", "CONDITION", "SEVERITY_CHALLENGE"];
    if (a === room.moderator) return ["COMMENT", "MODERATOR_NOTE"];
    const kinds: CommentKind[] = [
      "COMMENT",
      "REPRODUCED",
      "PARTIALLY_REPRODUCED",
      "REFUTED",
      "ADDITIONAL_EVIDENCE",
      "DUPLICATE",
      "SEVERITY_CHALLENGE",
      "CONDITION",
    ];
    if (isMod) kinds.push("MODERATOR_NOTE");
    return kinds;
  }
  // Settled / refunded / expired: discussion only.
  return ["COMMENT"];
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
