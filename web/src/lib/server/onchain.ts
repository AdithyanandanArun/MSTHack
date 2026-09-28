import "server-only";
import type { Address } from "viem";
import { releaseBondAbi } from "@/lib/chain/releaseBondArtifact";
import { contractInfo, publicClient } from "./config";

export interface ResearcherStats {
  validDiscoveries: number;
  duplicateDiscoveries: number;
  criticalFindings: number;
  highFindings: number;
  reviewAwards: number;
  rejectedFindings: number;
  totalEarned: bigint;
}

export async function statsOf(address: string): Promise<ResearcherStats | null> {
  const { address: contract } = contractInfo();
  if (!contract) return null;
  try {
    const s = (await publicClient().readContract({ address: contract, abi: releaseBondAbi, functionName: "statsOf", args: [address as Address] })) as {
      validDiscoveries: number;
      duplicateDiscoveries: number;
      criticalFindings: number;
      highFindings: number;
      reviewAwards: number;
      rejectedFindings: number;
      totalEarned: bigint;
    };
    return { ...s };
  } catch {
    return null;
  }
}

export async function pendingWithdrawal(address: string): Promise<bigint> {
  const { address: contract } = contractInfo();
  if (!contract) return 0n;
  try {
    return (await publicClient().readContract({ address: contract, abi: releaseBondAbi, functionName: "pendingWithdrawals", args: [address as Address] })) as bigint;
  } catch {
    return 0n;
  }
}

export async function contractOwner(): Promise<string | null> {
  const { address: contract } = contractInfo();
  if (!contract) return null;
  try {
    return ((await publicClient().readContract({ address: contract, abi: releaseBondAbi, functionName: "owner" })) as string).toLowerCase();
  } catch {
    return null;
  }
}
