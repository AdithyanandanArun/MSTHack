import type { Phase } from "@/lib/phase";

export interface AppealEligibilityResult {
  ok: boolean;
  reason?: string;
}

interface AppealRoom {
  developer: string;
  moderator: string;
}

interface AppealFinding {
  author: string;
  status: string;
  verdict: string | null;
}

interface ExistingAppeal {
  appellant: string;
  status: string;
}

const sameAddress = (left: string | null, right: string) => left?.toLowerCase() === right.toLowerCase();

export function canFileAppeal({
  address,
  room,
  finding,
  phase,
  existingAppeal,
}: {
  address: string | null;
  room: AppealRoom;
  finding: AppealFinding;
  phase: Phase;
  existingAppeal: unknown | null;
}): AppealEligibilityResult {
  if (!address) return { ok: false, reason: "sign in first" };
  if (!sameAddress(address, finding.author) && !sameAddress(address, room.developer)) {
    return { ok: false, reason: "only the finding author or room developer may appeal" };
  }
  if (finding.status !== "committed" || !finding.verdict) {
    return { ok: false, reason: "only an adjudicated committed finding may be appealed" };
  }
  if (phase !== "review") return { ok: false, reason: "appeals may only be filed during peer review" };
  if (existingAppeal !== null && existingAppeal !== undefined) {
    return { ok: false, reason: "an appeal has already been filed for this finding" };
  }
  return { ok: true };
}

export function canDecideAppeal({
  address,
  isModerator,
  room,
  finding,
  appeal,
  phase,
}: {
  address: string | null;
  isModerator: boolean;
  room: AppealRoom;
  finding: AppealFinding;
  appeal: ExistingAppeal | null;
  phase: Phase;
}): AppealEligibilityResult {
  if (!address) return { ok: false, reason: "sign in first" };
  if (!isModerator) return { ok: false, reason: "only a registered moderator may decide an appeal" };
  if (
    sameAddress(address, room.moderator) ||
    (appeal && sameAddress(address, appeal.appellant)) ||
    sameAddress(address, finding.author) ||
    sameAddress(address, room.developer)
  ) {
    return { ok: false, reason: "a conflicted moderator may not decide this appeal" };
  }
  if (!appeal || appeal.status !== "open") return { ok: false, reason: "only an open appeal may be decided" };
  if (phase !== "review") return { ok: false, reason: "appeals may only be decided during peer review" };
  return { ok: true };
}
