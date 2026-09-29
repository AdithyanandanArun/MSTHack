import { z } from "zod";
import { json, route } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { getArtifact, ingestRegistryRelease, ingestUpload } from "@/lib/server/evidence";
import { chainNow } from "@/lib/server/config";
import { HttpError, openRoomNotice } from "@/lib/server/queries";
import { MAX_ARTIFACT_BYTES } from "@/lib/evidence/archive";
import { enforceLimit } from "@/lib/server/rateLimit";

export const maxDuration = 300;

const Registry = z.object({
  ecosystem: z.enum(["npm", "pacman"]),
  name: z.string().trim().min(1).max(214),
  version: z.string().trim().max(128),
});

async function artifactResponse(sha: string, developer: string) {
  const row = getArtifact(sha)!;
  return {
    // Set when this developer already has an open room for the release (see openRoomNotice).
    activeRoom: openRoomNotice(`0x${row.sha256}`, developer, await chainNow()),
    sha256: row.sha256,
    artifactHash: `0x${row.sha256}`,
    ecosystem: row.ecosystem,
    name: row.name,
    version: row.version,
    sourceUrl: row.source_url,
    sourceKind: row.source_kind,
    size: row.size,
    previousSha256: row.previous_sha256,
    metadata: JSON.parse(row.metadata_json),
    diff: row.diff_json ? JSON.parse(row.diff_json) : null,
    scan: row.scan_json ? JSON.parse(row.scan_json) : [],
  };
}

/**
 * Registers an exact release artifact. JSON body -> fetch from the registry;
 * multipart body (file, optional previous, ecosystem) -> uploaded artifact.
 */
export const POST = route(async (req) => {
  const developer = await requireSession();
  enforceLimit("artifact", req, developer);
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      const ecosystem = z.enum(["npm", "pacman"]).parse(form.get("ecosystem"));
      const file = form.get("file");
      if (!(file instanceof File)) throw new HttpError(400, "file is required");
      if (file.size > MAX_ARTIFACT_BYTES) throw new HttpError(413, "artifact too large");
      const prev = form.get("previous");
      const prevBuf = prev instanceof File && prev.size > 0 ? Buffer.from(await prev.arrayBuffer()) : null;
      const row = await ingestUpload(ecosystem, Buffer.from(await file.arrayBuffer()), prevBuf);
      return json(await artifactResponse(row.sha256, developer));
    }
    const body = Registry.parse(await req.json());
    const row = await ingestRegistryRelease(body.ecosystem, body.name, body.version);
    return json(await artifactResponse(row.sha256, developer));
  } catch (e) {
    if (e instanceof HttpError || e instanceof z.ZodError) throw e;
    throw new HttpError(422, e instanceof Error ? e.message : String(e));
  }
});
