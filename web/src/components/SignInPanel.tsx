"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { short } from "@/lib/format";
import { useSignedIn, useWallet } from "./WalletProvider";

const BRIDGEKEY_URL = "https://chromewebstore.google.com/detail/bridgekey/bfjojdcfenehemjgjlepdjomkpginlkg";

/**
 * The sign-in page. A ReleaseBond account is a wallet address: connect the wallet, sign a one-time
 * message (no gas), and pick a display name the first time. `switchAccount` signs the current account
 * out first so another wallet account can sign in.
 */
export function SignInPanel({ next, switchAccount }: { next: string; switchAccount: boolean }) {
  const router = useRouter();
  const { options, account, connect, disconnect, signIn, session, busy, walletId, refreshSession } = useWallet();
  const signedIn = useSignedIn();
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [slow, setSlow] = useState(false);
  const switched = useRef(false);

  // "Switch account": end the current session once, then start over at step 1.
  useEffect(() => {
    if (!switchAccount || switched.current) return;
    switched.current = true;
    if (session.address) void disconnect().then(() => router.replace(`/signin?next=${encodeURIComponent(next)}`));
  }, [switchAccount, session.address, disconnect, router, next]);

  // Explain what to do when the wallet has not answered after a few seconds.
  useEffect(() => {
    setSlow(false);
    if (!busy && !connecting) return;
    const t = setTimeout(() => setSlow(true), 8_000);
    return () => clearTimeout(t);
  }, [busy, connecting]);

  const choose = async (id: string) => {
    setError(null);
    setConnecting(id);
    try {
      await connect(id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setConnecting(null);
    }
  };

  const doSignIn = async () => {
    setError(null);
    try {
      await signIn();
      const me = await api<{ user: { handle: string | null } | null }>("/api/auth/me");
      if (me.user && !me.user.handle) setNaming(true);
      else router.push(next);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const injected = options.filter((o) => o.kind === "injected");
  const dev = options.filter((o) => o.kind === "dev");
  const name = session.user?.handle ?? (session.user ? `Researcher #${session.user.researcher_no}` : null);
  const step = naming ? 3 : signedIn ? 4 : account ? 2 : 1;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Sign in to ReleaseBond</h1>
        <p className="mt-1 text-sm muted">Your wallet is your account. Signing in costs no gas.</p>
      </div>

      {step < 4 && (
        <ol className="flex justify-center gap-2 text-xs">
          {["Choose wallet", "Sign message", "Your name"].map((label, i) => (
            <li key={label} className="flex items-center gap-1.5">
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold"
                style={i + 1 < step ? { background: "var(--success-emphasis)", color: "#fff" } : i + 1 === step ? { background: "var(--accent-emphasis)", color: "#fff" } : { border: "1px solid var(--border)" }}
              >
                {i + 1 < step ? "✓" : i + 1}
              </span>
              <span className={i + 1 === step ? "font-semibold" : "muted"}>{label}</span>
              {i < 2 && <span className="muted">›</span>}
            </li>
          ))}
        </ol>
      )}

      <div className="card p-5">
        {step === 1 && (
          <div className="space-y-3">
            <h2 className="font-semibold">Choose your wallet</h2>
            {injected.length === 0 && (
              <div className="flash flash-info text-sm">
                No browser wallet found. Install{" "}
                <a href={BRIDGEKEY_URL} target="_blank" rel="noreferrer">BridgeKey</a>, create a wallet, select <b>MST Testnet</b>, then reload this page.
              </div>
            )}
            {injected.map((o) => (
              <WalletChoice key={o.id} icon={o.icon} label={o.name} hint="Browser wallet" busy={connecting === o.id} onClick={() => choose(o.id)} />
            ))}
            {dev.length > 0 && (
              <>
                <h3 className="pt-2 text-xs font-semibold muted">Local test accounts (only on the local chain)</h3>
                {dev.map((o) => (
                  <WalletChoice key={o.id} label={o.name} busy={connecting === o.id} onClick={() => choose(o.id)} />
                ))}
              </>
            )}
            {connecting && slow && <WalletHint bridgekey={connecting === "io.bridgekey.wallet"} what="the connection request" />}
          </div>
        )}

        {step === 2 && account && (
          <div className="space-y-3">
            <h2 className="font-semibold">Sign the sign-in message</h2>
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              <span>
                <span className="muted">Wallet account </span>
                <span className="mono">{short(account, 8)}</span>
              </span>
              <button className="btn btn-sm" onClick={() => void disconnect()}>Use another</button>
            </div>
            <p className="text-sm muted">
              Your wallet shows a message to sign. It proves you own this address and does not send a transaction.
            </p>
            <button className="btn btn-primary w-full" disabled={!!busy} onClick={doSignIn}>
              {busy ?? `Sign in as ${short(account, 4)}`}
            </button>
            {busy && slow && <WalletHint bridgekey={walletId === "io.bridgekey.wallet"} what="Sign message" />}
          </div>
        )}

        {step === 3 && <NameForm onDone={async () => { await refreshSession(); router.push(next); router.refresh(); }} />}

        {step === 4 && (
          <div className="space-y-3 text-center">
            <p className="text-sm muted">You are signed in as</p>
            <p className="text-lg font-semibold">{name}</p>
            <p className="mono muted">{session.address}</p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <button className="btn btn-primary" onClick={() => router.push(next)}>Continue</button>
              <button className="btn" onClick={() => void disconnect()}>Use a different account</button>
            </div>
          </div>
        )}

        {error && <div className="flash flash-error mt-3 text-sm">{error}</div>}
      </div>

      <p className="text-center text-xs muted">
        Each wallet account is a separate ReleaseBond account with its own dashboard, findings and payouts. To act as someone else (for
        example the developer, then a researcher), switch account in your wallet and sign in again.
      </p>
    </div>
  );
}

function WalletChoice({ icon, label, hint, busy, onClick }: { icon?: string; label: string; hint?: string; busy: boolean; onClick: () => void }) {
  return (
    <button className="flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left hover:bg-[var(--bg-subtle)] disabled:opacity-60" style={{ borderColor: "var(--border)" }} disabled={busy} onClick={onClick}>
      {/* eslint-disable-next-line @next/next/no-img-element -- EIP-6963 icons are data URIs */}
      {icon ? <img src={icon} alt="" className="h-7 w-7 rounded" /> : <span className="h-7 w-7 shrink-0 rounded" style={{ background: "var(--bg-inset)" }} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{label}</span>
        {hint && <span className="block text-xs muted">{hint}</span>}
      </span>
      <span className="text-xs muted">{busy ? "Waiting…" : "Connect ›"}</span>
    </button>
  );
}

function WalletHint({ bridgekey, what }: { bridgekey: boolean; what: string }) {
  return (
    <div className="flash flash-warn text-xs">
      {bridgekey ? (
        <>
          Waiting for BridgeKey. Click the <b>BridgeKey icon</b> in the Chrome toolbar and approve <b>{what}</b>. If it shows an older request first,
          reject it; if nothing is waiting there, reload this page and try once more.
        </>
      ) : (
        <>Waiting for your wallet. Open it and approve {what}.</>
      )}
    </div>
  );
}

function NameForm({ onDone }: { onDone: () => Promise<void> }) {
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await api("/api/profile", { method: "PATCH", json: { handle: handle.trim() } });
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 className="font-semibold">Choose a display name</h2>
      <p className="text-sm muted">Shown on your findings, reviews and profile instead of a number. You can change it later on your dashboard.</p>
      <input className="input" autoFocus placeholder="e.g. alice" value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={32} />
      {error && <div className="flash flash-error text-sm">{error}</div>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={saving || handle.trim().length < 2}>Save and continue</button>
        <button type="button" className="btn" disabled={saving} onClick={() => void onDone()}>Skip</button>
      </div>
    </form>
  );
}
