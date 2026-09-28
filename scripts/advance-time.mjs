// Local chain only: jump forward in time so a demo room moves to the next phase.
//   node scripts/advance-time.mjs 600
const seconds = Number(process.argv[2] || 600);
const rpc = process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545";
const call = (method, params) =>
  fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());
const chain = await call("eth_chainId", []);
if (chain.result !== "0x7a69") {
  console.error("refusing: not a local Hardhat chain");
  process.exit(1);
}
await call("evm_increaseTime", [seconds]);
await call("evm_mine", []);
console.log(`advanced ${seconds}s`);
