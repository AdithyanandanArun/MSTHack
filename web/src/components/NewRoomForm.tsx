"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { decodeEventLog, parseEther, type Address, type Hex } from "viem";
import { releaseBondAbi } from "@/lib/chain/releaseBondArtifact";
import { api, errorMessage } from "@/lib/client/api";
import { short } from "@/lib/format";
import { ArtifactCard, type ArtifactView } from "./ArtifactCard";
import { useSignedIn, useWallet } from "./WalletProvider";
import { SignInLink } from "./WalletButton";

const HUNT = [
  { label: "3 minutes (demo)", s: 180 },
  { label: "1 hour", s: 3600 },
  { label: "1 day", s: 86400 },
  { label: "3 days", s: 3 * 86400 },
  { label: "7 days", s: 7 * 86400 },
  { label: "14 days", s: 14 * 86400 },
];
const DISCLOSURE = [
  { label: "none (demo)", s: 0 },
  { label: "2 minutes (demo)", s: 120 },
  { label: "1 day", s: 86400 },
  { label: "3 days", s: 3 * 86400 },
  { label: "7 days", s: 7 * 86400 },
  { label: "14 days", s: 14 * 86400 },
];
const ADJ = [
  { label: "1 day", s: 86400 },
  { label: "7 days", s: 7 * 86400 },
  { label: "14 days", s: 14 * 86400 },
  { label: "30 days", s: 30 * 86400 },
];

