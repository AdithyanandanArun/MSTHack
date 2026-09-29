import { NewRoomForm } from "@/components/NewRoomForm";
import { db } from "@/lib/server/db";
import { requireSignedIn } from "@/lib/server/guard";

export const dynamic = "force-dynamic";

export default async function NewRoomPage() {
  await requireSignedIn("/rooms/new");
  const verified = (db().prepare("SELECT COUNT(*) AS n FROM users WHERE verified = 1").get() as { n: number }).n;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Fund a release</h1>
        <p className="muted">Register the exact artifact, lock an MST bounty against its hash, and open a security room.</p>
      </div>
      <NewRoomForm verifiedResearchers={verified} />
    </div>
  );
}
