import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { prepareSettlement, settlementPreview } from "@/lib/server/findings";
import { frozenSettlement, panelApprovals } from "@/lib/server/panel";
import { roomPanel } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx: IdParams) => {
  const roomId = await idParam(ctx);
  const p = await settlementPreview(roomId);
  const panel = roomPanel(roomId);
  const frozen = frozenSettlement(roomId);
  return json({
    panel: panel ? { ...panel, frozen, approvals: frozen ? panelApprovals(roomId, frozen.adjudicationHash) : [] } : null,
    phase: p.phase,
    plan: p.plan,
    pendingVerdicts: p.pendingVerdicts,
    findings: p.findings,
    adjudicationHash: p.room.adjudication_hash,
    adjudicationRecord: p.room.adjudication_json ? JSON.parse(p.room.adjudication_json) : null,
  });
});

export const POST = route(async (_req, ctx: IdParams) => {
  const moderator = await requireSession();
  return json(await prepareSettlement(await idParam(ctx), moderator));
});
