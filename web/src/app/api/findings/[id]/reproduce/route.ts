import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { chainNow } from "@/lib/server/config";
import { enqueueEvidence, pendingRunFor, queuePosition } from "@/lib/server/evidenceQueue";
import { canView, currentViewer, HttpError, requireFinding, requireRoom } from "@/lib/server/queries";
import { enforceLimit } from "@/lib/server/rateLimit";

/**
 * Queues the Agent + Rule evidence engine against the room's exact artifact
 * and the finding's declared observations. Poll GET /api/evidence/:id for the
 * result. The result is evidence for reviewers, never a verdict.
 */
export const POST = route(async (req, ctx: IdParams) => {
  const viewer = await currentViewer();
  if (!viewer.address) throw new HttpError(401, "sign in first");
  enforceLimit("evidence", req, viewer.address);
  const f = requireFinding(await idParam(ctx));
  const room = requireRoom(f.room_id);
  if (!canView(viewer, room, f, await chainNow())) throw new HttpError(403, "you cannot see this finding yet");
  const pending = pendingRunFor(viewer.address);
  if (pending) throw new HttpError(429, `you already have evidence run #${pending.id} ${pending.status}; wait for it to finish`);
  const id = enqueueEvidence({ roomId: room.id, findingId: f.id, requestedBy: viewer.address });
  return json({ id, status: "queued", queuePosition: queuePosition(id) }, 202);
});
