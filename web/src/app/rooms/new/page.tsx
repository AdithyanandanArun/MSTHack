import { NewRoomForm } from "@/components/NewRoomForm";

export default function NewRoomPage() {
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
