"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { findingHash, OBSERVATION_LABELS, SEVERITIES, type Observation, type Severity } from "@/lib/canonical";
import { releaseBondAbi } from "@/lib/chain/releaseBondArtifact";
import { api, describeRunProgress, errorMessage, waitForEvidence } from "@/lib/client/api";
import type { EvidenceReport } from "@/lib/evidence/types";
import { isoTime, mstc, short, timeAgo } from "@/lib/format";
import { COMMENT_KIND_LABEL, type CommentKind, type Phase } from "@/lib/phase";
import { AttachmentPicker, type UploadedFile } from "./Attachments";
import { EvidenceReportView } from "./EvidenceReport";
import { ExplorerLink, Researcher, type IdentityInfo } from "./Identity";
import { KindLabel, Label, OutcomeLabel, SeverityLabel, VerdictLabel } from "./Labels";
import { Markdown } from "./Markdown";
import { MarkdownEditor } from "./MarkdownEditor";
import { useSignedIn, useWallet } from "./WalletProvider";

interface Attachment {
  id: number;
  filename: string;
  size: number;
  sha256: string;
  url: string;
  mime: string;
}
interface Comment {
  id: number;
  parentId: number | null;
  author: IdentityInfo;
  kind: CommentKind;
  body: string;
  proposedSeverity: string | null;
  duplicateOf: number | null;
  evidenceRunId: number | null;
  withdrawn: boolean;
  createdAt: number;
  votes: number;
  votedByMe: boolean;
  attachments: Attachment[];
  role: string | null;
}
export interface FindingDetail {
  room: { id: number; packageName: string; version: string; ecosystem: string; artifactHash: Hex; developer: string; moderator: string; phase: Phase; bountyWei: string };
  finding: {
    id: number;
    author: IdentityInfo;
    title: string;
    claimedSeverity: Severity;
    description: string;
    proofOfConcept: string;
    reproduction: string;
    observations: Observation[];
    attachmentHashes: string[];
    attachments: Attachment[];
    findingHash: Hex;
    commitment: Hex;
    nonce: Hex | null;
    status: string;
    commitmentIndex: number | null;
    onchain: { blockNumber: number; committedAt: number; txHash: string; revealed: boolean; revealTx: string | null; revealedHashMatches: boolean | null } | null;
    verdict: string | null;
    finalSeverity: string | null;
    duplicateOf: number | null;
    verdictReasoning: string | null;
    materialReviewers: string[];
    adjudicatedAt: number | null;
    awardWei: string | null;
    createdAt: number;
    votes: number;
    votedByMe: boolean;
  };
  appeal: {
    id: number;
    appellant: string;
    reason: string;
    status: "open" | "upheld" | "overturned";
    reviewer: string | null;
    decisionReasoning: string | null;
    newVerdict: "valid" | "duplicate" | "invalid" | "inconclusive" | null;
    newSeverity: Severity | null;
    newDuplicateOf: number | null;
    createdAt: number;
    decidedAt: number | null;
  } | null;
  comments: Comment[];
  unresolvedObjections: number;
  evidenceRuns: Record<string, { id: number; status: string; outcome: string | null; reportHash: string | null; report: EvidenceReport | null } | null>;
  viewer: {
    address: string | null;
    allowedKinds: CommentKind[];
    isAuthor: boolean;
    isRoomModerator: boolean;
    isDeveloper: boolean;
    canAppeal: boolean;
    canDecideAppeal: boolean;
  };
}

