"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Address } from "viem";
import { releaseBondAbi } from "@/lib/chain/releaseBondArtifact";
import { api, errorMessage } from "@/lib/client/api";
import { mstc } from "@/lib/format";
import { useWallet } from "./WalletProvider";

export function WithdrawBox({ pendingWei }: { pendingWei: string }) {
  const router = useRouter();
  const { config, sendTx } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const withdraw = async () => {
    setError(null);
    try {
      await sendTx("Withdraw", (w, acct) =>
        w.writeContract({ address: config.contractAddress as Address, abi: releaseBondAbi, functionName: "withdraw", args: [], account: acct, chain: w.chain }),
      );
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <div className="text-xs muted">Claimable from ReleaseBond (awards and refunds)</div>
        <div className="text-2xl font-semibold">{mstc(pendingWei)}</div>
      </div>
      <button className="btn btn-primary" disabled={BigInt(pendingWei) === 0n} onClick={withdraw}>Withdraw to wallet</button>
      {error && <div className="flash flash-error w-full">{error}</div>}
    </div>
  );
}

export function ProfileForm({ handle, bio }: { handle: string | null; bio: string | null }) {
  const router = useRouter();
  const { refreshSession } = useWallet();
  const [h, setH] = useState(handle ?? "");
  const [b, setB] = useState(bio ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setMsg(null);
    try {
      await api("/api/profile", { method: "PATCH", json: { handle: h || null, bio: b || null } });
      setMsg("Saved.");
      await refreshSession();
      router.refresh();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="field-label">Public handle</span>
        <input className="input" value={h} onChange={(e) => setH(e.target.value)} placeholder="alice" />
      </label>
      <label className="block">
        <span className="field-label">Bio</span>
        <textarea className="input" value={b} onChange={(e) => setB(e.target.value)} maxLength={500} />
      </label>
      <button className="btn" onClick={save}>Save profile</button>
      {msg && <span className="ml-2 text-sm muted">{msg}</span>}
    </div>
  );
}
