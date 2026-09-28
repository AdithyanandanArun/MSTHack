// Gate G3: web unit tests, including Solidity hash parity and positive/negative evidence controls.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const report = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rb-vitest-")), "report.json");
const res = spawnSync("npx", ["vitest", "run", "--reporter=default", "--reporter=json", `--outputFile.json=${report}`], {
  cwd: path.join(root, "web"),
  encoding: "utf8",
});
process.stdout.write(`${res.stdout}\n${res.stderr}`.slice(-3000));
const fail = (m) => {
  console.error(`web unit check failed: ${m}`);
  process.exit(1);
};
if (res.status !== 0) fail(`vitest exited ${res.status}`);
const r = JSON.parse(fs.readFileSync(report, "utf8"));
if (r.numFailedTests !== 0) fail(`${r.numFailedTests} failing`);
const names = r.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === "passed").map((a) => a.title));
const required = [
  "matches ReleaseBond.computeCommitment (vector produced by the Solidity contract)",
  "flags the compromised release (positive control)",
  "stays silent on the benign control package (negative control)",
  "respects the contract's review caps and excludes conflicted reviewers",
  "keeps findings private to their author during the hunt",
  "allows the budget within a window then blocks with a retry-after",
  "isolates keys so one wallet cannot spend another's budget",
  "resets after the window elapses",
  "lets the author or developer appeal a verdict once during review",
  "refuses appeals from others, before a verdict, or outside review",
  "only a different registered moderator may decide an open appeal",
];
for (const n of required) if (!names.includes(n)) fail(`required test did not pass: ${n}`);
if (r.numPassedTests < 25) fail(`only ${r.numPassedTests} passing`);
console.log(`WEB UNIT VERIFIED (${r.numPassedTests} passing)`);