export function FindingThread({ d, now, explorer }: { d: FindingDetail; now: number; explorer: string | null }) {
  const router = useRouter();
  const { config, sendTx } = useWallet();
  const signedIn = useSignedIn();
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myRun, setMyRun] = useState<{ id: number; report: EvidenceReport } | null>(null);
  const f = d.finding;

  const children = useMemo(() => {
    const m = new Map<number | null, Comment[]>();
    for (const c of d.comments) m.set(c.parentId, [...(m.get(c.parentId) ?? []), c]);
    return m;
  }, [d.comments]);

  // Anyone can check the server shows the exact report that was committed.
  const recomputedHash = useMemo(
    () =>
      findingHash({
        roomId: d.room.id,
        title: f.title,
        claimedSeverity: f.claimedSeverity,
        description: f.description,
        proofOfConcept: f.proofOfConcept,
        reproduction: f.reproduction,
        observations: f.observations,
        attachments: f.attachmentHashes,
      }),
    [d.room.id, f],
  );

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const vote = (targetType: "finding" | "comment", targetId: number) => act(() => api("/api/votes", { method: "POST", json: { targetType, targetId } }));

  const commitDraft = () =>
    act(() =>
      sendTx("Commit finding", (w, acct) =>
        w.writeContract({ address: config.contractAddress as Address, abi: releaseBondAbi, functionName: "commitFinding", args: [BigInt(d.room.id), f.commitment], account: acct, chain: w.chain }),
      ),
    );
  const reveal = () =>
    act(() =>
      sendTx("Reveal finding", (w, acct) =>
        w.writeContract({
          address: config.contractAddress as Address,
          abi: releaseBondAbi,
          functionName: "revealFinding",
          args: [BigInt(d.room.id), f.commitmentIndex!, f.findingHash, f.nonce!],
          account: acct,
          chain: w.chain,
        }),
      ),
    );
  const deleteDraft = () =>
    act(async () => {
      await api(`/api/findings/${f.id}`, { method: "DELETE" });
      router.push(`/rooms/${d.room.id}`);
    });

  const state = f.status === "draft" ? "Draft" : f.verdict ? f.verdict[0].toUpperCase() + f.verdict.slice(1) : "Open";
  const stateColor = f.status === "draft" ? "var(--fg-muted)" : f.verdict === "valid" ? "var(--done)" : f.verdict === "invalid" ? "var(--danger)" : "var(--success)";
  const counts = d.comments.filter((c) => !c.withdrawn).reduce<Record<string, number>>((a, c) => ((a[c.kind] = (a[c.kind] ?? 0) + 1), a), {});

  const renderComment = (c: Comment, depth: number) => {
    const run = c.evidenceRunId ? d.evidenceRuns[String(c.evidenceRunId)] : null;
    return (
      <div key={c.id} style={{ marginLeft: depth ? 24 : 0 }} className="relative">
        {depth > 0 && <span className="absolute top-0 -left-3 h-full border-l-2" style={{ borderColor: "var(--border-muted)" }} />}
        <div className={`card mt-3 ${c.withdrawn ? "opacity-60" : ""}`}>
          <div className="card-header py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Researcher who={c.author} role={c.role} />
              <KindLabel kind={c.kind} />
              {c.proposedSeverity && <SeverityLabel severity={c.proposedSeverity} prefix="proposes" />}
              {c.duplicateOf && (
                <span className="text-xs">
                  duplicate of <Link href={`/rooms/${d.room.id}/findings/${c.duplicateOf}`}>#{c.duplicateOf}</Link>
                </span>
              )}
              <span className="text-xs muted" title={isoTime(c.createdAt)}>{timeAgo(c.createdAt, now)}</span>
              {c.withdrawn && <Label>withdrawn</Label>}
            </div>
            <div className="flex items-center gap-1">
              <button className="btn btn-sm" disabled={!signedIn} onClick={() => vote("comment", c.id)} title="Upvotes only affect sorting and visibility">
                {c.votedByMe ? "▲" : "△"} {c.votes}
              </button>
              {d.viewer.allowedKinds.length > 0 && (
                <button className="btn btn-sm" onClick={() => setReplyTo(c.id)}>Reply</button>
              )}
              {d.viewer.address === c.author.address && !c.withdrawn && (
                <button className="btn btn-sm" onClick={() => act(() => api(`/api/comments/${c.id}/withdraw`, { method: "POST" }))}>Withdraw</button>
              )}
            </div>
          </div>
          <div className="space-y-2 p-4">
            <Markdown>{c.body}</Markdown>
            {c.attachments.length > 0 && <AttachmentList items={c.attachments} />}
            {run?.report && (
              <details className="rounded-md border p-2" style={{ borderColor: "var(--border)" }} open={c.kind === "REPRODUCED" || c.kind === "REFUTED"}>
                <summary className="cursor-pointer text-sm font-semibold">
                  Attached evidence run #{run.id} <OutcomeLabel outcome={run.outcome} />
                </summary>
                <div className="mt-2">
                  <EvidenceReportView report={run.report} hash={run.reportHash} />
                </div>
              </details>
            )}
          </div>
        </div>
        {(children.get(c.id) ?? []).map((r) => renderComment(r, depth + 1))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs muted">
          <Link href={`/rooms/${d.room.id}`}>{d.room.packageName}@{d.room.version}</Link> / findings
        </div>
        <h1 className="text-2xl">
          {f.title} <span className="muted font-light">#{f.id}</span>
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full px-3 py-1 font-semibold text-white" style={{ background: stateColor }}>{state}</span>
          <Researcher who={f.author} /> <span className="muted">submitted {timeAgo(f.createdAt, now)} · {d.comments.length} responses</span>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <div>
          <div className="card">
            <div className="card-header py-2 text-sm">
              <div className="flex items-center gap-2">
                <Researcher who={f.author} role="author" /> <SeverityLabel severity={f.claimedSeverity} prefix="claimed" />
              </div>
              <button className="btn btn-sm" disabled={!signedIn} onClick={() => vote("finding", f.id)} title="Upvotes never decide validity, severity or payout">
                {f.votedByMe ? "▲" : "△"} {f.votes}
              </button>
            </div>
            <div className="space-y-4 p-4">
              <Markdown>{f.description}</Markdown>
              <Section title="Proof of concept"><Markdown>{f.proofOfConcept}</Markdown></Section>
              <Section title="Reproduction"><Markdown>{f.reproduction}</Markdown></Section>
              {f.observations.length > 0 && (
                <Section title="Claimed observable behaviour">
                  <div className="flex flex-wrap gap-1">
                    {f.observations.map((o) => <Label key={o} tone="accent">{OBSERVATION_LABELS[o]}</Label>)}
                  </div>
                </Section>
              )}
              {f.attachments.length > 0 && <Section title="Proof files"><AttachmentList items={f.attachments} /></Section>}
            </div>
          </div>

          {(children.get(null) ?? []).map((c) => renderComment(c, 0))}

          {f.verdict && (
            <div className="card mt-3" style={{ borderColor: "var(--done)" }}>
              <div className="card-header py-2 text-sm">
                <span className="flex items-center gap-2">
                  <b>Moderator adjudication</b> <VerdictLabel verdict={f.verdict} /> <SeverityLabel severity={f.finalSeverity} />
                  {f.duplicateOf && <span>duplicate of <Link href={`/rooms/${d.room.id}/findings/${f.duplicateOf}`}>#{f.duplicateOf}</Link></span>}
                </span>
                {f.adjudicatedAt && <span className="text-xs muted">{timeAgo(f.adjudicatedAt, now)}</span>}
              </div>
              <div className="p-4 text-sm">
                <Markdown>{f.verdictReasoning ?? ""}</Markdown>
                {f.materialReviewers.length > 0 && (
                  <div className="mt-2 text-xs">
                    Material review contributors: {f.materialReviewers.map((a) => <span key={a} className="mr-2"><Researcher who={{ address: a }} /></span>)}
                  </div>
                )}
                {f.awardWei && <div className="mt-2"><Label tone="done">awarded {mstc(f.awardWei)}</Label></div>}
              </div>
            </div>
          )}

          {d.appeal && (
            <div className="card mt-3" style={{ borderColor: d.appeal.status === "open" ? "var(--attention)" : "var(--done)" }}>
              <div className="card-header py-2 text-sm">
                <span className="flex items-center gap-2">
                  <b>Appeal</b>
                  <Label tone={d.appeal.status === "open" ? "attention" : d.appeal.status === "overturned" ? "accent" : "done"}>
                    {d.appeal.status}
                  </Label>
                </span>
                <span className="text-xs muted">filed {timeAgo(d.appeal.createdAt, now)}</span>
              </div>
              <div className="space-y-3 p-4 text-sm">
                <div>
                  <div className="mb-1 text-xs font-semibold muted"><Researcher who={{ address: d.appeal.appellant }} role="appellant" /> wrote</div>
                  <Markdown>{d.appeal.reason}</Markdown>
                </div>
                {d.appeal.reviewer && (
                  <div className="border-t pt-3" style={{ borderColor: "var(--border-muted)" }}>
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold muted">
                      <Researcher who={{ address: d.appeal.reviewer }} role="reviewer" /> decided {d.appeal.status}
                      {d.appeal.status === "overturned" && <VerdictLabel verdict={d.appeal.newVerdict} />}
                      {d.appeal.status === "overturned" && <SeverityLabel severity={d.appeal.newSeverity} />}
                      {d.appeal.newDuplicateOf && (
                        <span>duplicate of <Link href={`/rooms/${d.room.id}/findings/${d.appeal.newDuplicateOf}`}>#{d.appeal.newDuplicateOf}</Link></span>
                      )}
                    </div>
                    <Markdown>{d.appeal.decisionReasoning ?? ""}</Markdown>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && <div className="flash flash-error mt-3">{error}</div>}

          {d.viewer.allowedKinds.length > 0 ? (
            <Composer
              findingId={f.id}
              roomId={d.room.id}
              kinds={d.viewer.allowedKinds}
              replyTo={replyTo}
              clearReply={() => setReplyTo(null)}
              myRun={myRun}
              onPosted={() => {
                setReplyTo(null);
                setMyRun(null);
                router.refresh();
              }}
            />
          ) : (
            <div className="flash flash-info mt-4 text-sm">
              {!signedIn ? "Sign in with your wallet to take part in peer review." : d.room.phase === "hunting" ? "Discussion opens after the hunt closes." : "You cannot respond to this finding in the current phase."}
            </div>
          )}
        </div>

        <aside className="space-y-4 text-sm">
          <SideBox title="On-chain commitment">
            {f.onchain ? (
              <div className="space-y-1">
                <div>Index <b>{f.commitmentIndex}</b> · block {f.onchain.blockNumber}</div>
                <div className="text-xs muted">{isoTime(f.onchain.committedAt)}</div>
                <div><ExplorerLink explorer={explorer} kind="tx" value={f.onchain.txHash}>commit tx</ExplorerLink></div>
                <div className="mono break-all text-[11px] muted">{f.commitment}</div>
                {f.onchain.revealed ? (
                  <div style={{ color: f.onchain.revealedHashMatches ? "var(--success)" : "var(--danger)" }}>
                    {f.onchain.revealedHashMatches ? "✔ revealed; on-chain report hash matches" : "✘ revealed hash does not match this report"}{" "}
                    {f.onchain.revealTx && <ExplorerLink explorer={explorer} kind="tx" value={f.onchain.revealTx}>(tx)</ExplorerLink>}
                  </div>
                ) : (
                  <div style={{ color: "var(--attention)" }}>not revealed yet</div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p style={{ color: "var(--attention)" }}>Not committed on-chain.</p>
                {d.viewer.isAuthor && d.room.phase === "hunting" && (
                  <div className="flex gap-2">
                    <button className="btn btn-primary btn-sm" onClick={commitDraft}>Commit now</button>
                    <button className="btn btn-sm btn-danger" onClick={deleteDraft}>Delete draft</button>
                  </div>
                )}
              </div>
            )}
            {d.viewer.isAuthor && f.onchain && !f.onchain.revealed && (d.room.phase === "disclosure" || d.room.phase === "review") && (
              <button className="btn btn-primary btn-sm mt-2" onClick={reveal}>Reveal on-chain</button>
            )}
            <div className="mt-2 text-xs" style={{ color: recomputedHash === f.findingHash ? "var(--success)" : "var(--danger)" }}>
              {recomputedHash === f.findingHash ? "✔ report content hashes to the committed report hash" : "✘ report content does not match its hash"}
            </div>
          </SideBox>

          <SideBox title="Review signals">
            <div className="grid grid-cols-2 gap-1">
              <span>Reproduced</span><b style={{ color: "var(--success)" }}>{(counts.REPRODUCED ?? 0) + (counts.PARTIALLY_REPRODUCED ?? 0)}</b>
              <span>Refutations</span><b style={{ color: "var(--danger)" }}>{counts.REFUTED ?? 0}</b>
              <span>Unresolved objections</span><b style={{ color: d.unresolvedObjections ? "var(--attention)" : undefined }}>{d.unresolvedObjections}</b>
              <span>Evidence</span><b>{counts.ADDITIONAL_EVIDENCE ?? 0}</b>
              <span>Severity challenges</span><b>{counts.SEVERITY_CHALLENGE ?? 0}</b>
              <span>Upvotes</span><b>{f.votes}</b>
            </div>
            <p className="mt-2 text-xs muted">Signals inform the moderator. They are evidence, not an automatic vote.</p>
          </SideBox>

          <ReproducePanel findingId={f.id} canRun={signedIn && d.room.phase !== "hunting" || d.viewer.isAuthor} onResult={setMyRun} />

          {d.viewer.canAppeal && <AppealForm findingId={f.id} onDone={() => router.refresh()} />}

          {d.viewer.canDecideAppeal && d.appeal && <AppealDecisionForm appeal={d.appeal} finding={f} onDone={() => router.refresh()} />}

          {d.viewer.isRoomModerator && d.room.phase === "review" && f.status === "committed" && !d.appeal && (
            <AdjudicationForm
              findingId={f.id}
              current={f}
              reviewers={[...new Set(d.comments.filter((c) => !c.withdrawn && ![f.author.address, d.room.developer, d.room.moderator].includes(c.author.address)).map((c) => c.author.address))]}
              onDone={() => router.refresh()}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 border-b pb-1 text-sm font-semibold" style={{ borderColor: "var(--border-muted)" }}>{title}</h3>
      {children}
    </div>
  );
}

function SideBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b pb-4" style={{ borderColor: "var(--border-muted)" }}>
      <div className="mb-2 text-xs font-semibold muted">{title}</div>
      {children}
    </div>
  );
}

function AttachmentList({ items }: { items: Attachment[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {items.map((a) => (
        <li key={a.id}>
          📎 <a href={a.url}>{a.filename}</a> <span className="text-xs muted">{(a.size / 1024).toFixed(1)} KB · sha256 {short(a.sha256, 10)}</span>
          {a.mime.startsWith("image/") && !a.mime.includes("svg") && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.url} alt={a.filename} className="mt-1 max-h-72 rounded border" style={{ borderColor: "var(--border)" }} />
          )}
        </li>
      ))}
    </ul>
  );
}

function ReproducePanel({ findingId, canRun, onResult }: { findingId: number; canRun: boolean; onResult: (r: { id: number; report: EvidenceReport }) => void }) {
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: number; report: EvidenceReport } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setError(null);
    setResult(null);
    setProgress("Queuing…");
    try {
      const { id } = await api<{ id: number }>(`/api/findings/${findingId}/reproduce`, { method: "POST" });
      const done = await waitForEvidence<EvidenceReport>(id, (s) => setProgress(`Run #${s.id}: ${describeRunProgress(s)}`));
      const r = { id: done.id, report: done.report! };
      setResult(r);
      onResult(r);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  };
  return (
    <SideBox title="Agent + rule evidence engine">
      <button className="btn w-full" disabled={!canRun || !!progress} onClick={run}>
        {progress ?? "Run reproduction"}
      </button>
      <p className="mt-1 text-xs muted">Re-verifies the artifact hash, re-runs rules and fresh sandboxes, and lets the agent challenge the claim. Runs in the background; you can keep reading.</p>
      {result && (
        <div className="mt-2 space-y-1">
          <div>Run #{result.id}: <OutcomeLabel outcome={result.report.outcome} /></div>
          <p className="text-xs muted">Attach it to a reply below (it is pre-selected) so reviewers and the moderator can inspect the full trace.</p>
        </div>
      )}
      {error && <div className="flash flash-error mt-2">{error}</div>}
    </SideBox>
  );
}

function AppealForm({ findingId, onDone }: { findingId: number; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await api(`/api/findings/${findingId}/appeals`, { method: "POST", json: { reason } });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <SideBox title="Appeal this verdict">
      <div className="space-y-2">
        <textarea
          className="input min-h-28"
          placeholder="Explain why the recorded verdict should be reviewed (20 characters minimum)."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={5_000}
        />
        <button className="btn btn-primary w-full" disabled={submitting || reason.trim().length < 20} onClick={submit}>
          {submitting ? "Filing appeal…" : "File appeal"}
        </button>
        {error && <div className="flash flash-error">{error}</div>}
      </div>
    </SideBox>
  );
}

function AppealDecisionForm({
  appeal,
  finding,
  onDone,
}: {
  appeal: NonNullable<FindingDetail["appeal"]>;
  finding: FindingDetail["finding"];
  onDone: () => void;
}) {
  const [decision, setDecision] = useState<"upheld" | "overturned">("upheld");
  const [verdict, setVerdict] = useState<"valid" | "duplicate" | "invalid" | "inconclusive">(
    finding.verdict === "valid" || finding.verdict === "duplicate" || finding.verdict === "invalid" || finding.verdict === "inconclusive"
      ? finding.verdict
      : "valid",
  );
  const [severity, setSeverity] = useState<Severity>((finding.finalSeverity as Severity) ?? finding.claimedSeverity);
  const [duplicateOf, setDuplicateOf] = useState(finding.duplicateOf ? String(finding.duplicateOf) : "");
  const [reasoning, setReasoning] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await api(`/api/appeals/${appeal.id}/decide`, {
        method: "POST",
        json: {
          decision,
          reasoning,
          newVerdict: decision === "overturned" ? verdict : undefined,
          newSeverity: decision === "overturned" && verdict === "valid" ? severity : undefined,
          newDuplicateOf: decision === "overturned" && verdict === "duplicate" ? Number(duplicateOf) : undefined,
        },
      });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };
  const invalidDuplicate = decision === "overturned" && verdict === "duplicate" && !duplicateOf;
  return (
    <SideBox title="Moderator: decide appeal">
      <div className="space-y-2">
        <select className="input" value={decision} onChange={(e) => setDecision(e.target.value as "upheld" | "overturned")}>
          <option value="upheld">Uphold verdict</option>
          <option value="overturned">Overturn verdict</option>
        </select>
        {decision === "overturned" && (
          <>
            <select className="input" value={verdict} onChange={(e) => setVerdict(e.target.value as typeof verdict)}>
              <option value="valid">Valid</option>
              <option value="duplicate">Independent duplicate</option>
              <option value="invalid">Invalid</option>
              <option value="inconclusive">Inconclusive</option>
            </select>
            {verdict === "valid" && (
              <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                {SEVERITIES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            )}
            {verdict === "duplicate" && (
              <input className="input" placeholder="original valid finding #" value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value.replace(/\D/g, ""))} />
            )}
          </>
        )}
        <textarea
          className="input min-h-24"
          placeholder="Public decision reasoning (required)"
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          maxLength={10_000}
        />
        <button className="btn btn-primary w-full" disabled={submitting || reasoning.trim().length < 10 || invalidDuplicate} onClick={submit}>
          {submitting ? "Recording decision…" : decision === "upheld" ? "Uphold verdict" : "Overturn verdict"}
        </button>
        {error && <div className="flash flash-error">{error}</div>}
      </div>
    </SideBox>
  );
}

function Composer(props: {
  findingId: number;
  roomId: number;
  kinds: CommentKind[];
  replyTo: number | null;
  clearReply: () => void;
  myRun: { id: number; report: EvidenceReport } | null;
  onPosted: () => void;
}) {
  const [kind, setKind] = useState<CommentKind>(props.kinds[0]);
  const [body, setBody] = useState("");
  const [sev, setSev] = useState<Severity>("medium");
  const [dup, setDup] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [attachRun, setAttachRun] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const post = async () => {
    setError(null);
    setPosting(true);
    try {
      await api(`/api/findings/${props.findingId}/comments`, {
        method: "POST",
        json: {
          kind,
          body,
          parentId: props.replyTo,
          proposedSeverity: kind === "SEVERITY_CHALLENGE" ? sev : null,
          duplicateOf: kind === "DUPLICATE" ? Number(dup) : null,
          evidenceRunId: attachRun && props.myRun ? props.myRun.id : null,
          attachmentIds: files.map((f) => f.id),
        },
      });
      setBody("");
      setFiles([]);
      props.onPosted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="card mt-4">
      <div className="card-header py-2 text-sm">
        <b>{props.replyTo ? `Reply to response #${props.replyTo}` : "Add a response"}</b>
        {props.replyTo && <button className="btn btn-sm" onClick={props.clearReply}>cancel reply</button>}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex flex-wrap gap-2">
          <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value as CommentKind)}>
            {props.kinds.map((k) => <option key={k} value={k}>{COMMENT_KIND_LABEL[k]}</option>)}
          </select>
          {kind === "SEVERITY_CHALLENGE" && (
            <select className="input w-auto" value={sev} onChange={(e) => setSev(e.target.value as Severity)}>
              {SEVERITIES.map((s) => <option key={s} value={s}>proposed: {s}</option>)}
            </select>
          )}
          {kind === "DUPLICATE" && <input className="input w-40" placeholder="original finding #" value={dup} onChange={(e) => setDup(e.target.value.replace(/\D/g, ""))} />}
        </div>
        <MarkdownEditor value={body} onChange={setBody} placeholder="Explain what you ran, what you observed and in which environment. Evidence beats opinion." minRows={5} />
        <AttachmentPicker files={files} onChange={setFiles} />
        {props.myRun && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={attachRun} onChange={(e) => setAttachRun(e.target.checked)} />
            Attach evidence run #{props.myRun.id} ({props.myRun.report.outcome?.replace(/_/g, " ")})
          </label>
        )}
        {error && <div className="flash flash-error">{error}</div>}
        <div className="flex justify-end">
          <button className="btn btn-primary" disabled={posting || !body.trim()} onClick={post}>
            {posting ? "Posting…" : `Post ${COMMENT_KIND_LABEL[kind].toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdjudicationForm({
  findingId,
  current,
  reviewers,
  onDone,
}: {
  findingId: number;
  current: FindingDetail["finding"];
  reviewers: string[];
  onDone: () => void;
}) {
  const [verdict, setVerdict] = useState(current.verdict ?? "valid");
  const [severity, setSeverity] = useState<Severity>((current.finalSeverity as Severity) ?? current.claimedSeverity);
  const [dup, setDup] = useState(current.duplicateOf ? String(current.duplicateOf) : "");
  const [reasoning, setReasoning] = useState(current.verdictReasoning ?? "");
  const [picked, setPicked] = useState<string[]>(current.materialReviewers);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await api(`/api/findings/${findingId}/adjudicate`, {
        method: "POST",
        json: {
          verdict,
          finalSeverity: verdict === "valid" ? severity : null,
          duplicateOf: verdict === "duplicate" ? Number(dup) : null,
          reasoning,
          materialReviewers: picked,
        },
      });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <SideBox title="Moderator: adjudicate">
      <div className="space-y-2">
        <select className="input" value={verdict} onChange={(e) => setVerdict(e.target.value)}>
          <option value="valid">Valid</option>
          <option value="duplicate">Independent duplicate</option>
          <option value="invalid">Invalid</option>
          <option value="inconclusive">Inconclusive</option>
        </select>
        {verdict === "valid" && (
          <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {verdict === "duplicate" && <input className="input" placeholder="original finding #" value={dup} onChange={(e) => setDup(e.target.value.replace(/\D/g, ""))} />}
        <textarea className="input min-h-24" placeholder="Public reasoning (required)" value={reasoning} onChange={(e) => setReasoning(e.target.value)} />
        {reviewers.length > 0 && (
          <div>
            <div className="text-xs font-semibold muted">Material review contributors</div>
            {reviewers.map((r) => (
              <label key={r} className="flex items-center gap-2">
                <input type="checkbox" checked={picked.includes(r)} onChange={() => setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))} />
                <span className="mono">{short(r, 8)}</span>
              </label>
            ))}
          </div>
        )}
        <button className="btn btn-primary w-full" onClick={save}>Record verdict</button>
        {error && <div className="flash flash-error">{error}</div>}
      </div>
    </SideBox>
  );
}
