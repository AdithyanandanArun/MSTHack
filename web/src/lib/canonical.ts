// Hashing helpers shared by the browser and the server so a researcher can
// recompute every hash the server shows them.
import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortDeep(v);
    }
    return out;
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];
/** On-chain severity code: 1 low .. 4 critical. */
export const severityCode = (s: Severity): number => SEVERITIES.indexOf(s) + 1;

export const OBSERVATIONS = [
  "INSTALL_SCRIPT",
  "FS_SENSITIVE_READ",
  "FS_WRITE_OUTSIDE_PACKAGE",
  "NETWORK_EGRESS",
  "PROCESS_SPAWN",
  "ENV_SECRET_READ",
  "DYNAMIC_CODE_EXEC",
  "OBFUSCATED_CODE",
  "PERSISTENCE",
  "SETUID_BINARY",
] as const;
export type Observation = (typeof OBSERVATIONS)[number];

export const OBSERVATION_LABELS: Record<Observation, string> = {
  INSTALL_SCRIPT: "Runs code at install time",
  FS_SENSITIVE_READ: "Reads sensitive files (keys, credentials)",
  FS_WRITE_OUTSIDE_PACKAGE: "Writes outside its own directory",
  NETWORK_EGRESS: "Makes outbound network connections",
  PROCESS_SPAWN: "Spawns shells or child processes",
  ENV_SECRET_READ: "Reads secret environment variables",
  DYNAMIC_CODE_EXEC: "Evaluates dynamically built code",
  OBFUSCATED_CODE: "Contains obfuscated / encoded payloads",
  PERSISTENCE: "Installs persistence (services, cron, shell rc)",
  SETUID_BINARY: "Ships setuid/setgid binaries",
};

export interface FindingContent {
  roomId: number;
  title: string;
  claimedSeverity: Severity;
  description: string;
  proofOfConcept: string;
  reproduction: string;
  observations: Observation[];
  /** sha256 hex digests of attached proof files */
  attachments: string[];
}

export function normalizeFindingContent(c: FindingContent): FindingContent {
  return {
    roomId: c.roomId,
    title: c.title.trim(),
    claimedSeverity: c.claimedSeverity,
    description: c.description.replace(/\r\n/g, "\n"),
    proofOfConcept: c.proofOfConcept.replace(/\r\n/g, "\n"),
    reproduction: c.reproduction.replace(/\r\n/g, "\n"),
    observations: [...new Set(c.observations)].sort(),
    attachments: [...new Set(c.attachments.map((a) => a.toLowerCase()))].sort(),
  };
}

/** findingHash = keccak256(utf8(canonical JSON of the normalized report)). */
export function findingHash(content: FindingContent): Hex {
  return keccak256(toBytes(canonicalJson({ v: 1, ...normalizeFindingContent(content) })));
}

/** Mirrors ReleaseBond.computeCommitment. */
export function computeCommitment(args: {
  roomId: bigint | number;
  artifactHash: Hex;
  findingHash: Hex;
  researcher: Address;
  nonce: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }],
      [BigInt(args.roomId), args.artifactHash, args.findingHash, args.researcher, args.nonce],
    ),
  );
}

export function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** sha256 hex (no prefix) -> bytes32 used on-chain for artifact hashes. */
export const sha256ToBytes32 = (hex: string): Hex => `0x${hex.replace(/^0x/, "").toLowerCase()}` as Hex;

export interface AwardArgs {
  discoveries: { commitmentIndex: number; severity: number; duplicate: boolean; amount: bigint }[];
  reviews: { reviewer: Address; amount: bigint }[];
  rejected: number[];
}

/** Mirrors ReleaseBond.hashAwards: keccak256(abi.encode(discoveries, reviews, rejected)). */
export function hashAwards(a: AwardArgs): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple[]",
          components: [
            { name: "commitmentIndex", type: "uint32" },
            { name: "severity", type: "uint8" },
            { name: "duplicate", type: "bool" },
            { name: "amount", type: "uint256" },
          ],
        },
        { type: "tuple[]", components: [{ name: "reviewer", type: "address" }, { name: "amount", type: "uint256" }] },
        { type: "uint32[]" },
      ],
      [a.discoveries, a.reviews, a.rejected],
    ),
  );
}

/** EIP-712 typed data a panelist signs to approve a settlement (see ReleaseBond.settlementDigest). */
export const SETTLEMENT_TYPES = {
  Settlement: [
    { name: "roomId", type: "uint256" },
    { name: "adjudicationHash", type: "bytes32" },
    { name: "awardsHash", type: "bytes32" },
  ],
} as const;

export function settlementDomain(chainId: number, contract: Address) {
  return { name: "ReleaseBond", version: "1", chainId, verifyingContract: contract } as const;
}

export function adjudicationHash(record: unknown): Hex {
  return keccak256(toBytes(canonicalJson(record)));
}
