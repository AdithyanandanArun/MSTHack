// One-command local demo: Hardhat chain + ReleaseBond deployment + Next dev
// server with the built-in dev wallets (no Bridgekey or faucet needed).
//   node scripts/dev-local.mjs            (web on :3000, chain on :8545)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contracts = path.join(root, "contracts");
const web = path.join(root, "web");
const RPC = "http://127.0.0.1:8545";
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
// A fresh Hardhat node always deploys ReleaseBond at the same address; redeploy if it is missing.
const dep = path.join(contracts, "deployments", "localhost.json");
let needDeploy = true;
if (fs.existsSync(dep)) {
  const { address } = JSON.parse(fs.readFileSync(dep, "utf8"));
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }) });
  needDeploy = (await r.json()).result === "0x";
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
console.log(`\nReleaseBond local demo -> http://localhost:3000  (dev wallets: Dev #0 owner/moderator, #1 developer, #2-#4 researchers)\n`);
kids.push(
  spawn("npx", ["next", "dev", "-p", "3000"], {
    cwd: web,
    stdio: "inherit",
    detached: true,
    env: {
      ...process.env,
      RELEASEBOND_CHAIN: "localhost",
      RELEASEBOND_RPC_URL: RPC,
      RELEASEBOND_DATA_DIR: path.join(web, "data-local"),
      RELEASEBOND_SANDBOX: docker ? "docker" : "off",
    },
  }),
);
await new Promise(() => {});
