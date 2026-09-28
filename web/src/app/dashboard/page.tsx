import Link from "next/link";
import { ProfileForm, WithdrawBox } from "@/components/AccountActions";
import { Label, PhaseBadge, SeverityLabel, VerdictLabel } from "@/components/Labels";
import { mstc, timeAgo } from "@/lib/format";
import { chainNow } from "@/lib/server/config";
import { db } from "@/lib/server/db";
import { pendingWithdrawal } from "@/lib/server/onchain";
import { moderatorQueue } from "@/lib/server/moderation";
import { formatDuration } from "@/lib/phase";
import { currentViewer, roomPhase, type FindingRow, type RoomRow } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const viewer = await currentViewer();
  if (!viewer.address || !viewer.user) {
    return <div className="flash flash-info">Connect your wallet and sign in to see your dashboard.</div>;
  }
  const now = await chainNow();
  const d = db();
  const findings = d
    .prepare("SELECT f.*, r.package_name, r.version FROM findings f JOIN rooms r ON r.id = f.room_id WHERE f.author = ? ORDER BY f.id DESC")
    .all(viewer.address) as (FindingRow & { package_name: string; version: string })[];
  const funded = d.prepare("SELECT * FROM rooms WHERE developer = ? ORDER BY id DESC").all(viewer.address) as RoomRow[];
  const moderating = d.prepare("SELECT * FROM rooms WHERE moderator = ? ORDER BY id DESC").all(viewer.address) as RoomRow[];
  const pending = await pendingWithdrawal(viewer.address);
  const queue = viewer.isModerator ? moderatorQueue(viewer.address, now) : null;
  const queueItems = queue ? queue.rooms.filter((r) => r.phase === "review" || r.phase === "expired").length + queue.appeals.length + queue.panelApprovals.length : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{viewer.user.handle ?? `Researcher #${viewer.user.researcher_no}`}</h1>
        {viewer.user.verified ? <Label tone="success">verified human</Label> : <Label>unverified</Label>}
        {viewer.isModerator && <Label tone="done">moderator</Label>}
        <Link href={`/researchers/${viewer.address}`} className="text-sm">public profile →</Link>
      </div>

      <WithdrawBox pendingWei={pending.toString()} />

      {queue && (
        <section className="card">
          <div className="card-header">
            <h2 className="font-semibold">Moderation queue</h2>
            <span className="text-xs muted">{queueItems} item{queueItems === 1 ? "" : "s"} need you</span>
          </div>
          <div className="space-y-3 p-4 text-sm">
            {queue.rooms.length === 0 && queue.appeals.length === 0 && queue.panelApprovals.length === 0 && <p className="muted">Nothing waiting on you.</p>}
            {queue.rooms.map((r) => (
              <div key={r.roomId} className="flex flex-wrap items-center gap-2">
                <Link href={`/rooms/${r.roomId}?tab=settlement`} className="font-semibold">{r.packageName}@{r.version}</Link>
                <PhaseBadge phase={r.phase} />
                <span>{r.nextAction}</span>
                {r.pendingVerdicts.length > 0 && <Label tone="attention">{r.pendingVerdicts.length} pending verdict{r.pendingVerdicts.length === 1 ? "" : "s"}</Label>}
                {r.openAppeals > 0 && <Label tone="attention">{r.openAppeals} open appeal{r.openAppeals === 1 ? "" : "s"}</Label>}
                <span className="text-xs muted">
                  {r.secondsToDeadline > 0 ? `adjudication deadline in ${formatDuration(r.secondsToDeadline)}` : "deadline passed"}
                </span>
              </div>
            ))}
            {queue.appeals.map((a) => (
              <div key={a.appealId} className="flex flex-wrap items-center gap-2">
                <Label tone="done">appeal to decide</Label>
                <Link href={`/rooms/${a.roomId}/findings/${a.findingId}`}>#{a.findingId} {a.title}</Link>
                <span className="text-xs muted">contested verdict: {a.contestedVerdict}</span>
              </div>
            ))}
            {queue.panelApprovals.map((p) => (
              <div key={p.roomId} className="flex flex-wrap items-center gap-2">
                <Label tone="done">panel</Label>
                <Link href={`/rooms/${p.roomId}?tab=settlement`}>{p.packageName}@{p.version}</Link>
                <span>{p.state}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-header"><h2 className="font-semibold">Your findings</h2></div>
        {findings.length === 0 ? (
          <div className="px-4 py-6 text-center muted">No findings yet. Pick a room that is hunting and break the release.</div>
        ) : (
          <ul>
            {findings.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 border-t px-4 py-2 first:border-t-0" style={{ borderColor: "var(--border-muted)" }}>
                <Link href={`/rooms/${f.room_id}/findings/${f.id}`} className="font-semibold">#{f.id} {f.title}</Link>
                <span className="text-xs muted">{f.package_name}@{f.version} · {timeAgo(f.created_at, now)}</span>
                {f.status === "draft" ? <Label tone="attention">draft</Label> : <Label tone="success">committed</Label>}
                <SeverityLabel severity={f.claimed_severity} prefix="claimed" />
                {f.verdict && <VerdictLabel verdict={f.verdict} />}
                {f.award_wei && <Label tone="done">{mstc(f.award_wei)}</Label>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <RoomList title="Releases you funded" rooms={funded} now={now} />
        <RoomList title="Rooms you moderate" rooms={moderating} now={now} />
      </div>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Profile</h2>
        <ProfileForm handle={viewer.user.handle} bio={viewer.user.bio} />
      </section>
    </div>
  );
}

function RoomList({ title, rooms, now }: { title: string; rooms: RoomRow[]; now: number }) {
  return (
    <section className="card">
      <div className="card-header"><h2 className="font-semibold">{title}</h2></div>
      {rooms.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm muted">None.</div>
      ) : (
        <ul>
          {rooms.map((r) => (
            <li key={r.id} className="flex items-center gap-2 border-t px-4 py-2 first:border-t-0" style={{ borderColor: "var(--border-muted)" }}>
              <Link href={`/rooms/${r.id}`} className="flex-1 font-semibold">{r.package_name}@{r.version}</Link>
              <span className="text-sm">{mstc(r.bounty_wei, 2)}</span>
              <PhaseBadge phase={roomPhase(r, now)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
