"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { adjudicationHash } from "@/lib/canonical";
import { releaseBondAbi } from "@/lib/chain/releaseBondArtifact";
import { api, errorMessage } from "@/lib/client/api";
import type { Phase } from "@/lib/phase";
import { useWallet } from "./WalletProvider";

interface Prepared {
  adjudicationHash: Hex;
  args: {
    discoveries: { commitmentIndex: number; severity: number; duplicate: boolean; amount: string }[];
    reviews: { reviewer: Address; amount: string }[];
    rejected: number[];
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
}) {
  const router = useRouter();
  const { config, sendTx } = useWallet();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Anyone can recompute the adjudication hash from the published record.
  const recomputed = useMemo(() => (props.record ? adjudicationHash(JSON.parse(props.record)) : null), [props.record]);

  const prepare = async () => {
    setError(null);
    try {
      setPrepared(await api<Prepared>(`/api/rooms/${props.roomId}/settlement`, { method: "POST" }));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const sign = async () => {
    if (!prepared) return;
    setError(null);
    try {
      await sendTx("Finalize settlement", (w, acct) =>
        w.writeContract({
          address: config.contractAddress as Address,
          abi: releaseBondAbi,
          functionName: "finalizeSettlement",
          args: [
            BigInt(props.roomId),
            prepared.args.discoveries.map((d) => ({ commitmentIndex: d.commitmentIndex, severity: d.severity, duplicate: d.duplicate, amount: BigInt(d.amount) })),
            prepared.args.reviews.map((r) => ({ reviewer: r.reviewer, amount: BigInt(r.amount) })),
            prepared.args.rejected,
            prepared.adjudicationHash,
          ],
          account: acct,
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
        {props.record ? (
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
              <pre className="mono mt-2 max-h-96 overflow-auto rounded p-2" style={{ background: "var(--bg-subtle)" }}>{JSON.stringify(JSON.parse(props.record), null, 2)}</pre>
            </details>
          </>
        ) : (
          <p className="muted">No adjudication record has been prepared yet.</p>
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
                  <button className="btn btn-primary" disabled={!prepared} onClick={sign}>2. Sign finalizeSettlement</button>
                </div>
                {prepared && (
                  <p className="mt-2 text-xs muted">
                    Record hash <span className="mono">{prepared.adjudicationHash}</span> · {prepared.args.discoveries.length} discovery award(s),{" "}
                    {prepared.args.reviews.length} review award(s), {prepared.args.rejected.length} rejected. The contract re-checks caps, reveals and the bounty limit.
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
