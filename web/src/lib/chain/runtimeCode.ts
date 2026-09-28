import { releaseBondDeployedBytecode, releaseBondImmutableRanges } from "./releaseBondArtifact";

/**
 * True when deployed runtime code is this build of ReleaseBond. EIP-712
 * immutables are written at deploy time, so those byte ranges are masked.
 */
export function isReleaseBondRuntime(code: string | undefined | null): boolean {
  if (!code) return false;
  const a = code.toLowerCase().replace(/^0x/, "");
  const e = releaseBondDeployedBytecode.toLowerCase().replace(/^0x/, "");
  if (a.length !== e.length) return false;
  const mask = (hex: string) => {
    const chars = hex.split("");
    for (const { start, length } of releaseBondImmutableRanges) for (let i = start * 2; i < (start + length) * 2; i++) chars[i] = "0";
    return chars.join("");
  };
  return mask(a) === mask(e);
}
