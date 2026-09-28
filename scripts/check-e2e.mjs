// Gate G5: full ReleaseBond lifecycle against a fresh local chain and the production web server.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(root, "web");
const contracts = path.join(root, "contracts");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rb-e2e-"));
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
    env: { ...process.env, LOCAL_RPC_URL: rpc, DEPLOYMENTS_OUT: deployment, PRIVATE_KEY: "" },
  });
  if (dep.status !== 0) throw new Error(`deploy failed:\n${dep.stdout}\n${dep.stderr}`);
  const { address, deployBlock } = JSON.parse(fs.readFileSync(deployment, "utf8"));
  console.log(`contract ${address} at block ${deployBlock}`);

  if (!fs.existsSync(path.join(web, ".next", "BUILD_ID"))) {
    const b = spawnSync("npx", ["next", "build"], { cwd: web, encoding: "utf8" });
    if (b.status !== 0) throw new Error(`next build failed:\n${b.stdout.slice(-3000)}`);
  }
  const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" }).status === 0;
  start("web", "npx", ["next", "start", "-H", "127.0.0.1", "-p", String(webPort)], {
    cwd: web,
    env: {
      ...process.env,
      NODE_ENV: "production",
      RELEASEBOND_CHAIN: "localhost",
      RELEASEBOND_RPC_URL: rpc,
      RELEASEBOND_CONTRACT_ADDRESS: address,
      RELEASEBOND_DEPLOY_BLOCK: String(deployBlock),
      RELEASEBOND_DATA_DIR: path.join(tmp, "data"),
      RELEASEBOND_INSECURE_COOKIES: "1",
      RELEASEBOND_SANDBOX: docker ? "docker" : "off",
      SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret",
      RELEASEBOND_RATE_LIMIT_SCALE: "0.5",
      RELEASEBOND_UPLOAD_QUOTA_BYTES: "1000000",
      ANTHROPIC_API_KEY: "",
    },
  });
  await waitFor("web server", async () => (await fetch(`${base}/api/config`)).ok);

  const e2e = spawnSync("npx", ["tsx", "scripts/e2e.ts"], {
    cwd: web,
    encoding: "utf8",
    env: { ...process.env, E2E_BASE: base, E2E_RPC: rpc, E2E_CONTRACT: address },
    timeout: 600_000,
  });
  process.stdout.write(e2e.stdout);
  process.stderr.write(e2e.stderr);
  if (e2e.status !== 0 || !e2e.stdout.includes("E2E LIFECYCLE PASSED")) {
    console.error(`--- web server log (tail) ---\n${fs.readFileSync(path.join(tmp, "web.log"), "utf8").slice(-4000)}`);
    throw new Error("lifecycle script failed");
  }
  console.log(`sandbox: ${docker ? "docker" : "unavailable (static evidence only)"}`);
} catch (e) {
  console.error(`e2e check failed: ${e instanceof Error ? e.message : e}`);
  cleanup();
  process.exit(1);
}
cleanup();
fs.rmSync(tmp, { recursive: true, force: true });
