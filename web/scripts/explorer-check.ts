// Builds explorer links with the app's own helpers and checks them against
// MST Testnet's Blockscout: page titles and the explorer API.
import { explorerAddressUrl, explorerTxUrl, mstTestnet } from "../src/lib/chain/chains";

const RPC = mstTestnet.rpcUrls.default.http[0];
const EXPLORER = mstTestnet.blockExplorers!.default.url;
// WMST, deployed by Masterstroke's DEX on MST Testnet (see their dex-smart-contracts README).
const KNOWN_CONTRACT = "0x9DDd1F5Ac413aBb02d642471fb0D415A75fa17Be";

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
}
const title = async (url: string) => (await (await fetch(url)).text()).match(/<title[^>]*>([^<]*)<\/title>/)?.[1] ?? "";

(async () => {
  const head = parseInt(await rpc("eth_blockNumber", []), 16);
  let tx: string | null = null;
  for (let b = head; b > head - 5000 && !tx; b--) {
    const blk = await rpc("eth_getBlockByNumber", [`0x${b.toString(16)}`, false]);
    if (blk?.transactions?.length) tx = blk.transactions[0];
  }
  if (!tx) throw new Error("no recent transaction found on MST Testnet");
  const txUrl = explorerTxUrl(mstTestnet, tx)!;
  const addrUrl = explorerAddressUrl(mstTestnet, KNOWN_CONTRACT)!;
  const bogus = `0x${"1".repeat(64)}`;
  const out = {
    tx,
    txUrl,
    txTitle: await title(txUrl),
    addrUrl,
    addrTitle: await title(addrUrl),
    apiRealStatus: (await fetch(`${EXPLORER}/api/v2/transactions/${tx}`)).status,
    apiBogusStatus: (await fetch(`${EXPLORER}/api/v2/transactions/${bogus}`)).status,
  };
  console.log(JSON.stringify(out));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
