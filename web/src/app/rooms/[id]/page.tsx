import Link from "next/link";
import { notFound } from "next/navigation";
import { ArtifactCard, DiffStats } from "@/components/ArtifactCard";
import { Countdown } from "@/components/Countdown";
import { ExplorerLink, Researcher } from "@/components/Identity";
import { Label, PhaseBadge, SeverityLabel, VerdictLabel } from "@/components/Labels";
import { Markdown } from "@/components/Markdown";
import { RoomActions, TriagePanel } from "@/components/RoomActions";
import { SettlementPanel } from "@/components/SettlementPanel";
import type { EvidenceReport } from "@/lib/evidence/types";
import { isoTime, mstc, short, timeAgo } from "@/lib/format";
import { PHASE_HELP } from "@/lib/phase";
import { appConfig, chainNow } from "@/lib/server/config";
import { db } from "@/lib/server/db";
import { settlementPreview } from "@/lib/server/findings";
import {
  commentKindCounts,
  currentViewer,
  findingListItem,
  getArtifactRow,
  getRoom,
  roomCommitments,
  roomFindings,
  roomPhase,
  usersByAddress,
} from "@/lib/server/queries";
import { syncChain } from "@/lib/server/sync";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab = "findings" } = await searchParams;
  await syncChain().catch(() => null);
  const room = getRoom(Number(id));
  if (!room) notFound();
  const cfg = appConfig();
  const now = await chainNow();
  const viewer = await currentViewer();
  const phase = roomPhase(room, now);
  const commitments = roomCommitments(room.id);
  const allFindings = roomFindings(room.id);
  const findings = allFindings.filter((f) => f.status === "committed" || f.author === viewer.address);
  const users = usersByAddress([room.developer, room.moderator, ...commitments.map((c) => c.researcher), ...findings.map((f) => f.author)]);
  const who = (a: string) => ({ address: a, researcherNo: users.get(a)?.researcher_no, handle: users.get(a)?.handle, verified: !!users.get(a)?.verified });
  const counts = commentKindCounts(findings.map((f) => f.id));
  const committedByFinding = new Map(findings.filter((f) => f.commitment_index !== null).map((f) => [f.commitment_index!, f]));
  const myUnrevealed = findings
    .filter((f) => f.author === viewer.address && f.status === "committed" && f.commitment_index !== null)
    .filter((f) => !commitments.find((c) => c.idx === f.commitment_index)?.revealed)
    .map((f) => ({ findingId: f.id, title: f.title, commitmentIndex: f.commitment_index! }));
  const artifactRow = getArtifactRow(room.artifact_hash.slice(2));

  const tabs = [
    { key: "findings", label: "Findings", count: commitments.length },
    { key: "release", label: "Release & evidence" },
    { key: "settlement", label: "Adjudication & settlement" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs muted">
            <Link href="/">Security rooms</Link> / Room #{room.id}
          </div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl">
            <span className="label mono" style={{ borderColor: "var(--border)" }}>{room.ecosystem}</span>
            <span className="font-semibold">{room.package_name}</span>
            <span className="muted">@{room.version}</span>
          </h1>
          {room.title && <p className="mt-1">{room.title}</p>}
          {room.require_verified ? (
            <div className="mt-1">
              <Label tone="success" title="Only moderator-verified researchers may submit reports">verified researchers only</Label>
            </div>
          ) : null}
        </div>
        <div className="text-right">
          <PhaseBadge phase={phase} large />
          <div className="mt-1 text-2xl font-semibold">{mstc(room.bounty_wei)}</div>
          <div className="text-xs muted">security pool, escrowed on-chain</div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card p-4 md:col-span-2">
          <div className="text-xs muted">Exact artifact (SHA-256)</div>
          <div className="mono break-all">{room.artifact_hash.slice(2)}</div>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>Developer: <Researcher who={who(room.developer)} /></div>
            <div>Moderator: <Researcher who={who(room.moderator)} /></div>
            <div>Opened {timeAgo(room.created_at, now)} · <ExplorerLink explorer={cfg.explorerUrl} kind="tx" value={room.create_tx ?? ""}>funding tx</ExplorerLink></div>
            <div>{commitments.length} on-chain commitment{commitments.length === 1 ? "" : "s"} · {commitments.filter((c) => c.revealed).length} revealed</div>
          </div>
          <div className="mt-3">
            <DiffStats diff={artifactRow?.diff ?? null} />
          </div>
          {room.description && (
            <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border-muted)" }}>
              <Markdown>{room.description}</Markdown>
            </div>
          )}
        </div>
        <div className="card space-y-2 p-4 text-sm">
          <div className="font-semibold">Timeline</div>
          <Step active={phase === "hunting"} done={now >= room.hunt_ends_at} label="Hunt">
            {now < room.hunt_ends_at ? <>closes in <Countdown to={room.hunt_ends_at} serverNow={now} /></> : `closed ${isoTime(room.hunt_ends_at)}`}
          </Step>
          <Step active={phase === "disclosure"} done={now >= room.disclosure_ends_at} label="Private disclosure">
            {now < room.disclosure_ends_at ? <>peer review opens in <Countdown to={room.disclosure_ends_at} serverNow={now} /></> : "complete"}
          </Step>
          <Step active={phase === "review"} done={phase === "settled" || phase === "refunded"} label="Peer review & adjudication">
            deadline {isoTime(room.adjudication_deadline)}
          </Step>
          <Step active={false} done={phase === "settled"} label="Settlement">
            {room.status === "settled" ? <ExplorerLink explorer={cfg.explorerUrl} kind="tx" value={room.settle_tx ?? ""}>settled on-chain</ExplorerLink> : room.status === "refunded" ? "refunded" : "pending"}
          </Step>
          <p className="border-t pt-2 text-xs muted" style={{ borderColor: "var(--border-muted)" }}>{PHASE_HELP[phase]}</p>
        </div>
      </div>

      <RoomActions
        roomId={room.id}
        phase={phase}
        developer={room.developer}
        moderator={room.moderator}
        commitments={commitments.length}
        myUnrevealed={myUnrevealed}
      />

      <nav className="tabnav">
        {tabs.map((t) => (
          <Link key={t.key} href={`/rooms/${room.id}?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined}>
            {t.label}
            {t.count !== undefined && <span className="label" style={{ borderColor: "var(--border)" }}>{t.count}</span>}
          </Link>
        ))}
      </nav>

      {tab === "findings" && (
        <section className="card">
          <div className="card-header text-sm">
            <span>
              <b>{commitments.length}</b> commitments · <b>{findings.filter((f) => f.verdict === "valid").length}</b> valid ·{" "}
              <b>{findings.filter((f) => f.verdict === "invalid").length}</b> invalid
            </span>
            {phase === "hunting" && <span className="text-xs muted">Findings are private during the hunt; only commitments are public.</span>}
          </div>
          {commitments.length === 0 && findings.length === 0 ? (
            <div className="px-4 py-10 text-center muted">No findings committed yet.</div>
          ) : (
            <ul>
              {findings
                .filter((f) => f.status === "draft")
                .map((f) => (
                  <li key={`d${f.id}`} className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0" style={{ borderColor: "var(--border-muted)" }}>
                    <Label tone="attention">draft · not committed</Label>
                    <Link href={`/rooms/${room.id}/findings/${f.id}`} className="font-semibold">{f.title}</Link>
                    <span className="text-xs muted">only you can see this; commit it on-chain before the hunt closes</span>
                  </li>
                ))}
              {commitments.map((c) => {
                const f = committedByFinding.get(c.idx);
                const item = f ? findingListItem(viewer, room, f, now) : null;
                const k = f ? counts.get(f.id) ?? {} : {};
                return (
                  <li key={c.idx} className="flex flex-wrap items-center gap-3 border-t px-4 py-3 first:border-t-0" style={{ borderColor: "var(--border-muted)" }}>
                    <span title={item?.verdict ?? "open"} style={{ color: item?.verdict === "valid" ? "var(--done)" : item?.verdict === "invalid" ? "var(--danger)" : "var(--success)" }}>
                      ●
                    </span>
                    <div className="min-w-0 flex-1">
                      {item?.visible && f ? (
                        <Link href={`/rooms/${room.id}/findings/${f.id}`} className="text-base font-semibold" style={{ color: "var(--fg)" }}>
                          {item.title}
                        </Link>
                      ) : (
                        <span className="font-semibold muted">Private finding (commitment {short(c.commitment, 8)})</span>
                      )}{" "}
                      {item?.visible && <SeverityLabel severity={item.claimedSeverity} prefix="claimed" />}{" "}
                      {item?.verdict && <VerdictLabel verdict={item.verdict} />} {item?.finalSeverity && <SeverityLabel severity={item.finalSeverity} />}{" "}
                      {c.revealed ? <Label tone="success">revealed</Label> : phase !== "hunting" ? <Label>not revealed</Label> : null}
                      <div className="text-xs muted">
                        {f ? `#${f.id} · ` : ""}commitment {c.idx} by <Researcher who={who(c.researcher)} /> · block {c.block_number} · {timeAgo(c.committed_at, now)}
                        {!f && " · report not submitted to ReleaseBond"}
                      </div>
                    </div>
                    {item?.visible && (
                      <div className="flex gap-3 text-xs muted">
                        {k.REPRODUCED ? <span style={{ color: "var(--success)" }}>✓ {k.REPRODUCED} reproduced</span> : null}
                        {k.REFUTED ? <span style={{ color: "var(--danger)" }}>✗ {k.REFUTED} refuted</span> : null}
                        <span>💬 {Object.values(k).reduce((a, b) => a + (b ?? 0), 0)}</span>
                      </div>
                    )}
                    {item?.awardWei && <Label tone="done">{mstc(item.awardWei)}</Label>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "release" && (
        <div className="space-y-4">
          {artifactRow ? <ArtifactCard a={artifactRow} /> : <div className="flash flash-warn">This artifact has not been indexed by this ReleaseBond server.</div>}
          {artifactRow && <TriagePanel roomId={room.id} initial={latestTriage(room.id)} />}
        </div>
      )}

      {tab === "settlement" && <SettlementTab roomId={room.id} viewerAddress={viewer.address} explorer={cfg.explorerUrl} />}
    </div>
  );
}

function latestTriage(roomId: number): { report: EvidenceReport; reportHash: string | null } | null {
  const row = db()
    .prepare("SELECT report_json, report_hash FROM evidence_runs WHERE room_id = ? AND finding_id IS NULL AND status = 'done' ORDER BY id DESC LIMIT 1")
    .get(roomId) as { report_json: string; report_hash: string } | undefined;
  return row ? { report: JSON.parse(row.report_json), reportHash: row.report_hash } : null;
}

function Step({ label, active, done, children }: { label: string; active: boolean; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: active ? "var(--accent)" : done ? "var(--success)" : "var(--border)" }} />
      <div>
        <div className={active ? "font-semibold" : ""}>{label}</div>
        <div className="text-xs muted">{children}</div>
      </div>
    </div>
  );
}

async function SettlementTab({ roomId, viewerAddress, explorer }: { roomId: number; viewerAddress: string | null; explorer: string | null }) {
  const p = await settlementPreview(roomId);
  const users = usersByAddress([...p.plan.discoveries.map((d) => d.researcher), ...p.plan.reviews.map((r) => r.reviewer)]);
  const payouts = db().prepare("SELECT * FROM payouts WHERE room_id = ? ORDER BY log_index").all(roomId) as {
    account: string;
    kind: string;
    amount_wei: string;
    tx_hash: string;
    commitment_index: number | null;
  }[];
  return (
    <div className="space-y-4">
      <section className="card">
        <div className="card-header">
          <h3 className="font-semibold">Adjudication</h3>
          <span className="text-xs muted">The moderator decides validity and severity. Votes never do.</span>
        </div>
        <ul>
          {p.findings.length === 0 && <li className="px-4 py-6 text-center muted">No committed findings to adjudicate.</li>}
          {p.findings.map((f) => (
            <li key={f.id} className="border-t px-4 py-3 first:border-t-0" style={{ borderColor: "var(--border-muted)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/rooms/${roomId}/findings/${f.id}`} className="font-semibold">
                  #{f.id} {p.phase === "hunting" ? "(private)" : f.title}
                </Link>
                <VerdictLabel verdict={f.verdict} />
                <SeverityLabel severity={f.finalSeverity} />
                {f.revealed ? <Label tone="success">revealed</Label> : <Label tone="danger">unrevealed — not payable</Label>}
                {f.duplicateOf && <span className="text-xs muted">duplicate of #{f.duplicateOf}</span>}
              </div>
              {f.reasoning && p.phase !== "hunting" && <div className="mt-1 text-sm"><Markdown>{f.reasoning}</Markdown></div>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="card-header">
          <h3 className="font-semibold">{p.room.status === "settled" ? "Settlement (on-chain)" : "Proposed settlement"}</h3>
          <span className="text-xs muted">Severity caps: critical 100% · high 50% · medium 20% · low 5% of the discovery budget; duplicates 50%; reviewers share 10%.</span>
        </div>
        <div className="space-y-2 p-4 text-sm">
          {p.room.status === "settled" ? (
            <>
              <ul className="space-y-1">
                {payouts.map((x) => (
                  <li key={`${x.tx_hash}${x.account}${x.kind}`}>
                    <Label tone={x.kind === "discovery" ? "success" : "accent"}>{x.kind}</Label> <Researcher who={{ address: x.account, researcherNo: users.get(x.account)?.researcher_no, handle: users.get(x.account)?.handle }} /> —{" "}
                    <b>{mstc(x.amount_wei)}</b>
                    {x.commitment_index !== null ? <span className="muted"> (commitment {x.commitment_index})</span> : null}
                  </li>
                ))}
                <li><Label>refund</Label> developer — <b>{mstc(p.room.refunded_wei)}</b></li>
              </ul>
              <div className="text-xs muted">
                Settlement tx <ExplorerLink explorer={explorer} kind="tx" value={p.room.settle_tx ?? ""} /> · on-chain adjudication hash{" "}
                <span className="mono">{p.room.adjudication_hash}</span>
              </div>
            </>
          ) : (
            <>
              {p.plan.discoveries.length === 0 && p.plan.reviews.length === 0 && <p className="muted">No awards yet (awaiting verdicts).</p>}
              <ul className="space-y-1">
                {p.plan.discoveries.map((d) => (
                  <li key={d.findingId}>
                    <Label tone="success">{d.duplicate ? "duplicate discovery" : "discovery"}</Label> #{d.findingId} →{" "}
                    <Researcher who={{ address: d.researcher, researcherNo: users.get(d.researcher)?.researcher_no, handle: users.get(d.researcher)?.handle }} /> <b>{mstc(d.amount)}</b>
                  </li>
                ))}
                {p.plan.reviews.map((r) => (
                  <li key={r.reviewer}>
                    <Label tone="accent">review contribution</Label> <Researcher who={{ address: r.reviewer, researcherNo: users.get(r.reviewer)?.researcher_no, handle: users.get(r.reviewer)?.handle }} /> <b>{mstc(r.amount)}</b>
                  </li>
                ))}
                <li><Label>refund to developer</Label> <b>{mstc(p.plan.refund)}</b></li>
              </ul>
              {p.plan.excluded.map((x) => (
                <div key={x.findingId} className="text-xs" style={{ color: "var(--attention)" }}>#{x.findingId} excluded: {x.reason}</div>
              ))}
            </>
          )}
        </div>
      </section>

      <SettlementPanel
        roomId={roomId}
        isModerator={viewerAddress === p.room.moderator}
        phase={p.phase}
        settled={p.room.status === "settled"}
        onchainHash={p.room.adjudication_hash}
        record={p.room.adjudication_json}
        pendingVerdicts={p.pendingVerdicts}
      />
    </div>
  );
}
