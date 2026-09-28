import { defineChain, type Chain } from "viem";

/** MST Testnet (Masterstroke). EVM compatible, Cancun, 1 gwei gas, zero base fee. */
export const mstTestnet = defineChain({
  id: 91562037,
  name: "MST Testnet",
  nativeCurrency: { name: "MST Coin", symbol: "MSTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://testnetrpc.mstblockchain.com"],
      webSocket: ["wss://testnetrpc.mstblockchain.com"],
    },
  },
  blockExplorers: {
    default: { name: "MSTScan", url: "https://testnet.mstscan.com" },
  },
  testnet: true,
});

/** Local Hardhat node used for development and the end-to-end check. */
export const localHardhat = defineChain({
  id: 31337,
  name: "Hardhat Local",
  nativeCurrency: { name: "Local MSTC", symbol: "MSTC", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

export type ChainKey = "mstTestnet" | "localhost";

export const CHAINS: Record<ChainKey, Chain> = {
  mstTestnet,
  localhost: localHardhat,
};

export function chainByKey(key: string | undefined): Chain {
  return key === "localhost" ? localHardhat : mstTestnet;
}

export function explorerTxUrl(chain: Chain, hash: string): string | null {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : null;
}

export function explorerAddressUrl(chain: Chain, address: string): string | null {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/address/${address}` : null;
}
