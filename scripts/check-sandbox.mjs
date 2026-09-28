// Gate G6: the Docker sandbox observes install-time behaviour of the demo package
// (positive control) and records nothing for the benign package (negative control).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const web = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "web");
const r = spawnSync("npx", ["tsx", "scripts/sandbox-check.ts"], { cwd: web, encoding: "utf8", timeout: 900_000 });
const fail = (m) => {
  console.error(`${r.stdout}\n${r.stderr}`.slice(-3000));
  console.error(`sandbox check failed: ${m}`);
  process.exit(1);
};
if (r.status !== 0) fail(`exit ${r.status}`);
const line = r.stdout.trim().split("\n").pop();
const res = JSON.parse(line);
console.log(JSON.stringify(res, null, 1));
if (!res.bad.ok || !res.good.ok) fail("a sandbox run errored");
for (const o of ["FS_SENSITIVE_READ", "NETWORK_EGRESS", "ENV_SECRET_READ", "INSTALL_SCRIPT"]) {
  if (!res.bad.obs.includes(o)) fail(`demo package: ${o} not observed`);
}
if (!res.bad.details.some((d) => d.includes("/home/sandbox/.ssh/demo_key"))) fail("key path not recorded");
if (!res.bad.details.some((d) => d.includes("203.0.113.10:443"))) fail("destination not recorded");
if (res.good.obs.length !== 0) fail(`benign package produced observations: ${res.good.obs}`);
console.log("SANDBOX TELEMETRY VERIFIED");
