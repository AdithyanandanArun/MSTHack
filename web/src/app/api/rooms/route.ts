import { json, route } from "@/lib/server/api";
import { chainNow } from "@/lib/server/config";
import { listRooms, roomCommitments, roomPhase } from "@/lib/server/queries";
import { syncChain } from "@/lib/server/sync";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await syncChain().catch(() => null);
  const now = await chainNow();
  return json(
    listRooms().map((r) => ({
      id: r.id,
      ecosystem: r.ecosystem,
      packageName: r.package_name,
      version: r.version,
      artifactHash: r.artifact_hash,
      bountyWei: r.bounty_wei,
      developer: r.developer,
      moderator: r.moderator,
      phase: roomPhase(r, now),
      huntEndsAt: r.hunt_ends_at,
      disclosureEndsAt: r.disclosure_ends_at,
      commitments: roomCommitments(r.id).length,
      title: r.title,
    })),
  );
});
