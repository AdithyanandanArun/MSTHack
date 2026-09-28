// Runs every automated gate check in order and summarizes.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const checks = ["check-contracts", "check-mst-testnet", "check-web-unit", "check-web-build", "check-e2e", "check-sandbox", "check-pacman", "check-explorer", "check-backup", "check-verify-payload", "check-repo"];
let failed = 0;
for (const c of checks) {
  const t0 = Date.now();
  const r = spawnSync("node", [path.join(here, `${c}.mjs`)], { encoding: "utf8" });
  const ok = r.status === 0;
  if (!ok) failed++;
  const last = `${r.stdout}${r.stderr}`.trim().split("\n").pop();
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.padEnd(18)} ${((Date.now() - t0) / 1000).toFixed(1)}s  ${last}`);
}
process.exit(failed ? 1 : 0);
