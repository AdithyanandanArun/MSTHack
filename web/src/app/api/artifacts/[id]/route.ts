import { json, route } from "@/lib/server/api";
import { getArtifact } from "@/lib/server/evidence";
import { HttpError } from "@/lib/server/queries";

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(id)) throw new HttpError(400, "expected a sha256 hex digest");
  const row = getArtifact(id);
  if (!row) throw new HttpError(404, "artifact not registered");
  return json({
    sha256: row.sha256,
    ecosystem: row.ecosystem,
    name: row.name,
    version: row.version,
    sourceUrl: row.source_url,
    size: row.size,
    previousSha256: row.previous_sha256,
    metadata: JSON.parse(row.metadata_json),
    diff: row.diff_json ? JSON.parse(row.diff_json) : null,
    scan: row.scan_json ? JSON.parse(row.scan_json) : [],
  });
});
