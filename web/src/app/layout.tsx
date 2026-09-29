import type { Metadata } from "next";
import Link from "next/link";
import { BusyToast, WalletButton } from "@/components/WalletButton";
import { WalletProvider, type ClientConfig } from "@/components/WalletProvider";
import { appConfig } from "@/lib/server/config";
import { canAdminister } from "@/lib/server/guard";
import { currentViewer, listModerators } from "@/lib/server/queries";
import { syncChain } from "@/lib/server/sync";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReleaseBond — funded adversarial security review for every release",
  description: "Put an MST bounty on an exact software release. Verified researchers try to break it; adversarial peer review and a moderator decide; the contract pays.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await syncChain().catch(() => null);
  const cfg = appConfig();
  const config: ClientConfig = {
    chainKey: cfg.chainKey,
    chainId: cfg.chainId,
    chainName: cfg.chainName,
    explorerUrl: cfg.explorerUrl,
    contractAddress: cfg.contractAddress,
    devWallet: cfg.devWallet,
    agentMode: cfg.agentMode,
    sandboxEnabled: cfg.sandboxEnabled,
    moderators: listModerators(),
  };
  const viewer = await currentViewer();
  const session = { address: viewer.address, isModerator: viewer.isModerator, user: viewer.user };
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <WalletProvider config={config} initialSession={session}>
          <header style={{ background: "var(--header)", color: "var(--header-fg)" }}>
            {/* Phones: logo and wallet on the first row, nav on a second, scrollable row. */}
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
              <Link href="/" className="flex shrink-0 items-center gap-2 text-base font-semibold" style={{ color: "var(--header-fg)" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" stroke="currentColor" strokeWidth="2" />
                  <path d="m8.5 12 2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                ReleaseBond
              </Link>
              <nav className="order-3 -mx-1 flex w-full items-center gap-4 overflow-x-auto px-1 text-sm whitespace-nowrap md:order-none md:mx-0 md:w-auto md:flex-1 md:px-0">
                <Link href="/" style={{ color: "var(--header-fg)" }}>Security rooms</Link>
                <Link href="/rooms/new" style={{ color: "var(--header-fg)" }}>Fund a release</Link>
                <Link href="/dashboard" style={{ color: "var(--header-fg)" }}>Dashboard</Link>
                {canAdminister(viewer) && <Link href="/admin" style={{ color: "var(--header-fg)" }}>Admin</Link>}
              </nav>
              <div className="ml-auto flex items-center gap-3 md:ml-0">
                <span className="hidden text-xs opacity-70 sm:inline">{cfg.chainName}</span>
                <WalletButton />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-6xl border-t px-4 py-6 text-xs muted" style={{ borderColor: "var(--border)" }}>
            ReleaseBond reviews exact artifacts. A completed review is evidence, not a guarantee that a release is safe. Votes never decide validity, severity or payout.
            {cfg.contractAddress ? (
              <span className="ml-2 mono">
                contract{" "}
                {cfg.explorerUrl ? (
                  <a href={`${cfg.explorerUrl}/address/${cfg.contractAddress}`} target="_blank" rel="noreferrer">
                    {cfg.contractAddress}
                  </a>
                ) : (
                  cfg.contractAddress
                )}
              </span>
            ) : null}
          </footer>
          <BusyToast />
        </WalletProvider>
      </body>
    </html>
  );
}
