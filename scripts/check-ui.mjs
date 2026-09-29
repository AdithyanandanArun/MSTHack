// Gate G31: the hero demo driven through the real UI in a browser, plus a page audit in light/dark x
// desktop/mobile (console errors, horizontal overflow, colour contrast). Uses a fresh local chain and a
// production build in its own dist dir, rebuilt whenever the source is newer than the build.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(root, "web");
const contracts = path.join(root, "contracts");
const DIST = ".next-ui";
// --tour <path under web/> runs another browser script against the same stack (e.g. the BridgeKey tour).
const tourArg = process.argv.indexOf("--tour");
const TOUR = tourArg > 0 ? process.argv[tourArg + 1] : "scripts/ui-tour.mjs";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rb-ui-"));
const children = [];

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

function start(name, cmd, args, opts) {
  const log = fs.openSync(path.join(tmp, `${name}.log`), "w");
  const p = spawn(cmd, args, { ...opts, stdio: ["ignore", log, log], detached: true });
  children.push(p);
  return p;
}

async function waitFor(label, fn, timeoutMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await fn()) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not become ready`);
}

/** Newest modification time among the inputs of the web build. */
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

function cleanup() {
  for (const c of children) {
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

try {
  const buildId = path.join(web, DIST, "BUILD_ID");
  if (!fs.existsSync(buildId) || fs.statSync(buildId).mtimeMs < newestInput()) {
    console.log(`building web app into ${DIST}…`);
    const b = spawnSync("npx", ["next", "build"], { cwd: web, encoding: "utf8", env: { ...process.env, NEXT_DIST_DIR: DIST } });
    if (b.status !== 0) throw new Error(`next build failed:\n${(b.stdout + b.stderr).slice(-3000)}`);
  }

  const rpcPort = await freePort();
  const webPort = await freePort();
  const rpc = `http://127.0.0.1:${rpcPort}`;
  const base = `http://127.0.0.1:${webPort}`;
  start("hardhat", "npx", ["hardhat", "node", "--hostname", "127.0.0.1", "--port", String(rpcPort)], { cwd: contracts });
  await waitFor("hardhat node", async () => {
    const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    return (await r.json()).result === "0x7a69";
  });
  const deployment = path.join(tmp, "deployment.json");
  const dep = spawnSync("npx", ["hardhat", "run", "scripts/deploy.js", "--network", "localhost"], {
    cwd: contracts,
    encoding: "utf8",
    env: { ...process.env, LOCAL_RPC_URL: rpc, DEPLOYMENTS_OUT: deployment, PRIVATE_KEY: "", RELEASEBOND_MODERATORS: "" },
  });
  if (dep.status !== 0) throw new Error(`deploy failed:\n${dep.stdout}\n${dep.stderr}`);
  const { address, deployBlock } = JSON.parse(fs.readFileSync(deployment, "utf8"));

  const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" }).status === 0;
  start("web", "npx", ["next", "start", "-H", "127.0.0.1", "-p", String(webPort)], {
    cwd: web,
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_DIST_DIR: DIST,
      RELEASEBOND_CHAIN: "localhost",
      RELEASEBOND_RPC_URL: rpc,
      RELEASEBOND_CONTRACT_ADDRESS: address,
      RELEASEBOND_DEPLOY_BLOCK: String(deployBlock),
      RELEASEBOND_DATA_DIR: path.join(tmp, "data"),
      RELEASEBOND_INSECURE_COOKIES: "1",
      RELEASEBOND_SANDBOX: docker ? "docker" : "off",
      SESSION_SECRET: "ui-tour-secret-ui-tour-secret-ui-tour",
      ANTHROPIC_API_KEY: "",
    },
  });
  await waitFor("web server", async () => (await fetch(`${base}/api/config`)).ok);

  const tour = spawnSync("node", [TOUR], {
    cwd: web,
    stdio: "inherit",
    env: { ...process.env, UI_BASE: base, UI_RPC: rpc, UI_SANDBOX: docker ? "1" : "0" },
    timeout: 900_000,
  });
  if (tour.status !== 0) {
    console.error(`--- web server log (tail) ---\n${fs.readFileSync(path.join(tmp, "web.log"), "utf8").slice(-3000)}`);
    throw new Error("ui tour failed");
  }
} catch (e) {
  console.error(`ui check failed: ${e instanceof Error ? e.message : e}`);
  cleanup();
  process.exit(1);
}
cleanup();
fs.rmSync(tmp, { recursive: true, force: true });
