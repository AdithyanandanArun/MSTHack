// Gate G2: proves the compiled ReleaseBond bytecode is accepted by the live MST Testnet EVM.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RPC = process.env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
const EXPECTED_CHAIN = 91562037;

const artifact = JSON.parse(
  readFileSync(path.join(root, "contracts/artifacts/contracts/ReleaseBond.sol/ReleaseBond.json"), "utf8"),
);

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

const chainId = parseInt(await rpc("eth_chainId", []), 16);
if (chainId !== EXPECTED_CHAIN) {
  console.error(`unexpected chain id ${chainId}`);
  process.exit(1);
}
// Constructor arg: owner address (any non-zero address works for simulation).
const owner = "0x1111111111111111111111111111111111111111";
const data = artifact.bytecode + owner.slice(2).toLowerCase().padStart(64, "0");
const gas = parseInt(await rpc("eth_estimateGas", [{ from: owner, data }]), 16);
const block = await rpc("eth_getBlockByNumber", ["latest", false]);
const gasLimit = parseInt(block.gasLimit, 16);
console.log(`chainId=${chainId} deployGas=${gas} blockGasLimit=${gasLimit} bytecodeBytes=${(artifact.bytecode.length - 2) / 2}`);
if (!(gas > 100000 && gas < gasLimit)) {
  console.error("deploy gas estimate out of range");
  process.exit(1);
}
console.log("MST TESTNET DEPLOY ESTIMATE OK");
