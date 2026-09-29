import { NewRoomForm } from "@/components/NewRoomForm";
import { requireSignedIn } from "@/lib/server/guard";

export const dynamic = "force-dynamic";

export default async function NewRoomPage() {
  await requireSignedIn("/rooms/new");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Fund a release</h1>
        <p className="muted">Register the exact artifact, lock an MST bounty against its hash, and open a security room.</p>
      </div>
      <NewRoomForm />
    </div>
  );
}
