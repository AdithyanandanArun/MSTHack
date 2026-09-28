"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  numberToHex,
  type Address,
  type EIP1193Provider,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { chainByKey, type ChainKey } from "@/lib/chain/chains";
import { api, errorMessage } from "@/lib/client/api";

export interface ClientConfig {
  chainKey: ChainKey;
  chainId: number;
  chainName: string;
  explorerUrl: string | null;
  contractAddress: Address | null;
  devWallet: boolean;
  agentMode: "claude" | "heuristic";
  sandboxEnabled: boolean;
  moderators: string[];
}

interface WalletOption {
  id: string;
  name: string;
  icon?: string;
  kind: "injected" | "dev";
  provider?: EIP1193Provider;
  privateKey?: `0x${string}`;
}

interface Session {
  address: string | null;
  isModerator: boolean;
  user: { researcher_no: number; handle: string | null; verified: number } | null;
}

interface WalletState {
  config: ClientConfig;
  options: WalletOption[];
  account: Address | null;
  walletChainId: number | null;
  session: Session;
  busy: string | null;
  connect: (optionId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  signIn: () => Promise<void>;
  /** Sends a transaction via the wallet, waits for it, and has the server index it. */
  sendTx: (label: string, send: (wallet: WalletClient, account: Address) => Promise<Hash>) => Promise<Hash>;
  publicClient: PublicClient;
  refreshSession: () => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);

// Well-known Hardhat development keys. Only ever offered on the local chain.
const DEV_KEYS: `0x${string}`[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
];
const DEV_ROLES = ["owner / moderator", "developer", "researcher A", "researcher B", "researcher C", "spare"];

const LAST_WALLET = "rb:last-wallet";

export function WalletProvider({ config, children }: { config: ClientConfig; children: React.ReactNode }) {
  const chain = useMemo(() => chainByKey(config.chainKey), [config.chainKey]);
  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http("/api/rpc") }) as PublicClient,
    [chain],
  );
  const [injected, setInjected] = useState<WalletOption[]>([]);
  const [active, setActive] = useState<WalletOption | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [session, setSession] = useState<Session>({ address: null, isModerator: false, user: null });
  const [busy, setBusy] = useState<string | null>(null);
  const activeRef = useRef<WalletOption | null>(null);

  const devOptions = useMemo<WalletOption[]>(
    () =>
      config.devWallet
        ? DEV_KEYS.map((k, i) => ({
            id: `dev-${i}`,
            name: `Dev #${i} (${DEV_ROLES[i]}) ${privateKeyToAccount(k).address.slice(0, 8)}…`,
            kind: "dev",
            privateKey: k,
          }))
        : [],
    [config.devWallet],
  );

  // EIP-6963 multi-wallet discovery (Bridgekey, MetaMask, ...), falling back to window.ethereum.
  useEffect(() => {
    const found = new Map<string, WalletOption>();
    const onAnnounce = (event: Event) => {
      const { info, provider } = (event as CustomEvent).detail as {
        info: { uuid: string; name: string; icon: string; rdns: string };
        provider: EIP1193Provider;
      };
      found.set(info.rdns || info.uuid, { id: info.rdns || info.uuid, name: info.name, icon: info.icon, kind: "injected", provider });
      setInjected([...found.values()]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(() => {
      const w = window as unknown as { ethereum?: EIP1193Provider & { isMetaMask?: boolean } };
      if (w.ethereum && ![...found.values()].some((o) => o.provider === w.ethereum)) {
        found.set("window.ethereum", { id: "window.ethereum", name: "Browser wallet (Bridgekey / injected)", kind: "injected", provider: w.ethereum });
        setInjected([...found.values()]);
      }
    }, 400);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t);
    };
  }, []);

  const options = useMemo(() => [...injected, ...devOptions], [injected, devOptions]);

  const refreshSession = useCallback(async () => {
    try {
      setSession(await api<Session>("/api/auth/me"));
    } catch {
      setSession({ address: null, isModerator: false, user: null });
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const attach = useCallback(
    async (opt: WalletOption, requestAccounts: boolean) => {
      if (opt.kind === "dev") {
        const acct = privateKeyToAccount(opt.privateKey!);
        setActive(opt);
        activeRef.current = opt;
        setAccount(acct.address);
        setWalletChainId(config.chainId);
        localStorage.setItem(LAST_WALLET, opt.id);
        return;
      }
      const p = opt.provider!;
      const accounts = (await p.request({ method: requestAccounts ? "eth_requestAccounts" : "eth_accounts" })) as string[];
      if (!accounts.length) return;
      const cid = Number(await p.request({ method: "eth_chainId" }));
      setActive(opt);
      activeRef.current = opt;
      setAccount(getAddress(accounts[0]));
      setWalletChainId(cid);
      localStorage.setItem(LAST_WALLET, opt.id);
      p.on?.("accountsChanged", (a: string[]) => setAccount(a.length ? getAddress(a[0]) : null));
      p.on?.("chainChanged", (c: string) => setWalletChainId(Number(c)));
    },
    [config.chainId],
  );

  // Silently reconnect the last wallet (no popup).
  useEffect(() => {
    const last = localStorage.getItem(LAST_WALLET);
    const opt = last ? options.find((o) => o.id === last) : undefined;
    if (opt && !activeRef.current) void attach(opt, false).catch(() => undefined);
  }, [options, attach]);

  const connect = useCallback(
    async (optionId: string) => {
      const opt = options.find((o) => o.id === optionId);
      if (!opt) throw new Error("wallet not found");
      await attach(opt, true);
    },
    [options, attach],
  );

  const disconnect = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    localStorage.removeItem(LAST_WALLET);
    setActive(null);
    activeRef.current = null;
    setAccount(null);
    await refreshSession();
  }, [refreshSession]);

  const walletClient = useCallback((): WalletClient => {
    const opt = activeRef.current;
    if (!opt || !account) throw new Error("connect a wallet first");
    if (opt.kind === "dev") {
      return createWalletClient({ account: privateKeyToAccount(opt.privateKey!), chain, transport: http("/api/rpc") });
    }
    return createWalletClient({ account, chain, transport: custom(opt.provider!) });
  }, [account, chain]);

  const ensureChain = useCallback(async () => {
    const opt = activeRef.current;
    if (!opt || opt.kind === "dev") return;
    const p = opt.provider!;
    const current = Number(await p.request({ method: "eth_chainId" }));
    if (current === config.chainId) return;
    const hex = numberToHex(config.chainId);
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code !== 4902 && code !== -32603) throw e;
      await p.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hex,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: chain.rpcUrls.default.http,
            blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
          },
        ],
      });
    }
    setWalletChainId(config.chainId);
  }, [chain, config.chainId]);

  const signIn = useCallback(async () => {
    if (!account) throw new Error("connect a wallet first");
    setBusy("Signing in…");
    try {
      const { nonce } = await api<{ nonce: string }>("/api/auth/nonce", { method: "POST" });
      const message = createSiweMessage({
        domain: window.location.host,
        address: account,
        statement: "Sign in to ReleaseBond. This signature does not send a transaction or cost gas.",
        uri: window.location.origin,
        version: "1",
        chainId: config.chainId,
        nonce,
        issuedAt: new Date(),
      });
      const signature = await walletClient().signMessage({ account, message });
      await api("/api/auth/verify", { method: "POST", json: { message, signature } });
      await refreshSession();
    } finally {
      setBusy(null);
    }
  }, [account, config.chainId, walletClient, refreshSession]);

  const sendTx = useCallback<WalletState["sendTx"]>(
    async (label, send) => {
      if (!account) throw new Error("connect a wallet first");
      setBusy(`${label}: confirm in your wallet…`);
      try {
        await ensureChain();
        const hash = await send(walletClient(), account);
        setBusy(`${label}: waiting for block…`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
        if (receipt.status !== "success") throw new Error(`${label} transaction reverted (${hash})`);
        setBusy(`${label}: indexing…`);
        await api("/api/chain/sync", { method: "POST", json: { txHash: hash } });
        return hash;
      } catch (e) {
        throw new Error(errorMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [account, ensureChain, walletClient, publicClient],
  );

  const value: WalletState = {
    config,
    options,
    account,
    walletChainId,
    session,
    busy,
    connect,
    disconnect,
    signIn,
    sendTx,
    publicClient,
    refreshSession,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

/** True when the connected wallet is the signed-in account. */
export function useSignedIn(): boolean {
  const { account, session } = useWallet();
  return !!account && !!session.address && session.address === account.toLowerCase();
}
