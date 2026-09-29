import Link from "next/link";
import { ExplorerLink } from "@/components/Identity";
import { KindLabel, Label, SeverityLabel, VerdictLabel } from "@/components/Labels";
import { mstc, short, timeAgo } from "@/lib/format";
import type { CommentKind } from "@/lib/phase";
import { appConfig, chainNow } from "@/lib/server/config";
import { db } from "@/lib/server/db";
import { statsOf } from "@/lib/server/onchain";
import { developerHistory } from "@/lib/server/history";
import { moderatorHistory, researcherAppealOutcomes } from "@/lib/server/moderation";
import { ReviewList } from "@/components/ReviewHistory";
import { canView, currentViewer, getRoom, getUser, isModerator, type FindingRow } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export default async function ResearcherPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = await params;
  const address = raw.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) return <div className="flash flash-error">Invalid address.</div>;
  const user = getUser(address);
  const cfg = appConfig();
  const viewer = await currentViewer();
  const now = await chainNow();
  const stats = await statsOf(address);
  const dev = developerHistory(address, now);
  const mod = moderatorHistory(address, now);
  const appeals = researcherAppealOutcomes(address);
  const d = db();
  const findings = (d.prepare("SELECT * FROM findings WHERE author = ? AND status = 'committed' ORDER BY id DESC").all(address) as FindingRow[]).filter((f) => {
    const room = getRoom(f.room_id);
    return room ? canView(viewer, room, f, now) : false;
  });
  const reviewKinds = d
    .prepare("SELECT kind, COUNT(*) AS n FROM comments WHERE author = ? AND withdrawn = 0 GROUP BY kind")
    .all(address) as { kind: CommentKind; n: number }[];
  const payouts = d.prepare("SELECT * FROM payouts WHERE account = ? ORDER BY rowid DESC").all(address) as {
    room_id: number;
    kind: string;
    amount_wei: string;
    tx_hash: string;
  }[];

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-2">
        <div className="flex h-24 w-24 items-center justify-center rounded-full text-3xl font-semibold" style={{ background: `hsl(${parseInt(address.slice(2, 6), 16) % 360} 60% 35%)`, color: "#fff" }}>
          {(user?.handle ?? "R")[0].toUpperCase()}
        </div>
        <h1 className="text-xl font-semibold">{user?.handle ?? (user ? `Researcher #${user.researcher_no}` : short(address))}</h1>
        {user?.handle && <div className="muted">Researcher #{user.researcher_no}</div>}
        <div className="mono break-all [text-wrap:balance]"><ExplorerLink explorer={cfg.explorerUrl} kind="address" value={address}>{address}</ExplorerLink></div>
        <div className="flex flex-wrap gap-1">
          {user?.verified ? <Label tone="success">verified human</Label> : <Label>not verified</Label>}
          {isModerator(address) && <Label tone="done">moderator</Label>}
        </div>
        {user?.bio && <p className="text-sm">{user.bio}</p>}
      </aside>

      <div className="space-y-4">
        <section className="card">
          <div className="card-header">
            <h2 className="font-semibold">On-chain security reputation</h2>
            <span className="text-xs muted">read from ReleaseBond.statsOf — not a single trust score</span>
          </div>
          {stats ? (
            <div className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
              <Stat label="Valid discoveries" value={stats.validDiscoveries} />
              <Stat label="Independent duplicates" value={stats.duplicateDiscoveries} />
              <Stat label="Critical" value={stats.criticalFindings} />
              <Stat label="High" value={stats.highFindings} />
              <Stat label="Review awards" value={stats.reviewAwards} />
              <Stat label="Rejected reports" value={stats.rejectedFindings} />
              <Stat label="Total earned" value={mstc(stats.totalEarned)} />
              <Stat label="Findings overturned on appeal" value={appeals.findingsOverturnedOnAppeal} />
            </div>
          ) : (
            <p className="p-4 muted">Contract not configured.</p>
          )}
        </section>

        {(mod.isModerator || mod.roomsModerated > 0) && (
          <section className="card">
            <div className="card-header">
              <h2 className="font-semibold">Moderator track record</h2>
              <span className="text-xs muted">public accountability for security judgments</span>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
              <Stat label="Rooms moderated" value={mod.roomsModerated} />
              <Stat label="Rooms settled" value={mod.roomsSettled} />
              <Stat label="Deadlines missed" value={mod.deadlinesMissed} />
              <Stat label="Verdicts (valid / dup / invalid)" value={`${mod.verdicts.valid ?? 0} / ${mod.verdicts.duplicate ?? 0} / ${mod.verdicts.invalid ?? 0}`} />
              <Stat label="Their verdicts upheld on appeal" value={mod.appealsAgainstTheirVerdicts.upheld} />
              <Stat label="Their verdicts overturned" value={mod.appealsAgainstTheirVerdicts.overturned} />
              <Stat label="Appeals decided" value={mod.appealsDecided.upheld + mod.appealsDecided.overturned} />
              <Stat label="Panel approvals given" value={mod.panelApprovalsGiven} />
            </div>
          </section>
        )}

        {dev.releasesFunded > 0 && (
          <section className="card">
            <div className="card-header">
              <h2 className="font-semibold">Review track record (as a developer)</h2>
              <span className="text-xs muted">historical evidence, not a guarantee</span>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
              <Stat label="Releases funded" value={dev.releasesFunded} />
              <Stat label="Reviews completed" value={dev.releasesReviewed} />
              <Stat label="Security pools funded" value={mstc(dev.poolsFundedWei)} />
              <Stat label="Accepted findings" value={dev.acceptedFindings.total} />
              <Stat label="Critical" value={dev.acceptedFindings.bySeverity.critical} />
              <Stat label="High" value={dev.acceptedFindings.bySeverity.high} />
              <Stat
                label="Followed by a newer reviewed release"
                value={`${dev.releasesWithFindingsFollowedByNewerReview.count}/${dev.releasesWithFindingsFollowedByNewerReview.of}`}
              />
            </div>
            <ReviewList reviews={dev.reviews} now={now} withPackage />
          </section>
        )}

        <section className="card">
          <div className="card-header"><h2 className="font-semibold">Peer-review activity</h2></div>
          <div className="flex flex-wrap gap-3 p-4 text-sm">
            {reviewKinds.length === 0 && <span className="muted">No responses yet.</span>}
            {reviewKinds.map((k) => (
              <span key={k.kind} className="flex items-center gap-1">
                {k.kind === "COMMENT" ? <Label>Comment</Label> : <KindLabel kind={k.kind} />} × {k.n}
              </span>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-header"><h2 className="font-semibold">Findings</h2></div>
          {findings.length === 0 ? (
            <p className="px-4 py-6 text-center muted">No findings visible to you.</p>
          ) : (
            <ul>
              {findings.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 border-t px-4 py-2 first:border-t-0" style={{ borderColor: "var(--border-muted)" }}>
                  <Link href={`/rooms/${f.room_id}/findings/${f.id}`} className="font-semibold">#{f.id} {f.title}</Link>
                  <span className="text-xs muted">{timeAgo(f.created_at, now)}</span>
                  <VerdictLabel verdict={f.verdict} />
                  <SeverityLabel severity={f.final_severity} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-header"><h2 className="font-semibold">Payouts</h2></div>
          {payouts.length === 0 ? (
            <p className="px-4 py-6 text-center muted">No payouts yet.</p>
          ) : (
            <ul>
              {payouts.map((p) => (
                <li key={`${p.tx_hash}${p.kind}`} className="flex items-center gap-2 border-t px-4 py-2 first:border-t-0" style={{ borderColor: "var(--border-muted)" }}>
                  <Label tone={p.kind === "discovery" ? "success" : "accent"}>{p.kind}</Label>
                  <b>{mstc(p.amount_wei)}</b>
                  <Link href={`/rooms/${p.room_id}?tab=settlement`}>room #{p.room_id}</Link>
                  <ExplorerLink explorer={cfg.explorerUrl} kind="tx" value={p.tx_hash} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs muted">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
