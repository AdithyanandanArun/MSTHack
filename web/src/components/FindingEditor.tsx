"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Address, Hex } from "viem";
import {
  computeCommitment,
  findingHash,
  OBSERVATION_LABELS,
  OBSERVATIONS,
  randomNonce,
  SEVERITIES,
  type Observation,
  type Severity,
} from "@/lib/canonical";
import { releaseBondAbi } from "@/lib/chain/releaseBondArtifact";
import { api, errorMessage } from "@/lib/client/api";
import { AttachmentPicker, type UploadedFile } from "./Attachments";
import { MarkdownEditor } from "./MarkdownEditor";
import { useSignedIn, useWallet } from "./WalletProvider";

const TEMPLATE = `## Summary

What is wrong with this exact release, and why does it matter?

## Impact

Who is affected and what can an attacker do?

## Root cause

Point at the code (file:line) responsible.
`;

export function FindingEditor({ roomId, artifactHash, packageLabel }: { roomId: number; artifactHash: Hex; packageLabel: string }) {
  const router = useRouter();
  const { config, account, sendTx } = useWallet();
  const signedIn = useSignedIn();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<Severity>("high");
  const [observations, setObservations] = useState<Observation[]>([]);
  const [description, setDescription] = useState(TEMPLATE);
  const [poc, setPoc] = useState("");
  const [repro, setRepro] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);

  const toggle = (o: Observation) => setObservations((cur) => (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]));

  const submit = async () => {
    if (!account) return;
    setError(null);
    try {
      setStep("Hashing report…");
      const nonce = randomNonce();
      const content = {
        roomId,
        title,
        claimedSeverity: severity,
        description,
        proofOfConcept: poc,
        reproduction: repro,
        observations,
        attachments: files.map((f) => f.sha256),
      };
      const fh = findingHash(content);
      const commitment = computeCommitment({ roomId, artifactHash, findingHash: fh, researcher: account, nonce });
      // Local backup: without the nonce a commitment cannot be revealed.
      try {
        localStorage.setItem(`rb:finding:${commitment}`, JSON.stringify({ nonce, content, savedAt: Date.now() }));
      } catch {
        /* storage unavailable */
      }
      setStep("Saving private report…");
      const created = await api<{ id: number }>(`/api/rooms/${roomId}/findings`, {
        method: "POST",
        json: { ...content, attachmentIds: files.map((f) => f.id), nonce, findingHash: fh, commitment },
      });
      setStep(null);
      await sendTx("Commit finding", (w, acct) =>
        w.writeContract({
          address: config.contractAddress as Address,
          abi: releaseBondAbi,
          functionName: "commitFinding",
          args: [BigInt(roomId), commitment],
          account: acct,
          chain: w.chain,
        }),
      );
      router.push(`/rooms/${roomId}/findings/${created.id}`);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setStep(null);
    }
  };

  const valid = title.trim().length >= 5 && description.trim().length >= 20;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_280px]">
      <div className="space-y-4">
        <input className="input text-base" placeholder="Title — e.g. postinstall reads ~/.ssh keys and posts them to a remote host" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <div>
          <span className="field-label">Description</span>
          <MarkdownEditor value={description} onChange={setDescription} minRows={10} />
        </div>
        <div>
          <span className="field-label">Proof of concept</span>
          <MarkdownEditor value={poc} onChange={setPoc} placeholder="Code, commands, traces, screenshots (attach below)…" />
        </div>
        <div>
          <span className="field-label">Reproduction steps</span>
          <MarkdownEditor value={repro} onChange={setRepro} placeholder={"1. npm install " + packageLabel + "\n2. …"} minRows={4} />
        </div>
        <div>
          <span className="field-label">Proof files</span>
          <AttachmentPicker files={files} onChange={setFiles} disabled={!signedIn} />
        </div>
        {error && <div className="flash flash-error">{error}</div>}
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" disabled={!signedIn || !valid || !!step} onClick={submit}>
            {step ?? "Commit finding on-chain"}
          </button>
          {!signedIn && <span className="text-sm muted">Sign in with your wallet first.</span>}
        </div>
      </div>

      <aside className="space-y-4 text-sm">
        <div>
          <span className="field-label">Claimed severity</span>
          <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <span className="field-label">Machine-checkable observations</span>
          <p className="mb-1 text-xs muted">The evidence engine re-checks each of these against the exact artifact.</p>
          {OBSERVATIONS.map((o) => (
            <label key={o} className="flex items-start gap-2 py-0.5">
              <input type="checkbox" checked={observations.includes(o)} onChange={() => toggle(o)} className="mt-1" />
              <span>{OBSERVATION_LABELS[o]}</span>
            </label>
          ))}
        </div>
        <div className="flash flash-info text-xs">
          <b>How privacy works.</b> Only <span className="mono">keccak256(roomId, artifactHash, reportHash, you, nonce)</span> goes on-chain now.
          The report stays private until the hunt closes; then you reveal the nonce on-chain to prove you had this exact report at this block.
          The report is frozen once committed.
        </div>
      </aside>
    </div>
  );
}
