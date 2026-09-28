import Link from "next/link";
import { notFound } from "next/navigation";
import type { Hex } from "viem";
import { FindingEditor } from "@/components/FindingEditor";
import { chainNow } from "@/lib/server/config";
import { getRoom, roomPhase } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export default async function NewFindingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = getRoom(Number(id));
  if (!room) notFound();
  const phase = roomPhase(room, await chainNow());
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs muted">
          <Link href={`/rooms/${room.id}`}>{room.package_name}@{room.version}</Link> / new finding
        </div>
        <h1 className="text-xl font-semibold">Submit a private finding</h1>
        <p className="muted">Target artifact <span className="mono">{room.artifact_hash.slice(2, 18)}…</span> ({room.ecosystem})</p>
      </div>
      {phase !== "hunting" ? (
        <div className="flash flash-warn">The hunt for this release is closed.</div>
      ) : (
        <FindingEditor roomId={room.id} artifactHash={room.artifact_hash as Hex} packageLabel={`${room.package_name}@${room.version}`} />
      )}
    </div>
  );
}
