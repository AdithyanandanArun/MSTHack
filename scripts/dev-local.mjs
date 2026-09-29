// One-command local demo: Hardhat chain + ReleaseBond deployment + Next dev
// server with the built-in dev wallets (no Bridgekey or faucet needed).
//   node scripts/dev-local.mjs            (web on :3000, chain on :8545)
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contracts = path.join(root, "contracts");
const web = path.join(root, "web");
const RPC = "http://127.0.0.1:8545";
const PORT = process.env.WEB_PORT || "3000";
const kids = [];
const stop = () => kids.forEach((k) => { try { process.kill(-k.pid, "SIGTERM"); } catch { /* gone */ } });
process.on("SIGINT", () => { stop(); process.exit(0); });
process.on("SIGTERM", () => { stop(); process.exit(0); });
process.on("exit", stop);

const up = async () => {
  try {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
    return (await r.json()).result === "0x7a69";
  } catch {
    return false;
  }
};

if (!(await up())) {
  kids.push(spawn("npx", ["hardhat", "node", "--hostname", "127.0.0.1"], { cwd: contracts, stdio: "ignore", detached: true }));
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
}
// Hardhat only mines when a transaction arrives, so chain time (which drives room phases) would stand
// still between transactions. Mine an empty block every second so a 3-minute hunt closes on time.
await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"evm_setIntervalMining","params":[1000]}' });
// Redeploy when there is no deployment, or when the deployed code is not the
// current build (e.g. after a contract change), so the demo never runs an old ABI.
spawnSync("npx", ["hardhat", "compile", "--quiet"], { cwd: contracts, stdio: "inherit" });
const { immutableRanges, sameRuntimeCode, ARTIFACT } = createRequire(import.meta.url)(path.join(contracts, "scripts", "immutables.js"));
const compiled = JSON.parse(fs.readFileSync(ARTIFACT, "utf8")).deployedBytecode;
const dep = path.join(contracts, "deployments", "localhost.json");
let needDeploy = true;
if (fs.existsSync(dep)) {
  const { address } = JSON.parse(fs.readFileSync(dep, "utf8"));
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }) });
  const code = String((await r.json()).result).toLowerCase();
  needDeploy = !sameRuntimeCode(code, compiled, immutableRanges());
  if (needDeploy && code !== "0x") console.log("deployed ReleaseBond differs from the current build; redeploying");
}
if (needDeploy) {
  const d = spawnSync("npx", ["hardhat", "run", "scripts/deploy.js", "--network", "localhost"], {
    cwd: contracts,
    stdio: "inherit",
    env: { ...process.env, PRIVATE_KEY: "", RELEASEBOND_MODERATORS: "" },
  });
  if (d.status !== 0) process.exit(1);
  // New chain: drop the old local index so it does not mix chains.
  fs.rmSync(path.join(web, "data-local"), { recursive: true, force: true });
}
const docker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
console.log(`\nReleaseBond local demo -> http://localhost:${PORT}  (dev wallets: Dev #0 owner/moderator, #1 developer, #2-#4 researchers)\n`);
kids.push(
  spawn("npx", ["next", "dev", "-p", PORT], {
    cwd: web,
    stdio: "inherit",
    detached: true,
    env: {
      ...process.env,
      NEXT_DIST_DIR: ".next-local",
      RELEASEBOND_CHAIN: "localhost",
      RELEASEBOND_RPC_URL: RPC,
      RELEASEBOND_DATA_DIR: path.join(web, "data-local"),
      RELEASEBOND_SANDBOX: docker ? "docker" : "off",
    },
  }),
);
await new Promise(() => {});
