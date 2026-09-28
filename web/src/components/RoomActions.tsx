"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseEther, type Address, type Hex } from "viem";
import { releaseBondAbi } from "@/lib/chain/releaseBondArtifact";
import { api, errorMessage } from "@/lib/client/api";
import type { Phase } from "@/lib/phase";
import type { EvidenceReport } from "@/lib/evidence/types";
import { EvidenceReportView } from "./EvidenceReport";
import { useSignedIn, useWallet } from "./WalletProvider";

export interface RevealTarget {
  findingId: number;
  title: string;
  commitmentIndex: number;
}

export function RoomActions(props: {
  roomId: number;
  phase: Phase;
  developer: string;
  moderator: string;
  commitments: number;
  myUnrevealed: RevealTarget[];
}) {
  const router = useRouter();
  const { config, account, sendTx } = useWallet();
  const signedIn = useSignedIn();
  const [error, setError] = useState<string | null>(null);
  const [topUp, setTopUp] = useState("");
  const me = account?.toLowerCase();
  const isDev = me === props.developer;
  const isMod = me === props.moderator;
  const address = config.contractAddress as Address;

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(`${label}: ${errorMessage(e)}`);
    }
  };

  const reveal = (t: RevealTarget) =>
    act("Reveal", async () => {
      const detail = await api<{ finding: { findingHash: Hex; nonce: Hex | null } }>(`/api/findings/${t.findingId}`);
      if (!detail.finding.nonce) throw new Error("nonce unavailable");
      await sendTx("Reveal finding", (w, acct) =>
        w.writeContract({
          address,
          abi: releaseBondAbi,
          functionName: "revealFinding",
          args: [BigInt(props.roomId), t.commitmentIndex, detail.finding.findingHash, detail.finding.nonce as Hex],
          account: acct,
          chain: w.chain,
        }),
      );
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {props.phase === "hunting" && !isDev && !isMod && (
          <Link href={`/rooms/${props.roomId}/findings/new`} className="btn btn-primary">
            Submit private finding
          </Link>
        )}
        {props.phase === "hunting" && isDev && signedIn && (
          <span className="inline-flex gap-1">
            <input className="input w-28" placeholder="MSTC" value={topUp} onChange={(e) => setTopUp(e.target.value)} />
            <button
              className="btn"
              onClick={() =>
                act("Increase bounty", () =>
                  sendTx("Increase bounty", (w, acct) =>
                    w.writeContract({ address, abi: releaseBondAbi, functionName: "increaseBounty", args: [BigInt(props.roomId)], value: parseEther(topUp || "0"), account: acct, chain: w.chain }),
                  ),
                )
              }
            >
              Add to pool
            </button>
          </span>
        )}
        {isDev && props.commitments === 0 && ["disclosure", "review", "expired"].includes(props.phase) && (
          <button
            className="btn"
            onClick={() =>
              act("Reclaim", () =>
                sendTx("Reclaim unused pool", (w, acct) =>
                  w.writeContract({ address, abi: releaseBondAbi, functionName: "reclaimUnused", args: [BigInt(props.roomId)], account: acct, chain: w.chain }),
                ),
              )
            }
          >
            Reclaim unused pool
          </button>
        )}
        {props.phase === "expired" && signedIn && (
          <button
            className="btn btn-danger"
            onClick={() =>
              act("Refund", () =>
                sendTx("Return expired pool", (w, acct) =>
                  w.writeContract({ address, abi: releaseBondAbi, functionName: "refundExpired", args: [BigInt(props.roomId)], account: acct, chain: w.chain }),
                ),
              )
            }
          >
            Return expired pool to developer
          </button>
        )}
      </div>
      {props.myUnrevealed.length > 0 && (props.phase === "disclosure" || props.phase === "review") && (
        <div className="flash flash-warn">
          <b>Reveal your commitments.</b> Only findings revealed on-chain can receive a discovery award.
          <ul className="mt-2 space-y-1">
            {props.myUnrevealed.map((t) => (
              <li key={t.findingId} className="flex items-center gap-2">
                <button className="btn btn-sm btn-primary" onClick={() => reveal(t)}>Reveal</button>
                #{t.findingId} {t.title} <span className="muted">(commitment {t.commitmentIndex})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <div className="flash flash-error">{error}</div>}
    </div>
  );
}

export function TriagePanel({ roomId, initial }: { roomId: number; initial: { report: EvidenceReport; reportHash?: string | null } | null }) {
  const signedIn = useSignedIn();
  const { config } = useWallet();
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setError(null);
    setLoading(true);
    try {
      setData(await api<{ report: EvidenceReport; reportHash?: string | null }>(`/api/rooms/${roomId}/scan`, { method: "POST" }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="font-semibold">Agent + rule triage of this release</h3>
          <p className="text-xs muted">
            The agent proposes what to investigate; the rule engine records facts{config.sandboxEnabled ? " (including a no-network sandbox run)" : ""}. Nothing here is a verdict.
          </p>
        </div>
        <button className="btn" disabled={!signedIn || loading} onClick={run}>
          {loading ? "Analysing…" : data ? "Re-run" : "Run triage"}
        </button>
      </div>
      <div className="p-4">
        {data ? <EvidenceReportView report={data.report} hash={data.reportHash} /> : <p className="muted text-sm">No triage has been run yet.</p>}
        {error && <div className="flash flash-error mt-2">{error}</div>}
      </div>
    </div>
  );
}
