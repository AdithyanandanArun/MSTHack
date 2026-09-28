import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { chainNow } from "@/lib/server/config";
import { kick, queuePosition } from "@/lib/server/evidenceQueue";
import { canView, currentViewer, evidenceRun, HttpError, requireFinding, requireRoom } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

/** Status and (once done) the full report of an evidence run. Clients poll this. */
export const GET = route(async (_req, ctx: IdParams) => {
  const run = evidenceRun(await idParam(ctx));
  if (!run) throw new HttpError(404, "not found");
  if (run.finding_id) {
    const f = requireFinding(run.finding_id);
    if (!canView(await currentViewer(), requireRoom(f.room_id), f, await chainNow())) throw new HttpError(403, "not visible yet");
  }
  if (run.status === "queued") kick(); // resumes the queue after a server restart
  return json({
    id: run.id,
    roomId: run.room_id,
    findingId: run.finding_id,
    status: run.status,
    queuePosition: queuePosition(run.id),
    outcome: run.outcome,
    reportHash: run.report_hash,
    error: run.error,
    createdAt: run.created_at,
    finishedAt: run.finished_at,
    report: run.report_json ? JSON.parse(run.report_json) : null,
  });
});
