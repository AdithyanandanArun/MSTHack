import Link from "next/link";
import { PhaseBadge } from "@/components/Labels";
import { mstc, short, timeAgo } from "@/lib/format";
import { appConfig, chainNow } from "@/lib/server/config";
import { listRooms, roomCommitments, roomPhase } from "@/lib/server/queries";
import { formatDuration } from "@/lib/phase";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cfg = appConfig();
  const now = await chainNow();
  const rooms = listRooms();
  const pooled = rooms.filter((r) => r.status === "active").reduce((a, r) => a + BigInt(r.bounty_wei), 0n);
  const hunting = rooms.filter((r) => roomPhase(r, now) === "hunting").length;

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <h1 className="text-2xl font-semibold">Put a bounty on your release. Let verified researchers try to break it.</h1>
        <p className="mt-2 max-w-3xl muted">
          ReleaseBond turns an exact software artifact into a funded, time-boxed security competition on MST. Researchers commit
          private findings on-chain, peers reproduce and refute them with a hybrid agent + rule evidence engine, a moderator
          adjudicates, and the contract pays.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/rooms/new" className="btn btn-primary">Fund a release</Link>
          <a className="btn" href="https://faucet.masterstroke.academy" target="_blank" rel="noreferrer">Get test MSTC</a>
        </div>
        <div className="mt-5 flex flex-wrap gap-6 text-sm">
          <div><span className="text-lg font-semibold">{rooms.length}</span> <span className="muted">security rooms</span></div>
          <div><span className="text-lg font-semibold">{hunting}</span> <span className="muted">hunting now</span></div>
          <div><span className="text-lg font-semibold">{mstc(pooled, 2)}</span> <span className="muted">locked in active pools</span></div>
        </div>
      </section>

      {!cfg.contractAddress && (
        <div className="flash flash-warn">
          No ReleaseBond contract is configured for {cfg.chainName} yet. The owner can deploy it from a Bridgekey wallet on the{" "}
          <Link href="/admin">admin page</Link>.
        </div>
      )}

      <section className="card">
        <div className="card-header">
          <h2 className="font-semibold">Security rooms</h2>
          <span className="text-xs muted">{cfg.chainName}</span>
        </div>
        {rooms.length === 0 ? (
          <div className="px-4 py-10 text-center muted">No funded releases yet. Be the first to put a bounty on a release.</div>
        ) : (
          <ul>
            {rooms.map((r) => {
              const phase = roomPhase(r, now);
              const commits = roomCommitments(r.id).length;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 border-t px-4 py-3 first:border-t-0" style={{ borderColor: "var(--border-muted)" }}>
                  <span className="label mono" style={{ borderColor: "var(--border)" }}>{r.ecosystem}</span>
                  <div className="min-w-0 flex-1 basis-60">
                    <Link href={`/rooms/${r.id}`} className="text-base font-semibold">
                      {r.package_name}@{r.version}
                    </Link>
                    {r.title ? <span className="ml-2 muted">{r.title}</span> : null}
                    <div className="text-xs muted">
                      Room #{r.id} · artifact <span className="mono">{short(r.artifact_hash, 8)}</span> · opened {timeAgo(r.created_at, now)} ·{" "}
                      {commits} commitment{commits === 1 ? "" : "s"}
                      {phase === "hunting" ? ` · hunt closes in ${formatDuration(r.hunt_ends_at - now)}` : ""}
                    </div>
                  </div>
                  <span className="font-semibold">{mstc(r.bounty_wei, 2)}</span>
                  <PhaseBadge phase={phase} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
