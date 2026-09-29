// MST Testnet demo server: npm run demo:mst  (web on :3000, or WEB_PORT)
// Builds into its own dist dir when the source changed, keeps MST data in web/data-mst, and serves
// production Next.js. Connect with the BridgeKey extension on MST Testnet; deploy once from /admin.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(root, "web");
const DIST = ".next-mst";
const PORT = process.env.WEB_PORT || "3000";

function newestInput() {
  let newest = 0;
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e));
    else newest = Math.max(newest, st.mtimeMs);
  };
  for (const p of ["src", "public", "next.config.ts", "package.json", "postcss.config.mjs"]) {
    if (fs.existsSync(path.join(web, p))) walk(path.join(web, p));
  }
  return newest;
}

const rpc = process.env.RELEASEBOND_RPC_URL || "https://testnetrpc.mstblockchain.com";
try {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
  const id = Number((await r.json()).result);
  if (id !== 91562037) throw new Error(`chain id ${id}`);
  console.log(`MST Testnet RPC ok (${rpc})`);
} catch (e) {
  console.error(`cannot reach MST Testnet at ${rpc}: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

const buildId = path.join(web, DIST, "BUILD_ID");
if (!fs.existsSync(buildId) || fs.statSync(buildId).mtimeMs < newestInput()) {
  console.log("building the web app…");
  const b = spawnSync("npx", ["next", "build"], { cwd: web, stdio: "inherit", env: { ...process.env, NEXT_DIST_DIR: DIST } });
  if (b.status !== 0) process.exit(1);
}
const docker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
console.log(`\nReleaseBond on MST Testnet -> http://localhost:${PORT}`);
console.log("Wallet: BridgeKey on MST Testnet. First run: open /admin and deploy ReleaseBond from your wallet.\n");
const child = spawn("npx", ["next", "start", "-p", PORT], {
  cwd: web,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_DIST_DIR: DIST,
    RELEASEBOND_CHAIN: "mstTestnet",
    RELEASEBOND_DATA_DIR: process.env.RELEASEBOND_DATA_DIR || path.join(web, "data-mst"),
    RELEASEBOND_SANDBOX: process.env.RELEASEBOND_SANDBOX || (docker ? "docker" : "off"),
    // Plain http on localhost; production behind HTTPS should leave this unset.
    RELEASEBOND_INSECURE_COOKIES: process.env.RELEASEBOND_INSECURE_COOKIES ?? "1",
  },
});
const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
