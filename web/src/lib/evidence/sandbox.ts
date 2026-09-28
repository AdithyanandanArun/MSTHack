// Dynamic evidence: runs an npm release's install-time lifecycle scripts and a
// require() of its entry point inside a throwaway Docker container with no
// network, planted canary credentials and strace. The output is parsed into
// the same Fact model as the static rules.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DynamicRun, Fact } from "./types";

export const SANDBOX_IMAGE = process.env.RELEASEBOND_SANDBOX_IMAGE || "releasebond-sandbox-npm:1";
const RUN_TIMEOUT_MS = 60_000;

const DOCKERFILE = `FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends strace ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd -m -d /home/sandbox -s /bin/sh sandbox
USER sandbox
WORKDIR /home/sandbox
`;

// Node preload: records reads of secret-looking environment variables and
// network attempts by hostname (DNS fails without a network, so strace alone
// would never see the destination).
const HOOK_JS = String.raw`
"use strict";
const fs = require("fs");
const out = "/out/node-events.log";
const log = (kind, value) => { try { fs.appendFileSync(out, JSON.stringify({ kind, value, pid: process.pid }) + "\n"); } catch {} };
const SECRET = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_KEY|ACCESS_KEY|^AWS_|^NPM_|^GITHUB_|^GH_|^SSH_)/i;
const real = process.env;
const seen = new Set();
process.env = new Proxy(real, {
  get(t, k) { if (typeof k === "string" && SECRET.test(k) && !seen.has(k)) { seen.add(k); log("env", k); } return t[k]; },
  ownKeys(t) { if (!seen.has("*")) { seen.add("*"); log("env-enumerate", "*"); } return Reflect.ownKeys(t); },
});
const dns = require("dns");
const origLookup = dns.lookup;
dns.lookup = function (host, ...rest) { log("dns", String(host)); return origLookup.call(this, host, ...rest); };
const net = require("net");
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const o = args[0];
  if (o && typeof o === "object" && (o.host || o.port)) log("connect", (o.host || "localhost") + ":" + (o.port || ""));
  else if (typeof o === "number") log("connect", (typeof args[1] === "string" ? args[1] : "localhost") + ":" + o);
  return origConnect.apply(this, args);
};
const cp = require("child_process");
for (const fn of ["exec", "execSync", "spawn", "spawnSync", "execFile", "execFileSync", "fork"]) {
  const orig = cp[fn];
  cp[fn] = function (cmd, ...rest) { log("spawn", String(cmd).slice(0, 200)); return orig.call(this, cmd, ...rest); };
}
`;

// Runs inside the container as the unprivileged "sandbox" user.
const RUNNER_SH = String.raw`#!/bin/sh
set -u
mkdir -p /home/sandbox/.ssh /home/sandbox/.aws /home/sandbox/work/pkg
printf -- "-----BEGIN OPENSSH PRIVATE KEY-----\nRELEASEBOND-CANARY-DO-NOT-USE\n-----END OPENSSH PRIVATE KEY-----\n" > /home/sandbox/.ssh/id_rsa
cp /home/sandbox/.ssh/id_rsa /home/sandbox/.ssh/demo_key
printf "[default]\naws_access_key_id=RBCANARY\naws_secret_access_key=RELEASEBOND-CANARY\n" > /home/sandbox/.aws/credentials
printf "//registry.npmjs.org/:_authToken=RELEASEBOND-CANARY\n" > /home/sandbox/.npmrc
tar -xzf /rb/pkg.tgz -C /home/sandbox/work/pkg --strip-components=1 2>/dev/null || tar -xf /rb/pkg.tgz -C /home/sandbox/work/pkg --strip-components=1
cd /home/sandbox/work/pkg
export NODE_OPTIONS="--require /rb/hook.js"
export PATH="/home/sandbox/work/pkg/node_modules/.bin:$PATH"
for hook in preinstall install postinstall; do
  script=$(node -e "const p=require('/home/sandbox/work/pkg/package.json');process.stdout.write((p.scripts&&p.scripts['$hook'])||'')" 2>/dev/null)
  if [ -n "$script" ]; then
    echo "== lifecycle $hook: $script"
    strace -f -qq -s 256 -e trace=openat,execve,connect -o "/out/strace-$hook.log" timeout 20 sh -c "$script"
    echo "== $hook exit $?"
  fi
done
echo "== require entry point"
strace -f -qq -s 256 -e trace=openat,execve,connect -o /out/strace-require.log timeout 20 node -e "require('/home/sandbox/work/pkg')"
echo "== require exit $?"
`;