export function NewRoomForm() {
  const router = useRouter();
  const { config, account, sendTx, publicClient, walletId } = useWallet();
  const signedIn = useSignedIn();
  const [mode, setMode] = useState<"registry" | "upload">("registry");
  const [ecosystem, setEcosystem] = useState<"npm" | "pacman">("npm");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previous, setPrevious] = useState<File | null>(null);
  const [artifact, setArtifact] = useState<ArtifactView | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [bounty, setBounty] = useState("1");
  const [hunt, setHunt] = useState(HUNT[2].s);
  const [disclosure, setDisclosure] = useState(DISCLOSURE[2].s);
  const [adjWindow, setAdjWindow] = useState(ADJ[1].s);
  const moderators = config.moderators.filter((m) => m !== account?.toLowerCase());
  const [moderator, setModerator] = useState("");
  const [requireVerified, setRequireVerified] = useState(false);
  const [panel, setPanel] = useState<string[]>([]);
  const [panelQuorum, setPanelQuorum] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchArtifact = async () => {
    setError(null);
    setArtifact(null);
    setLoading(true);
    try {
      if (mode === "registry") {
        setArtifact(await api<ArtifactView>("/api/artifacts", { method: "POST", json: { ecosystem, name: name.trim(), version: version.trim() } }));
      } else {
        if (!file) throw new Error("choose the artifact file");
        const form = new FormData();
        form.set("ecosystem", ecosystem);
        form.set("file", file);
        if (previous) form.set("previous", previous);
        setArtifact(await api<ArtifactView>("/api/artifacts", { method: "POST", body: form }));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const openRoom = async () => {
    if (!artifact) return;
    setError(null);
    try {
      const mod = moderator || moderators[0];
      if (!mod) throw new Error("no registered moderator other than you is available");
      const value = parseEther(bounty);
      if (value <= 0n) throw new Error("bounty must be positive");
      const draft = await api<{ contract: Address; params: { ecosystem: string; packageName: string; version: string; artifactHash: Hex; previousArtifactHash: Hex; moderator: Address; panel: Address[]; panelQuorum: number } }>(
        "/api/rooms/draft",
        { method: "POST", json: {
          artifactSha256: artifact.sha256,
          title,
          description,
          moderator: mod,
          requireVerified,
          panel,
          panelQuorum: panel.length ? Math.min(panelQuorum, panel.length) : 0,
        } },
      );
      const hash = await sendTx("Lock bounty", (wallet) =>
        wallet.writeContract({
          address: draft.contract,
          abi: releaseBondAbi,
          functionName: "createRoom",
          args: [
            {
              ...draft.params,
              huntDuration: BigInt(hunt),
              disclosureDuration: BigInt(disclosure),
              adjudicationWindow: BigInt(adjWindow),
            },
          ],
          value,
          chain: wallet.chain,
        }),
      );
      const receipt = await publicClient.getTransactionReceipt({ hash });
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: releaseBondAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "RoomCreated") {
            router.push(`/rooms/${ev.args.roomId}`);
            router.refresh();
            return;
          }
        } catch {
          /* other logs */
        }
      }
      router.push("/");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (!config.contractAddress) return <div className="flash flash-warn">The ReleaseBond contract is not deployed yet. Visit the admin page first.</div>;

  return (
    <div className="space-y-5">
      {!signedIn && <div className="flash flash-info">Your wallet is not connected to this account. <SignInLink>Reconnect it</SignInLink> to register a release.</div>}

      <section className="card">
        <div className="card-header"><h2 className="font-semibold">1. Exact release artifact</h2></div>
        <div className="space-y-3 p-4">
          <div className="tabnav">
            <a href="#" aria-current={mode === "registry" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setMode("registry"); }}>From registry</a>
            <a href="#" aria-current={mode === "upload" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setMode("upload"); }}>Upload artifact</a>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <label>
              <span className="field-label">Ecosystem</span>
              <select className="input" value={ecosystem} onChange={(e) => setEcosystem(e.target.value as "npm" | "pacman")}>
                <option value="npm">npm</option>
                <option value="pacman">pacman (Arch Linux)</option>
              </select>
            </label>
            {/* Keyed so React never reuses the text inputs as file inputs when switching tabs. */}
            {mode === "registry" ? (
              <Fragment key="registry">
                <label className="sm:col-span-2">
                  <span className="field-label">Package</span>
                  <input className="input" placeholder={ecosystem === "npm" ? "left-pad or @scope/pkg" : "which"} value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  <span className="field-label">Exact version</span>
                  <input className="input" placeholder={ecosystem === "npm" ? "1.3.0" : "2.25-1 (blank = current)"} value={version} onChange={(e) => setVersion(e.target.value)} />
                </label>
              </Fragment>
            ) : (
              <Fragment key="upload">
                <label className="sm:col-span-2">
                  <span className="field-label">Artifact ({ecosystem === "npm" ? ".tgz from npm pack" : ".pkg.tar.zst"})</span>
                  <input className="input" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
                <label>
                  <span className="field-label">Previous release (optional, for diff)</span>
                  <input className="input" type="file" onChange={(e) => setPrevious(e.target.files?.[0] ?? null)} />
                </label>
              </Fragment>
            )}
          </div>
          <button className="btn" disabled={!signedIn || loading} onClick={fetchArtifact}>
            {loading ? "Fetching, hashing and scanning…" : "Fetch & verify artifact"}
          </button>
        </div>
      </section>

      {artifact && <ArtifactCard a={artifact} />}

      {artifact && (
        <section className="card">
          <div className="card-header"><h2 className="font-semibold">2. Fund the security room</h2></div>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="field-label">Title (optional)</span>
              <input className="input" maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New streaming parser and install-time telemetry" />
            </label>
            <label className="sm:col-span-2">
              <span className="field-label">Scope notes for researchers (markdown)</span>
              <textarea className="input min-h-24" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What changed, what is in scope, known issues…" />
            </label>
            <label>
              <span className="field-label">Bounty ({config.chainKey === "mstTestnet" ? "MSTC" : "local MSTC"})</span>
              <input className="input" type="number" min="0" step="0.01" value={bounty} onChange={(e) => setBounty(e.target.value)} />
            </label>
            <label>
              <span className="field-label">Moderator</span>
              <select className="input" value={moderator} onChange={(e) => setModerator(e.target.value)}>
                {moderators.length === 0 && <option value="">no eligible moderator</option>}
                {moderators.map((m) => <option key={m} value={m}>{short(m, 10)}</option>)}
              </select>
            </label>
            <label>
              <span className="field-label">Hunt duration</span>
              <select className="input" value={hunt} onChange={(e) => setHunt(Number(e.target.value))}>
                {HUNT.map((h) => <option key={h.s} value={h.s}>{h.label}</option>)}
              </select>
            </label>
            <label>
              <span className="field-label">Private disclosure / patch window</span>
              <select className="input" value={disclosure} onChange={(e) => setDisclosure(Number(e.target.value))}>
                {DISCLOSURE.map((h) => <option key={h.s} value={h.s}>{h.label}</option>)}
              </select>
            </label>
            <label>
              <span className="field-label">Moderator adjudication window</span>
              <select className="input" value={adjWindow} onChange={(e) => setAdjWindow(Number(e.target.value))}>
                {ADJ.map((h) => <option key={h.s} value={h.s}>{h.label}</option>)}
              </select>
            </label>
            {moderators.filter((m) => m !== (moderator || moderators[0])).length > 0 && (
              <fieldset className="text-sm sm:col-span-2">
                <legend className="field-label">Moderator panel (optional, for high-value rooms)</legend>
                <p className="mb-1 text-xs muted">
                  Panel members must approve the exact settlement with a wallet signature before the contract pays anything.
                </p>
                {walletId === "io.bridgekey.wallet" && (
                  <p className="mb-1 text-xs" style={{ color: "var(--attention)" }}>
                    BridgeKey cannot sign these approvals yet (no EIP-712 support), so leave the panel empty if every moderator uses BridgeKey.
                  </p>
                )}
                {moderators
                  .filter((m) => m !== (moderator || moderators[0]))
                  .map((m) => (
                    <label key={m} className="mr-4 inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={panel.includes(m)}
                        onChange={() => setPanel((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m].slice(0, 5)))}
                      />
                      <span className="mono">{short(m, 8)}</span>
                    </label>
                  ))}
                {panel.length > 0 && (
                  <label className="mt-1 flex items-center gap-2">
                    Approvals required
                    <select className="input w-20" value={Math.min(panelQuorum, panel.length)} onChange={(e) => setPanelQuorum(Number(e.target.value))}>
                      {panel.map((_, i) => (
                        <option key={i + 1} value={i + 1}>{i + 1}</option>
                      ))}
                    </select>
                    of {panel.length}
                  </label>
                )}
              </fieldset>
            )}
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-1" checked={requireVerified} onChange={(e) => setRequireVerified(e.target.checked)} />
              <span>
                <b>Verified researchers only.</b> Only wallets a moderator has verified as human researchers may submit reports. This is
                enforced by ReleaseBond when reports are submitted; the contract itself accepts any commitment, but unverified commitments
                have no report to review or pay.
              </span>
            </label>
            <div className="text-xs muted sm:col-span-2">
              The bounty is escrowed by the ReleaseBond contract. Researchers can verify it before they start. After the hunt and
              disclosure window, the moderator adjudicates and the contract pays valid findings; any remainder returns to you. If
              nobody commits a finding you can reclaim the pool; if the moderator misses the deadline anyone can return it to you.
            </div>
            <div className="sm:col-span-2">
              <button className="btn btn-primary" disabled={!signedIn || !moderators.length} onClick={openRoom}>
                Lock {bounty} MSTC and open the room
              </button>
            </div>
          </div>
        </section>
      )}
      {error && <div className="flash flash-error">{error}</div>}
    </div>
  );
}
