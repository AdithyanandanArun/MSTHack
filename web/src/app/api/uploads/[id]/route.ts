import fs from "node:fs";
import { idParam, route, type IdParams } from "@/lib/server/api";
import { chainNow } from "@/lib/server/config";
import { db } from "@/lib/server/db";
import { canView, currentViewer, HttpError, requireFinding, requireRoom, type AttachmentRow } from "@/lib/server/queries";

const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export const GET = route(async (_req, ctx: IdParams) => {
  const a = db().prepare("SELECT * FROM attachments WHERE id = ?").get(await idParam(ctx)) as AttachmentRow | undefined;
  if (!a) throw new HttpError(404, "not found");
  const viewer = await currentViewer();
  let findingId = a.finding_id;
  if (!findingId && a.comment_id) {
    findingId = (db().prepare("SELECT finding_id FROM comments WHERE id = ?").get(a.comment_id) as { finding_id: number }).finding_id;
  }
  if (findingId) {
    const f = requireFinding(findingId);
    if (!canView(viewer, requireRoom(f.room_id), f, await chainNow())) throw new HttpError(403, "not visible yet");
  } else if (viewer.address !== a.uploader) {
    throw new HttpError(403, "not visible");
  }
  const inline = INLINE.has(a.mime);
  return new Response(fs.readFileSync(a.storage_path), {
    headers: {
      // Never let an upload render as HTML/JS on our origin.
      "content-type": inline ? a.mime : "text/plain; charset=utf-8",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${a.filename}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; sandbox",
      "x-sha256": a.sha256,
    },
  });
});
