import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { chainNow } from "@/lib/server/config";
import {
  currentViewer,
  findingListItem,
  requireRoom,
  roomArtifact,
  roomCommitments,
  roomFindings,
  roomPhase,
  usersByAddress,
} from "@/lib/server/queries";
import { syncChain } from "@/lib/server/sync";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx: IdParams) => {
  await syncChain().catch(() => null);
  const room = requireRoom(await idParam(ctx));
  const viewer = await currentViewer();
  const now = await chainNow();
  const commitments = roomCommitments(room.id);
  const findings = roomFindings(room.id).filter((f) => f.status === "committed" || f.author === viewer.address);
  const users = usersByAddress(commitments.map((c) => c.researcher));
  const { summary, diff, scan } = roomArtifact(room);
  return json({
    room: { ...room, adjudication_json: undefined },
    phase: roomPhase(room, now),
    now,
    artifact: summary ? { ...summary, files: undefined } : null,
    diff,
    scanHighlights: scan.filter((f) => f.severity !== "info").slice(0, 50),
    commitments: commitments.map((c) => ({
      index: c.idx,
      researcher: c.researcher,
      researcherNo: users.get(c.researcher)?.researcher_no ?? null,
      commitment: c.commitment,
      blockNumber: c.block_number,
      committedAt: c.committed_at,
      txHash: c.tx_hash,
      revealed: !!c.revealed,
    })),
    findings: findings.map((f) => findingListItem(viewer, room, f, now)),
  });
});
