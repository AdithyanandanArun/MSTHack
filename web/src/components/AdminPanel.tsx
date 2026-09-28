"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { isAddress, type Address } from "viem";
import { releaseBondAbi, releaseBondBytecode } from "@/lib/chain/releaseBondArtifact";
import { api, errorMessage } from "@/lib/client/api";
import { short } from "@/lib/format";
import { useSignedIn, useWallet } from "./WalletProvider";

export function DeployContract({ hasContract, isOwner }: { hasContract: boolean; isOwner: boolean }) {
  const router = useRouter();
  const { sendTx, account, config, publicClient } = useWallet();
  const signedIn = useSignedIn();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const deploy = async () => {
    setError(null);
    try {
      let txHash: `0x${string}` | null = null;
      // sendTx indexes via /api/chain/sync, which needs a configured contract;
      // registration below handles a fresh deployment, so ignore that step's result.
      await sendTx("Deploy ReleaseBond", async (w, acct) => {
        txHash = await w.deployContract({ abi: releaseBondAbi, bytecode: releaseBondBytecode, args: [acct], account: acct, chain: w.chain });
        return txHash;
      }).catch(async (e) => {
        if (!txHash) throw e;
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      });
      const r = await api<{ address: string }>("/api/admin/contract", { method: "POST", json: { txHash } });
      setDone(r.address);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (hasContract && !isOwner) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm">
        Deploys the tested <span className="mono">ReleaseBond</span> contract to <b>{config.chainName}</b> from your connected wallet (you
        become its owner and first moderator). Cost is about 3.3M gas (~0.0033 MSTC at 1 gwei).
      </p>
      {hasContract && <p className="text-sm" style={{ color: "var(--attention)" }}>A contract is already configured; deploying again replaces it for this server.</p>}
      <button className="btn btn-primary" disabled={!signedIn || !account} onClick={deploy}>Deploy ReleaseBond from my wallet</button>
      {!signedIn && <span className="ml-2 text-sm muted">Sign in first.</span>}
      {done && <div className="flash flash-success">Deployed and registered at <span className="mono">{done}</span>.</div>}
      {error && <div className="flash flash-error">{error}</div>}
    </div>
  );
}

export function ModeratorAdmin({ moderators }: { moderators: string[] }) {
  const router = useRouter();
  const { sendTx, config } = useWallet();
  const [addr, setAddr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const set = async (a: string, enabled: boolean) => {
    setError(null);
    try {
      if (!isAddress(a)) throw new Error("enter a valid address");
      await sendTx(enabled ? "Add moderator" : "Remove moderator", (w, acct) =>
        w.writeContract({ address: config.contractAddress as Address, abi: releaseBondAbi, functionName: "setModerator", args: [a as Address, enabled], account: acct, chain: w.chain }),
      );
      setAddr("");
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div className="space-y-2 text-sm">
      <ul className="space-y-1">
        {moderators.map((m) => (
          <li key={m} className="flex items-center gap-2">
            <span className="mono">{m}</span>
            <button className="btn btn-sm btn-danger" onClick={() => set(m, false)}>remove</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className="input" placeholder="0x… moderator address" value={addr} onChange={(e) => setAddr(e.target.value.trim())} />
        <button className="btn" onClick={() => set(addr, true)}>Add moderator</button>
      </div>
      {error && <div className="flash flash-error">{error}</div>}
    </div>
  );
}

export function VerifyResearcher() {
  const [addr, setAddr] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (verified: boolean) => {
    setMsg(null);
    try {
      await api("/api/admin/verify-researcher", { method: "POST", json: { address: addr, verified } });
      setMsg(`${short(addr, 8)} ${verified ? "verified" : "unverified"}.`);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <div className="space-y-2 text-sm">
      <p className="muted">Grant the verified-human badge after an off-platform identity check (the mechanism is an open decision; see the spec §8).</p>
      <div className="flex gap-2">
        <input className="input" placeholder="0x… researcher address" value={addr} onChange={(e) => setAddr(e.target.value.trim())} />
        <button className="btn" onClick={() => run(true)}>Verify</button>
        <button className="btn" onClick={() => run(false)}>Revoke</button>
      </div>
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}
