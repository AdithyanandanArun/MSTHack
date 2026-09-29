import Link from "next/link";
import { DeployContract, ModeratorAdmin, VerifyResearcher } from "@/components/AdminPanel";
import { ExplorerLink } from "@/components/Identity";
import { appConfig } from "@/lib/server/config";
import { contractOwner } from "@/lib/server/onchain";
import { canAdminister, requireSignedIn } from "@/lib/server/guard";
import { listModerators } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const cfg = appConfig();
  const viewer = await requireSignedIn("/admin");
  if (!canAdminister(viewer)) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Admin is for ReleaseBond moderators</h1>
        <p className="mt-2 text-sm muted">
          You are signed in as <b>{viewer.user.handle ?? `Researcher #${viewer.user.researcher_no}`}</b>, which is not a moderator. The contract owner can add
          moderators here. To use another account, switch accounts in your wallet and sign in again.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/dashboard" className="btn btn-primary">Your dashboard</Link>
          <Link href="/signin?switch=1&next=%2Fadmin" className="btn">Switch account</Link>
        </div>
      </div>
    );
  }
  const owner = await contractOwner();
  const isOwner = viewer.address === owner;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Admin & setup</h1>

      <section className="card">
        <div className="card-header"><h2 className="font-semibold">Network</h2></div>
        <div className="grid gap-2 p-4 text-sm sm:grid-cols-2">
          <div>Chain: <b>{cfg.chainName}</b> (id {cfg.chainId})</div>
          <div>RPC: <span className="mono break-all">{cfg.rpcUrl}</span></div>
          <div>
            Contract:{" "}
            {cfg.contractAddress ? <ExplorerLink explorer={cfg.explorerUrl} kind="address" value={cfg.contractAddress}>{cfg.contractAddress}</ExplorerLink> : <b style={{ color: "var(--attention)" }}>not deployed</b>}
          </div>
          <div>Owner: <span className="mono break-all">{owner ?? "—"}</span></div>
          <div>Evidence agent: <b>{cfg.agentMode === "claude" ? "Claude (ANTHROPIC_API_KEY set)" : "heuristic analyst"}</b></div>
          <div>Dynamic sandbox: <b>{cfg.sandboxEnabled ? "Docker (no network, strace)" : "disabled"}</b></div>
        </div>
      </section>

      <section className="card">
        <div className="card-header"><h2 className="font-semibold">Wallet setup (MST Testnet)</h2></div>
        <ol className="list-decimal space-y-1 p-4 pl-8 text-sm">
          <li>Install the <a href="https://chromewebstore.google.com/detail/bridgekey/bfjojdcfenehemjgjlepdjomkpginlkg" target="_blank" rel="noreferrer">Bridgekey extension</a> and create a wallet.</li>
          <li>Select <b>MST Testnet</b> in Bridgekey and copy your address.</li>
          <li>Claim free test MSTC at <a href="https://faucet.masterstroke.academy" target="_blank" rel="noreferrer">faucet.masterstroke.academy</a> (10 MSTC per claim).</li>
          <li>Sign in with that account (top right). Signing in costs no gas; each wallet account is a separate ReleaseBond account.</li>
          <li>Roles must be different wallets: the contract refuses a developer moderating their own room or committing findings to it. Create extra Bridgekey accounts for a full demo.</li>
        </ol>
      </section>

      <section className="card">
        <div className="card-header"><h2 className="font-semibold">Contract deployment</h2></div>
        <div className="p-4">
          {cfg.contractAddress && !isOwner ? (
            <p className="text-sm muted">ReleaseBond is deployed. Only its owner can redeploy.</p>
          ) : (
            <DeployContract hasContract={!!cfg.contractAddress} isOwner={isOwner} />
          )}
        </div>
      </section>

      {cfg.contractAddress && isOwner && (
        <section className="card">
          <div className="card-header"><h2 className="font-semibold">Moderator registry (on-chain)</h2></div>
          <div className="p-4"><ModeratorAdmin moderators={listModerators()} /></div>
        </section>
      )}

      {viewer.isModerator && (
        <section className="card">
          <div className="card-header"><h2 className="font-semibold">Researcher verification</h2></div>
          <div className="p-4"><VerifyResearcher /></div>
        </section>
      )}
    </div>
  );
}
