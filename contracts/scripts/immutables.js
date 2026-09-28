// ReleaseBond inherits EIP712, whose constructor writes immutables (cached
// domain separator, chain id, address, name/version hashes) into the runtime
// code. Deployed code therefore never equals the compiled deployedBytecode
// byte for byte; compare with those ranges masked out.
const fs = require("fs");
const path = require("path");

const ARTIFACT = path.join(__dirname, "..", "artifacts", "contracts", "ReleaseBond.sol", "ReleaseBond.json");
const BUILD_INFO = path.join(__dirname, "..", "artifacts", "build-info");

/** [{start, length}] byte ranges of immutables in the current build's runtime code. */
function immutableRanges() {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
  for (const f of fs.readdirSync(BUILD_INFO)) {
    const info = JSON.parse(fs.readFileSync(path.join(BUILD_INFO, f), "utf8"));
    const c = info.output?.contracts?.["contracts/ReleaseBond.sol"]?.ReleaseBond;
    if (!c || `0x${c.evm.deployedBytecode.object}`.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) continue;
    return Object.values(c.evm.deployedBytecode.immutableReferences).flat();
  }
  throw new Error("no build-info matches the current ReleaseBond artifact; run `npx hardhat compile`");
}

/** True when `actual` runtime code is the compiled contract, ignoring immutable values. */
function sameRuntimeCode(actual, expected, ranges) {
  const a = actual.toLowerCase().replace(/^0x/, "");
  const e = expected.toLowerCase().replace(/^0x/, "");
  if (a.length !== e.length) return false;
  const mask = (hex) => {
    const chars = hex.split("");
    for (const { start, length } of ranges) for (let i = start * 2; i < (start + length) * 2; i++) chars[i] = "0";
    return chars.join("");
  };
  return mask(a) === mask(e);
}

module.exports = { immutableRanges, sameRuntimeCode, ARTIFACT };
