import { z } from "zod";
import { json, route } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { contractInfo } from "@/lib/server/config";
import { db, nowSec } from "@/lib/server/db";
import { getArtifact } from "@/lib/server/evidence";
import { HttpError, isModerator } from "@/lib/server/queries";
import { enforceLimit } from "@/lib/server/rateLimit";

const Body = z.object({
  artifactSha256: z.string().regex(/^[0-9a-f]{64}$/),
  title: z.string().trim().max(140).optional(),
  description: z.string().max(10_000).optional(),
  moderator: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

/**
 * Stores the room's off-chain description and returns the exact createRoom
 * arguments. The room itself only exists once the funded transaction lands.
 */
export const POST = route(async (req) => {
  const developer = await requireSession();
  enforceLimit("roomDraft", req, developer);
  const body = Body.parse(await req.json());
  const { address } = contractInfo();
  if (!address) throw new HttpError(503, "ReleaseBond contract is not configured yet (see /admin)");
  const art = getArtifact(body.artifactSha256);
  if (!art) throw new HttpError(404, "register the artifact first");
  const moderator = body.moderator.toLowerCase();
  if (!isModerator(moderator)) throw new HttpError(400, "not a registered moderator");
  if (moderator === developer) throw new HttpError(400, "you cannot moderate your own release");
  const active = db().prepare("SELECT id FROM rooms WHERE artifact_hash = ? AND developer = ? AND status = 'active'").get(`0x${art.sha256}`, developer) as
    | { id: number }
    | undefined;
  if (active) throw new HttpError(409, `you already have an active room for this exact artifact (#${active.id})`);

  db()
    .prepare(
      `INSERT INTO room_drafts(artifact_sha256, developer, title, description, created_at) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(artifact_sha256, developer) DO UPDATE SET title = excluded.title, description = excluded.description`,
    )
    .run(art.sha256, developer, body.title ?? null, body.description ?? null, nowSec());

  return json({
    contract: address,
    params: {
      ecosystem: art.ecosystem,
      packageName: art.name,
      version: art.version,
      artifactHash: `0x${art.sha256}`,
      previousArtifactHash: art.previous_sha256 ? `0x${art.previous_sha256}` : `0x${"0".repeat(64)}`,
      moderator,
    },
  });
});
