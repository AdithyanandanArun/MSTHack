import { z } from "zod";
import { getAddress } from "viem";
import { releaseBondAbi } from "@/lib/chain/releaseBondArtifact";
import { isReleaseBondRuntime } from "@/lib/chain/runtimeCode";
import { json, route } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { appConfig, contractInfo, publicClient } from "@/lib/server/config";
import { setSetting } from "@/lib/server/db";
import { HttpError } from "@/lib/server/queries";
import { syncChain } from "@/lib/server/sync";

const Body = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

/**
 * Registers a ReleaseBond deployment made from the browser wallet. The server
 * trusts nothing from the client except the tx hash: it reads the receipt,
 * checks the runtime bytecode matches this build, and reads the owner.
 */
export const POST = route(async (req) => {
  const caller = await requireSession();
  const { txHash } = Body.parse(await req.json());
  const client = publicClient();
  const current = contractInfo().address;
  if (current) {
    const owner = (await client.readContract({ address: current, abi: releaseBondAbi, functionName: "owner" })) as string;
    if (owner.toLowerCase() !== caller) throw new HttpError(403, "a contract is already configured; only its owner can replace it");
  }
  const receipt = await client.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 120_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new HttpError(400, "transaction did not deploy a contract");
  if (receipt.from.toLowerCase() !== caller) throw new HttpError(403, "deployment was sent by a different wallet");
  const code = await client.getCode({ address: receipt.contractAddress });
  if (!isReleaseBondRuntime(code)) {
    throw new HttpError(400, "deployed bytecode does not match this ReleaseBond build");
  }
  const address = getAddress(receipt.contractAddress);
  setSetting(`contract:${appConfig().chainId}`, JSON.stringify({ address, deployBlock: Number(receipt.blockNumber) }));
  await syncChain({ force: true });
  return json({ address, deployBlock: Number(receipt.blockNumber) });
});
