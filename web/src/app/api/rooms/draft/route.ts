import { z } from "zod";
import { json, route } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { chainNow, contractInfo } from "@/lib/server/config";
import { db, nowSec } from "@/lib/server/db";
import { getArtifact } from "@/lib/server/evidence";
import { HttpError, isModerator, openRoomNotice } from "@/lib/server/queries";
import { enforceLimit } from "@/lib/server/rateLimit";

const Body = z.object({
  artifactSha256: z.string().regex(/^[0-9a-f]{64}$/),
  title: z.string().trim().max(140).optional(),
  description: z.string().max(10_000).optional(),
  moderator: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** Off-chain policy: only moderator-verified researchers may submit reports. */
  requireVerified: z.boolean().default(false),
  /** Optional moderator panel whose EIP-712 approvals settlement will require. */
  panel: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).max(5).default([]),
  panelQuorum: z.number().int().min(0).max(5).default(0),
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
  const panel = body.panel.map((a) => a.toLowerCase());
  if (new Set(panel).size !== panel.length) throw new HttpError(400, "duplicate panel member");
  for (const m of panel) {
    if (!isModerator(m)) throw new HttpError(400, `${m} is not a registered moderator`);
    if (m === developer || m === moderator) throw new HttpError(400, "the developer and room moderator cannot sit on the panel");
  }
  if (panel.length === 0 ? body.panelQuorum !== 0 : body.panelQuorum < 1 || body.panelQuorum > panel.length) {
    throw new HttpError(400, "panel quorum must be between 1 and the panel size");
  }
  const open = openRoomNotice(`0x${art.sha256}`, developer, await chainNow());
  if (open) throw new HttpError(409, open.message);

  db()
    .prepare(
      `INSERT INTO room_drafts(artifact_sha256, developer, title, description, require_verified, created_at) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(artifact_sha256, developer) DO UPDATE SET
         title = excluded.title, description = excluded.description, require_verified = excluded.require_verified`,
    )
    .run(art.sha256, developer, body.title ?? null, body.description ?? null, body.requireVerified ? 1 : 0, nowSec());

  return json({
    contract: address,
    params: {
      ecosystem: art.ecosystem,
      packageName: art.name,
      version: art.version,
      artifactHash: `0x${art.sha256}`,
      previousArtifactHash: art.previous_sha256 ? `0x${art.previous_sha256}` : `0x${"0".repeat(64)}`,
      moderator,
      panel,
      panelQuorum: panel.length ? body.panelQuorum : 0,
    },
  });
});
