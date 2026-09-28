import fs from "node:fs";
import { json, route } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { dataPath, db, nowSec } from "@/lib/server/db";
import { sha256Hex } from "@/lib/evidence/archive";
import { HttpError } from "@/lib/server/queries";
import { enforceLimit } from "@/lib/server/rateLimit";

const MAX_UPLOAD = 20 * 1024 * 1024;

/** Proof files (logs, PoC scripts, screenshots). Their sha256 is bound into the finding hash. */
export const POST = route(async (req) => {
  const uploader = await requireSession();
  enforceLimit("upload", req, uploader);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "file is required");
  if (file.size === 0 || file.size > MAX_UPLOAD) throw new HttpError(413, "file must be between 1 byte and 20 MB");
  const quota = Number(process.env.RELEASEBOND_UPLOAD_QUOTA_BYTES || 200 * 1024 * 1024);
  const used = (db().prepare("SELECT COALESCE(SUM(size), 0) AS n FROM attachments WHERE uploader = ?").get(uploader) as { n: number }).n;
  if (used + file.size > quota) {
    throw new HttpError(413, `upload quota reached (${Math.round(used / 1024)} KB of ${Math.round(quota / 1024)} KB used)`);
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const sha = sha256Hex(buf);
  const filename = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "upload";
  const d = db();
  const id = Number(
    d
      .prepare("INSERT INTO attachments(uploader, filename, mime, size, sha256, storage_path, created_at) VALUES(?, ?, ?, ?, ?, '', ?)")
      .run(uploader, filename, file.type || "application/octet-stream", buf.length, sha, nowSec()).lastInsertRowid,
  );
  const p = dataPath("uploads", `${id}-${sha}`);
  fs.writeFileSync(p, buf);
  d.prepare("UPDATE attachments SET storage_path = ? WHERE id = ?").run(p, id);
  return json({ id, filename, size: buf.length, sha256: sha, mime: file.type }, 201);
});
