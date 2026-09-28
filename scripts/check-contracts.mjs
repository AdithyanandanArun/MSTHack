// Gate G1: runs the Hardhat suite and asserts every required behaviour group ran and passed.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const res = spawnSync("npx", ["hardhat", "test"], { cwd: path.join(root, "contracts"), encoding: "utf8" });
const out = `${res.stdout}\n${res.stderr}`;
process.stdout.write(out.slice(-4000));

const fail = (m) => {
  console.error(`contract check failed: ${m}`);
  process.exit(1);
};
if (res.status !== 0) fail(`hardhat exited ${res.status}`);
const passing = Number((out.match(/(\d+) passing/) || [])[1] || 0);
if (/\d+ failing/.test(out)) fail("failing tests present");
if (passing < 15) fail(`only ${passing} tests passing`);
const required = [
  "escrows the bounty",
  "reveals only after the hunt",
  "enforces award rules",
  "pays discoverers and reviewers",
  "refuses discovery awards for unrevealed commitments",
  "returns the pool only after the adjudication deadline",
  "forbids a developer from moderating their own release",
  "panel quorum enforced",
  "matches the EIP-712 digest wallets sign",
  "validates panel composition when the room is created",
];
for (const r of required) if (!out.includes(r)) fail(`missing test: ${r}`);
console.log(`CONTRACT SUITE VERIFIED (${passing} passing)`);
