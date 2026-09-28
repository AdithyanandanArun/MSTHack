"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/client/api";
import { short } from "@/lib/format";
import { useSignedIn, useWallet } from "./WalletProvider";

export function WalletButton() {
  const { options, account, connect, disconnect, signIn, session, walletChainId, config, busy } = useWallet();
  const signedIn = useSignedIn();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const wrongChain = account && walletChainId !== null && walletChainId !== config.chainId;

  return (
    <div className="relative" ref={ref}>
      {!account ? (
        <button className="btn btn-primary" onClick={() => setOpen((o) => !o)}>
          Connect wallet
        </button>
      ) : !signedIn ? (
        <button className="btn btn-primary" disabled={!!busy} onClick={() => run(signIn)}>
          {busy ?? `Sign in as ${short(account, 4)}`}
        </button>
      ) : (
        <button className="btn" onClick={() => setOpen((o) => !o)} style={{ background: "transparent", color: "var(--header-fg)" }}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: wrongChain ? "var(--attention)" : "var(--success)" }} />
          {session.user?.handle ?? (session.user ? `Researcher #${session.user.researcher_no}` : short(account, 4))}
          {session.isModerator ? <span className="label" style={{ color: "var(--header-fg)" }}>mod</span> : null}
        </button>
      )}
      {open && (
        <div className="card absolute right-0 z-50 mt-2 w-80 p-2 shadow-lg" style={{ color: "var(--fg)" }}>
          {!account ? (
            <>
              <p className="px-2 py-1 text-xs font-semibold muted">Choose a wallet</p>
              {options.length === 0 && (
                <div className="px-2 py-2 text-sm">
                  No browser wallet detected. Install{" "}
                  <a href="https://chromewebstore.google.com/detail/bridgekey/bfjojdcfenehemjgjlepdjomkpginlkg" target="_blank" rel="noreferrer">
                    Bridgekey
                  </a>
                  , create a wallet, select <b>MST Testnet</b> and claim test MSTC from the{" "}
                  <a href="https://faucet.masterstroke.academy" target="_blank" rel="noreferrer">
                    faucet
                  </a>
                  .
                </div>
              )}
              {options.map((o) => (
                <button key={o.id} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--bg-subtle)]" onClick={() => run(() => connect(o.id))}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- EIP-6963 icons are data URIs */}
                  {o.icon ? <img src={o.icon} alt="" className="h-5 w-5" /> : <span className="h-5 w-5 rounded bg-[var(--bg-inset)]" />}
                  <span className="truncate">{o.name}</span>
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="px-2 py-1 text-xs muted">
                Connected <span className="mono">{short(account, 8)}</span>
                {wrongChain ? <div style={{ color: "var(--attention)" }}>Wallet is on another network; it will be switched to {config.chainName} when you sign a transaction.</div> : null}
              </div>
              <Link href="/dashboard" className="block rounded px-2 py-1.5 hover:bg-[var(--bg-subtle)]" style={{ color: "var(--fg)" }} onClick={() => setOpen(false)}>
                Your dashboard
              </Link>
              <Link href={`/researchers/${account.toLowerCase()}`} className="block rounded px-2 py-1.5 hover:bg-[var(--bg-subtle)]" style={{ color: "var(--fg)" }} onClick={() => setOpen(false)}>
                Your profile
              </Link>
              <button className="block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--bg-subtle)]" onClick={() => run(disconnect)}>
                Sign out
              </button>
            </>
          )}
          {error && <div className="flash flash-error mt-2">{error}</div>}
        </div>
      )}
      {error && !open && (
        <div className="flash flash-error absolute right-0 z-50 mt-2 w-80" style={{ color: "var(--fg)" }} onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}

export function BusyToast() {
  const { busy } = useWallet();
  if (!busy) return null;
  return (
    <div className="card fixed right-4 bottom-4 z-50 flex items-center gap-2 px-4 py-3 shadow-lg">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      {busy}
    </div>
  );
}