function sh(
  cmd: string,
  args: string[],
  opts: { input?: string; timeoutMs?: number; onTimeout?: () => void } = {},
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => {
      opts.onTimeout?.();
      p.kill("SIGKILL");
    }, opts.timeoutMs ?? RUN_TIMEOUT_MS);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, out: String(e) });
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
    if (opts.input) p.stdin.end(opts.input);
    else p.stdin.end();
  });
}

export async function sandboxAvailable(): Promise<{ ok: boolean; reason?: string }> {
  if (process.env.RELEASEBOND_SANDBOX !== "docker") {
    return { ok: false, reason: "dynamic sandbox disabled (set RELEASEBOND_SANDBOX=docker to enable)" };
  }
  const info = await sh("docker", ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 15_000 });
  if (info.code !== 0) return { ok: false, reason: "docker daemon unavailable" };
  return { ok: true };
}

export async function ensureImage(): Promise<void> {
  const has = await sh("docker", ["image", "inspect", SANDBOX_IMAGE], { timeoutMs: 15_000 });
  if (has.code === 0) return;
  const build = await sh("docker", ["build", "-t", SANDBOX_IMAGE, "-"], { input: DOCKERFILE, timeoutMs: 600_000 });
  if (build.code !== 0) throw new Error(`failed to build sandbox image: ${build.out.slice(-800)}`);
}

const SENSITIVE_PATH =
  /(\/\.ssh\/|\/\.aws\/credentials|\/\.npmrc|\/\.git-credentials|\/\.bash_history|\/etc\/shadow|\/\.gnupg|\/\.docker\/config\.json|\/\.kube\/config|\/\.netrc)/;
const EXPECTED_EXEC = new Set(["sh", "dash", "bash", "node", "timeout", "strace", "env"]);

