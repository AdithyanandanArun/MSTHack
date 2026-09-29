"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { short } from "@/lib/format";
import { useSignedIn, useWallet } from "./WalletProvider";

/** Link to the sign-in page that returns to the current page afterwards. */
export function SignInLink({ children = "Sign in", className, style }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const pathname = usePathname();
  return (
    <Link href={`/signin?next=${encodeURIComponent(pathname || "/")}`} className={className} style={style}>
      {children}
    </Link>
  );
}

/** Header account control: "Sign in" when signed out, otherwise the account menu. */
export function WalletButton() {
  const { account, disconnect, session, walletChainId, config } = useWallet();
  const signedIn = useSignedIn();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (pathname?.startsWith("/signin")) return null;
  if (!session.address || !session.user) {
    return <SignInLink className="btn btn-primary">Sign in</SignInLink>;
  }

  // Leave signed-in pages (dashboard, profile) and re-render server components without the session.
  const signOut = async () => {
    setOpen(false);
    await disconnect();
    router.push("/");
    router.refresh();
  };
  const name = session.user.handle ?? `Researcher #${session.user.researcher_no}`;
  const walletSwitched = !!account && !signedIn;
  const walletMissing = !account;
  const wrongChain = signedIn && walletChainId !== null && walletChainId !== config.chainId;
  const role = session.isModerator ? "moderator" : null;
  const item = "block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--bg-subtle)]";
  const next = encodeURIComponent(pathname || "/");

  return (
    <div className="relative" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)} style={{ background: "transparent", color: "var(--header-fg)" }} aria-expanded={open}>
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: walletSwitched || walletMissing || wrongChain ? "var(--attention)" : "var(--success)" }}
        />
        {name}
        {role ? <span className="label" style={{ color: "var(--header-fg)" }}>{role}</span> : null}
      </button>
      {open && (
        <div className="card absolute right-0 z-50 mt-2 w-80 p-2 shadow-lg" style={{ color: "var(--fg)" }}>
          <div className="px-2 py-1.5">
            <div className="text-xs muted">Signed in as</div>
            <div className="font-semibold">{name}</div>
            <div className="mono muted">{short(session.address, 10)}</div>
          </div>
          {walletSwitched && (
            <div className="flash flash-warn my-1 text-xs">
              Your wallet is now on <span className="mono">{short(account!, 6)}</span>, a different account.{" "}
              <Link href={`/signin?next=${next}`} onClick={() => setOpen(false)}>Sign in as that account</Link> or switch back in your wallet.
            </div>
          )}
          {walletMissing && (
            <div className="flash flash-warn my-1 text-xs">
              Your wallet is not connected, so you cannot sign transactions.{" "}
              <Link href={`/signin?next=${next}`} onClick={() => setOpen(false)}>Reconnect</Link>
            </div>
          )}
          {wrongChain && (
            <div className="flash flash-warn my-1 text-xs">Your wallet is on another network; it will be switched to {config.chainName} when you sign a transaction.</div>
          )}
          <div className="my-1 border-t" style={{ borderColor: "var(--border-muted)" }} />
          <Link href="/dashboard" className={item} style={{ color: "var(--fg)" }} onClick={() => setOpen(false)}>Your dashboard</Link>
          <Link href={`/researchers/${session.address}`} className={item} style={{ color: "var(--fg)" }} onClick={() => setOpen(false)}>Your public profile</Link>
          {(session.isModerator || !config.contractAddress) && (
            <Link href="/admin" className={item} style={{ color: "var(--fg)" }} onClick={() => setOpen(false)}>Admin</Link>
          )}
          <div className="my-1 border-t" style={{ borderColor: "var(--border-muted)" }} />
          <Link href={`/signin?switch=1&next=${next}`} className={item} style={{ color: "var(--fg)" }} onClick={() => setOpen(false)}>Switch account</Link>
          <button className={item} onClick={signOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

export function BusyToast() {
  const { busy, walletId } = useWallet();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const t = setTimeout(() => setSlow(true), 8_000);
    return () => clearTimeout(t);
  }, [busy]);
  if (!busy) return null;
  // Only wallet prompts can stall; chain waits ("waiting for block", "indexing") just take time.
  const waitingOnWallet = /wallet|Signing in/i.test(busy);
  return (
    <div className="card fixed right-4 bottom-4 z-50 max-w-sm px-4 py-3 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        {busy}
      </div>
      {slow && waitingOnWallet && (
        <p className="mt-2 text-xs muted">
          {walletId === "io.bridgekey.wallet" ? "Click the BridgeKey icon in the toolbar and approve the request. " : "Open your wallet and approve the request. "}
          If older requests are queued there, reject them, then reload this page and try once more.
        </p>
      )}
    </div>
  );
}
