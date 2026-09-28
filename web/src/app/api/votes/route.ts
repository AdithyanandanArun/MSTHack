import { z } from "zod";
import { json, route } from "@/lib/server/api";
import { chainNow } from "@/lib/server/config";
import { db, nowSec } from "@/lib/server/db";
import { canView, currentViewer, HttpError, requireFinding, requireRoom } from "@/lib/server/queries";
import { enforceLimit } from "@/lib/server/rateLimit";

const Body = z.object({ targetType: z.enum(["finding", "comment"]), targetId: z.number().int().positive() });

/** Upvotes are for visibility and sorting only. They never affect validity, severity or payout. */
export const POST = route(async (req) => {
  const viewer = await currentViewer();
  if (!viewer.address) throw new HttpError(401, "sign in first");
  enforceLimit("vote", req, viewer.address);
  const { targetType, targetId } = Body.parse(await req.json());
  const findingId =
    targetType === "finding"
      ? targetId
      : (db().prepare("SELECT finding_id FROM comments WHERE id = ?").get(targetId) as { finding_id: number } | undefined)?.finding_id;
  if (!findingId) throw new HttpError(404, "not found");
  const f = requireFinding(findingId);
  if (!canView(viewer, requireRoom(f.room_id), f, await chainNow())) throw new HttpError(403, "not visible");
  const d = db();
  const existing = d.prepare("SELECT 1 FROM votes WHERE target_type = ? AND target_id = ? AND voter = ?").get(targetType, targetId, viewer.address);
  if (existing) d.prepare("DELETE FROM votes WHERE target_type = ? AND target_id = ? AND voter = ?").run(targetType, targetId, viewer.address);
  else d.prepare("INSERT INTO votes(target_type, target_id, voter, created_at) VALUES(?, ?, ?, ?)").run(targetType, targetId, viewer.address, nowSec());
  const n = (d.prepare("SELECT COUNT(*) AS n FROM votes WHERE target_type = ? AND target_id = ?").get(targetType, targetId) as { n: number }).n;
  return json({ votes: n, votedByMe: !existing });
});