/** Parses strace + hook logs into facts. Exported for unit tests. */
export function parseTelemetry(files: Record<string, string>, run: number): Fact[] {
  const facts: Fact[] = [];
  const add = (f: Omit<Fact, "id" | "source">) => facts.push({ id: `D${run}.${facts.length + 1}`, source: "dynamic", ...f });
  const seen = new Set<string>();
  const once = (key: string) => (seen.has(key) ? false : (seen.add(key), true));

  for (const [name, text] of Object.entries(files)) {
    if (!name.startsWith("strace-")) continue;
    const phase = name.replace(/^strace-|\.log$/g, "");
    // The runner only traces a lifecycle hook when package.json declares it and it ran.
    if (phase !== "require" && once(`hook:${phase}`)) {
      add({
        rule: "dyn.lifecycle-hook",
        category: "install-script",
        severity: "medium",
        observation: "INSTALL_SCRIPT",
        detail: `${phase} lifecycle script executed at install time`,
      });
    }
    for (const line of text.split("\n")) {
      const open = line.match(/openat\([^,]+,\s*"([^"]+)",\s*([A-Z_|]+)/);
      if (open) {
        const [, p, flags] = open;
        const failed = /= -1 /.test(line);
        if (SENSITIVE_PATH.test(p) && once(`read:${p}`)) {
          add({
            rule: "dyn.sensitive-open",
            category: "filesystem",
            severity: "high",
            observation: "FS_SENSITIVE_READ",
            file: p,
            snippet: line.slice(0, 240),
            detail: `${phase}: opened sensitive file ${p}${failed ? " (failed)" : ""}`,
          });
        }
        const writes = /O_WRONLY|O_RDWR|O_CREAT/.test(flags);
        if (writes && !failed && !/^(\/home\/sandbox\/work\/|\/tmp\/|\/proc\/|\/dev\/|\/out\/|\/home\/sandbox\/\.npm\/)/.test(p) && once(`write:${p}`)) {
          add({
            rule: "dyn.write-outside",
            category: "filesystem",
            severity: "medium",
            observation: SENSITIVE_PATH.test(p) || /\.(bashrc|profile|zshrc)$/.test(p) ? "PERSISTENCE" : "FS_WRITE_OUTSIDE_PACKAGE",
            file: p,
            snippet: line.slice(0, 240),
            detail: `${phase}: wrote ${p} outside the package directory`,
          });
        }
        continue;
      }
      const conn = line.match(/connect\(\d+,\s*\{sa_family=(AF_INET6?),\s*sin6?_port=htons\((\d+)\),\s*(?:sin_addr=inet_addr\("([^"]+)"\)|[^}]*inet_pton\(AF_INET6,\s*"([^"]+)")/);
      if (conn) {
        const addr = `${conn[3] ?? conn[4]}:${conn[2]}`;
        if (once(`conn:${addr}`)) {
          add({
            rule: "dyn.connect",
            category: "network",
            severity: "high",
            observation: "NETWORK_EGRESS",
            snippet: line.slice(0, 240),
            detail: `${phase}: attempted outbound connection to ${addr} (blocked: sandbox has no network)`,
          });
        }
        continue;
      }
      const exec = line.match(/execve\("([^"]+)",\s*\[([^\]]*)\]/);
      if (exec && !/= -1 /.test(line)) {
        const bin = path.basename(exec[1]);
        if (!EXPECTED_EXEC.has(bin) && once(`exec:${bin}`)) {
          add({
            rule: "dyn.exec",
            category: "process",
            severity: "medium",
            observation: "PROCESS_SPAWN",
            snippet: line.slice(0, 240),
            detail: `${phase}: executed ${exec[1]}`,
          });
        }
      }
    }
  }

  for (const line of (files["node-events.log"] ?? "").split("\n")) {
    if (!line.trim()) continue;
    let ev: { kind: string; value: string };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.kind === "env" && once(`env:${ev.value}`)) {
      add({
        rule: "dyn.env-secret",
        category: "environment",
        severity: "high",
        observation: "ENV_SECRET_READ",
        detail: `read secret-looking environment variable ${ev.value}`,
      });
    } else if (ev.kind === "env-enumerate" && once("env-enum")) {
      add({
        rule: "dyn.env-enumerate",
        category: "environment",
        severity: "medium",
        observation: "ENV_SECRET_READ",
        detail: "enumerated the whole environment",
      });
    } else if ((ev.kind === "dns" || ev.kind === "connect") && once(`${ev.kind}:${ev.value}`)) {
      add({
        rule: `dyn.${ev.kind}`,
        category: "network",
        severity: "high",
        observation: "NETWORK_EGRESS",
        detail: ev.kind === "dns" ? `resolved hostname ${ev.value}` : `opened socket to ${ev.value}`,
      });
    } else if (ev.kind === "spawn" && once(`spawn:${ev.value}`)) {
      add({
        rule: "dyn.child-process",
        category: "process",
        severity: "medium",
        observation: "PROCESS_SPAWN",
        detail: `spawned child process: ${ev.value}`,
      });
    }
  }
  return facts;
}

/** One isolated execution of an npm tarball's install lifecycle. */
export async function runNpmSandbox(tarball: Buffer, run: number): Promise<DynamicRun> {
  const started = Date.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rb-sbx-"));
  const outDir = path.join(dir, "out");
  const inDir = path.join(dir, "in");
  fs.mkdirSync(outDir, { mode: 0o777 });
  fs.mkdirSync(inDir);
  fs.chmodSync(outDir, 0o777); // container user differs from the host user
  fs.writeFileSync(path.join(inDir, "pkg.tgz"), tarball);
  fs.writeFileSync(path.join(inDir, "hook.js"), HOOK_JS);
  fs.writeFileSync(path.join(inDir, "run.sh"), RUNNER_SH, { mode: 0o755 });
  const command = "docker run --network none (lifecycle scripts + require under strace)";
  // Killing the docker CLI does not stop the container, so name it and kill it by name on timeout.
  const name = `rb-sbx-${path.basename(dir).replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
  try {
    const res = await sh(
      "docker",
      [
      "run",
      "--rm",
      "--name",
      name,
      "--network",
      "none",
      "--memory",
      "512m",
      "--cpus",
      "1",
      "--pids-limit",
      "256",
      "--cap-drop",
      "ALL",
      "--cap-add",
      "SYS_PTRACE",
      "--security-opt",
      "no-new-privileges",
      "-e",
      "AWS_SECRET_ACCESS_KEY=RELEASEBOND-CANARY",
      "-e",
      "GITHUB_TOKEN=RELEASEBOND-CANARY",
      "-e",
      "NPM_TOKEN=RELEASEBOND-CANARY",
      "-v",
      `${inDir}:/rb:ro`,
      "-v",
      `${outDir}:/out`,
      SANDBOX_IMAGE,
      "sh",
      "/rb/run.sh",
      ],
      { onTimeout: () => spawn("docker", ["kill", name], { stdio: "ignore" }) },
    );
    const files: Record<string, string> = {};
    for (const f of fs.readdirSync(outDir)) files[f] = fs.readFileSync(path.join(outDir, f), "utf8");
    return {
      run,
      ok: res.code === 0,
      exitCode: res.code,
      durationMs: Date.now() - started,
      command,
      facts: parseTelemetry(files, run),
      error: res.code === 0 ? undefined : res.out.slice(-600),
      ...(process.env.RB_SANDBOX_DEBUG ? { debug: res.out, files: Object.keys(files) } : {}),
    };
  } catch (e) {
    return { run, ok: false, exitCode: null, durationMs: Date.now() - started, command, facts: [], error: String(e) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
