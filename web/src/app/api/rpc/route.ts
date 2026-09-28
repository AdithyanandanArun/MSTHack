import { NextResponse } from "next/server";
import { chainKey, rpcUrl } from "@/lib/server/config";

// Read-only JSON-RPC proxy so the browser always reads the same chain the
// server indexes. Wallet transactions go through the wallet, not this proxy.
const READ_METHODS = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getCode",
  "eth_getBlockByNumber",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_getLogs",
]);

type RpcCall = { jsonrpc: string; id: unknown; method: string; params?: unknown[] };

export async function POST(req: Request) {
  let body: RpcCall | RpcCall[];
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length > 20) return NextResponse.json({ error: "batch too large" }, { status: 400 });
  // The dev wallet signs locally and needs to broadcast; only on the local chain.
  const allowSend = chainKey() === "localhost";
  for (const c of calls) {
    if (!READ_METHODS.has(c.method) && !(allowSend && c.method === "eth_sendRawTransaction")) {
      return NextResponse.json({ jsonrpc: "2.0", id: c.id ?? null, error: { code: -32601, message: `method ${c.method} not allowed` } });
    }
  }
  const upstream = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return new NextResponse(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
}
