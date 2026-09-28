import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { db, nowSec } from "@/lib/server/db";
import { enqueueEvidence, pendingRunFor, queuePosition } from "@/lib/server/evidenceQueue";
import { currentViewer, HttpError, requireRoom } from "@/lib/server/queries";
import { enforceLimit } from "@/lib/server/rateLimit";

export const dynamic = "force-dynamic";

function latest(roomId: number) {
  return db()
    .prepare("SELECT * FROM evidence_runs WHERE room_id = ? AND finding_id IS NULL AND status = 'done' ORDER BY id DESC LIMIT 1")
    .get(roomId) as { id: number; report_json: string; report_hash: string; created_at: number } | undefined;
}

export const GET = route(async (_req, ctx: IdParams) => {
  const room = requireRoom(await idParam(ctx));
  const run = latest(room.id);
  return json(run ? { id: run.id, status: "done", reportHash: run.report_hash, createdAt: run.created_at, report: JSON.parse(run.report_json) } : null);
});

/** Release triage: rules + sandbox + agent over the release itself (no researcher claim). Queued; poll /api/evidence/:id. */
export const POST = route(async (req, ctx: IdParams) => {
  const viewer = await currentViewer();
  if (!viewer.address) throw new HttpError(401, "sign in first");
  enforceLimit("evidence", req, viewer.address);
  const room = requireRoom(await idParam(ctx));
  const prev = latest(room.id);
  const privileged = viewer.address === room.developer || viewer.address === room.moderator;
  if (prev && nowSec() - prev.created_at < 3600 && !privileged) {
    return json({ id: prev.id, status: "done", reportHash: prev.report_hash, createdAt: prev.created_at, report: JSON.parse(prev.report_json), cached: true });
  }
  const pending = pendingRunFor(viewer.address);
  if (pending) throw new HttpError(429, `you already have evidence run #${pending.id} ${pending.status}; wait for it to finish`);
  const id = enqueueEvidence({ roomId: room.id, findingId: null, requestedBy: viewer.address });
  return json({ id, status: "queued", queuePosition: queuePosition(id) }, 202);
});
