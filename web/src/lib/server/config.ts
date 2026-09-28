import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http, isAddress, type Address, type PublicClient } from "viem";
import { chainByKey, type ChainKey } from "@/lib/chain/chains";
import { getSetting } from "./db";

export interface AppConfig {
  chainKey: ChainKey;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string | null;
  contractAddress: Address | null;
  deployBlock: number;
  devWallet: boolean;
  agentMode: "claude" | "heuristic";
  sandboxEnabled: boolean;
}

export function chainKey(): ChainKey {
  return process.env.RELEASEBOND_CHAIN === "localhost" ? "localhost" : "mstTestnet";
}

export function rpcUrl(): string {
  const chain = chainByKey(chainKey());
  return process.env.RELEASEBOND_RPC_URL || chain.rpcUrls.default.http[0];
}

/** Deployment file written by contracts/scripts/deploy.js, if present. */
function deploymentFile(): { address?: string; deployBlock?: number; chainId?: number } | null {
  const candidates = [
    path.join(process.cwd(), "..", "contracts", "deployments", `${chainKey()}.json`),
    path.join(process.cwd(), "deployments", `${chainKey()}.json`),
  ];
  for (const file of candidates) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      /* not present */
    }
  }
  return null;
}

/**
 * Contract address resolution order:
 *   1. RELEASEBOND_CONTRACT_ADDRESS env
 *   2. address registered through the in-app /admin deploy flow (settings table)
 *   3. contracts/deployments/<chain>.json
 */
export function contractInfo(): { address: Address | null; deployBlock: number } {
  const chain = chainByKey(chainKey());
  const envAddr = process.env.RELEASEBOND_CONTRACT_ADDRESS;
  if (envAddr && isAddress(envAddr)) {
    return { address: envAddr, deployBlock: Number(process.env.RELEASEBOND_DEPLOY_BLOCK || 0) };
  }
  const stored = getSetting(`contract:${chain.id}`);
  if (stored) {
    const parsed = JSON.parse(stored) as { address: Address; deployBlock: number };
    return parsed;
  }
  const file = deploymentFile();
  if (file?.address && isAddress(file.address) && (!file.chainId || file.chainId === chain.id)) {
    return { address: file.address, deployBlock: file.deployBlock ?? 0 };
  }
  return { address: null, deployBlock: 0 };
}

export function appConfig(): AppConfig {
  const key = chainKey();
  const chain = chainByKey(key);
  const { address, deployBlock } = contractInfo();
  return {
    chainKey: key,
    chainId: chain.id,
    chainName: chain.name,
    rpcUrl: rpcUrl(),
    explorerUrl: chain.blockExplorers?.default.url ?? null,
    contractAddress: address,
    deployBlock,
    devWallet: key === "localhost" && process.env.RELEASEBOND_DEV_WALLET !== "0",
    agentMode: process.env.ANTHROPIC_API_KEY ? "claude" : "heuristic",
    sandboxEnabled: process.env.RELEASEBOND_SANDBOX === "docker",
  };
}

type G = typeof globalThis & { __rbPublicClient?: { key: string; client: PublicClient } };

export function publicClient(): PublicClient {
  const g = globalThis as G;
  const key = `${chainKey()}|${rpcUrl()}`;
  if (!g.__rbPublicClient || g.__rbPublicClient.key !== key) {
    g.__rbPublicClient = {
      key,
      client: createPublicClient({ chain: chainByKey(chainKey()), transport: http(rpcUrl(), { timeout: 20_000 }) }),
    };
  }
  return g.__rbPublicClient.client;
}

let cachedNow: { at: number; ts: number } | null = null;

/**
 * Current chain time. Phases are defined by block timestamps, so the server
 * uses the latest block rather than its own wall clock (they diverge on a
 * local chain after time travel).
 */
export async function chainNow(): Promise<number> {
  const wall = Date.now();
  if (cachedNow && wall - cachedNow.at < 3_000) return cachedNow.ts + Math.floor((wall - cachedNow.at) / 1000);
  try {
    const block = await publicClient().getBlock({ blockTag: "latest" });
    // Blocks are produced only when there are transactions on some chains, so
    // never report a time earlier than the wall clock suggests either.
    const ts = Math.max(Number(block.timestamp), chainKey() === "localhost" ? 0 : Math.floor(wall / 1000));
    cachedNow = { at: wall, ts };
    return ts;
  } catch {
    return Math.floor(wall / 1000);
  }
}

export function resetChainNowCache() {
  cachedNow = null;
}
