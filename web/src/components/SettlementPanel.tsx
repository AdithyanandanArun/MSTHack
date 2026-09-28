"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { adjudicationHash, SETTLEMENT_TYPES, settlementDomain } from "@/lib/canonical";
import { releaseBondAbi } from "@/lib/chain/releaseBondArtifact";
import { api, errorMessage } from "@/lib/client/api";
import { short } from "@/lib/format";
import type { Phase } from "@/lib/phase";
import { useWallet } from "./WalletProvider";

interface FrozenRecord {
  awards: {
    discoveries: { commitmentIndex: number; severity: number; duplicate: boolean; amount: string }[];
    reviews: { reviewer: Address; amount: string }[];
    rejected: number[];
  };
}

interface PanelStatus {
  panel: string[];
  quorum: number;
  frozen: { adjudicationHash: Hex; awardsHash: Hex } | null;
  approvals: { signer: string; signature: Hex }[];
}

/** finalizeSettlement arguments rebuilt from the frozen public record. */
function awardArgs(record: FrozenRecord) {
  return {
    discoveries: record.awards.discoveries.map((d) => ({ commitmentIndex: d.commitmentIndex, severity: d.severity, duplicate: d.duplicate, amount: BigInt(d.amount) })),
    reviews: record.awards.reviews.map((r) => ({ reviewer: r.reviewer, amount: BigInt(r.amount) })),
    rejected: record.awards.rejected,
  };
}

export function SettlementPanel(props: {
  roomId: number;
  isModerator: boolean;
  phase: Phase;
  settled: boolean;
  onchainHash: string | null;
  record: string | null;
  pendingVerdicts: number[];
  hasPanel: boolean;
}) {
  const router = useRouter();
  const { config, sendTx, signTyped, account } = useWallet();
  const [record, setRecord] = useState<FrozenRecord | null>(props.record ? JSON.parse(props.record) : null);
  const [panel, setPanel] = useState<PanelStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Anyone can recompute the adjudication hash from the published record.
  const recomputed = useMemo(() => (record ? adjudicationHash(record) : null), [record]);
  const me = account?.toLowerCase();
  const isPanelist = !!me && !!panel?.panel.includes(me);
  const approvedByMe = !!me && !!panel?.approvals.some((a) => a.signer === me);
  const quorumMet = !panel || panel.approvals.length >= panel.quorum;

  const loadPanel = useCallback(async () => {
    if (!props.hasPanel) return;
    const s = await api<{ panel: PanelStatus | null; adjudicationRecord: FrozenRecord | null }>(`/api/rooms/${props.roomId}/settlement`);
    setPanel(s.panel);
    if (s.adjudicationRecord) setRecord(s.adjudicationRecord);
  }, [props.hasPanel, props.roomId]);

  useEffect(() => {
    void loadPanel().catch(() => undefined);
  }, [loadPanel]);

  const prepare = async () => {
    setError(null);
    try {
      const r = await api<{ record: FrozenRecord }>(`/api/rooms/${props.roomId}/settlement`, { method: "POST" });
      setRecord(r.record);
      await loadPanel();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const approve = async () => {
    if (!panel?.frozen) return;
    setError(null);
    try {
      const signature = await signTyped({
        domain: settlementDomain(config.chainId, config.contractAddress as Address),
        types: SETTLEMENT_TYPES,
        primaryType: "Settlement",
        message: { roomId: BigInt(props.roomId), adjudicationHash: panel.frozen.adjudicationHash, awardsHash: panel.frozen.awardsHash },
      });
      await api(`/api/rooms/${props.roomId}/settlement/approve`, { method: "POST", json: { signature } });
      await loadPanel();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const sign = async () => {
    if (!record || !recomputed) return;
    setError(null);
    try {
      const a = awardArgs(record);
      const signatures = (panel?.approvals ?? []).map((x) => x.signature);
      await sendTx("Finalize settlement", (w) =>
        w.writeContract({
          address: config.contractAddress as Address,
          abi: releaseBondAbi,
          functionName: "finalizeSettlement",
          args: [BigInt(props.roomId), a.discoveries, a.reviews, a.rejected, recomputed, signatures],
          chain: w.chain,
        }),
      );
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <h3 className="font-semibold">Public adjudication record</h3>
      </div>
      <div className="space-y-3 p-4 text-sm">
        {record ? (
          <>
            <div>
              Record hash (recomputed in your browser): <span className="mono break-all">{recomputed}</span>
            </div>
            {props.onchainHash && (
              <div style={{ color: props.onchainHash === recomputed ? "var(--success)" : "var(--danger)" }}>
                {props.onchainHash === recomputed ? "✔ matches the adjudication hash stored on-chain" : `✘ differs from on-chain hash ${props.onchainHash}`}
              </div>
            )}
            <details>
              <summary className="cursor-pointer muted">View record JSON</summary>
              <pre className="mono mt-2 max-h-96 overflow-auto rounded p-2" style={{ background: "var(--bg-subtle)" }}>{JSON.stringify(record, null, 2)}</pre>
            </details>
          </>
        ) : (
          <p className="muted">No adjudication record has been prepared yet.</p>
        )}

        {panel && (
          <div className="rounded-md border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="font-semibold">
              Moderator panel: {panel.approvals.length} of {panel.quorum} required approvals
            </div>
            <ul className="mt-1 space-y-0.5">
              {panel.panel.map((m) => (
                <li key={m} className="mono">
                  {panel.approvals.some((a) => a.signer === m) ? "✔" : "○"} {short(m, 10)}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs muted">
              Panelists sign the exact awards of the frozen record (EIP-712). The contract rejects settlement without a quorum, or if any amount differs from what they signed.
            </p>
            {isPanelist && !props.settled && props.phase === "review" && (
              <button className="btn btn-primary mt-2" disabled={!panel.frozen || approvedByMe} onClick={approve}>
                {approvedByMe ? "You approved this record" : panel.frozen ? "Approve this settlement (sign)" : "Waiting for the moderator to freeze the record"}
              </button>
            )}
          </div>
        )}

        {props.isModerator && !props.settled && (
          <div className="rounded-md border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="font-semibold">Moderator: finalize settlement</div>
            {props.phase !== "review" ? (
              <p className="muted">Settlement opens when the private disclosure window ends (room is {props.phase}).</p>
            ) : (
              <>
                {props.pendingVerdicts.length > 0 && (
                  <p style={{ color: "var(--attention)" }}>Findings without a verdict: #{props.pendingVerdicts.join(", #")}. Unrevealed ones can be left open.</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="btn" onClick={prepare}>1. Freeze adjudication record</button>
                  <button className="btn btn-primary" disabled={!record || !quorumMet} onClick={sign}>
                    2. Sign finalizeSettlement
                  </button>
                </div>
                {record && (
                  <p className="mt-2 text-xs muted">
                    {record.awards.discoveries.length} discovery award(s), {record.awards.reviews.length} review award(s), {record.awards.rejected.length} rejected.
                    {panel && !quorumMet ? " Waiting for panel approvals." : " The contract re-checks caps, reveals and the bounty limit."}
                    {" "}Re-freezing after a verdict changes invalidates earlier panel approvals.
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {error && <div className="flash flash-error">{error}</div>}
      </div>
    </section>
  );
}
