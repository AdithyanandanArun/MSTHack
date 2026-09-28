import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { chainNow } from "@/lib/server/config";
import { canView, currentViewer, evidenceRun, HttpError, requireFinding, requireRoom } from "@/lib/server/queries";

export const GET = route(async (_req, ctx: IdParams) => {
  const run = evidenceRun(await idParam(ctx));
  if (!run) throw new HttpError(404, "not found");
  if (run.finding_id) {
    const f = requireFinding(run.finding_id);
    if (!canView(await currentViewer(), requireRoom(f.room_id), f, await chainNow())) throw new HttpError(403, "not visible yet");
  }
  return json({ ...run, report_json: undefined, report: run.report_json ? JSON.parse(run.report_json) : null });
});
