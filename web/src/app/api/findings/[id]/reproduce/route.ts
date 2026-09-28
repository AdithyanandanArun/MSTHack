import type { Observation } from "@/lib/canonical";
import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { chainNow } from "@/lib/server/config";
import { runEvidence } from "@/lib/server/evidence";
import { canView, currentViewer, HttpError, requireFinding, requireRoom } from "@/lib/server/queries";

export const maxDuration = 300;

const running = new Set<string>();

/**
 * Runs the Agent + Rule evidence engine against the room's exact artifact and
 * the finding's declared observations. The result is evidence for reviewers,
 * never a verdict.
 */
export const POST = route(async (_req, ctx: IdParams) => {
  const viewer = await currentViewer();
  if (!viewer.address) throw new HttpError(401, "sign in first");
  const f = requireFinding(await idParam(ctx));
  const room = requireRoom(f.room_id);
  if (!canView(viewer, room, f, await chainNow())) throw new HttpError(403, "you cannot see this finding yet");
  if (running.has(viewer.address)) throw new HttpError(429, "you already have an evidence run in progress");
  running.add(viewer.address);
  try {
    const result = await runEvidence({
      roomId: room.id,
      sha256: room.artifact_hash.slice(2),
      findingId: f.id,
      requestedBy: viewer.address,
      claims: JSON.parse(f.observations_json) as Observation[],
      finding: {
        title: f.title,
        claimedSeverity: f.claimed_severity,
        description: f.description,
        proofOfConcept: f.proof_of_concept,
        reproduction: f.reproduction,
        observations: JSON.parse(f.observations_json),
      },
    });
    if (result.error) throw new HttpError(500, `evidence run failed: ${result.error}`);
    return json(result);
  } finally {
    running.delete(viewer.address);
  }
});
