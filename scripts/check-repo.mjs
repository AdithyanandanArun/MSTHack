// Gate G8: granular history without AI co-author trailers, handoff docs present,
// clean tree, and local HEAD pushed to origin/main.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const fail = (m) => {
  console.error(`repo check failed: ${m}`);
  process.exit(1);
};

const TRAILER = /co-authored-by:.*(claude|anthropic)/i;
// Positive control: the detector must catch a real trailer.
if (!TRAILER.test("Fix\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>")) fail("trailer detector broken");

const count = Number(git("rev-list", "--count", "HEAD"));
if (count < 15) fail(`only ${count} commits`);
const bodies = git("log", "--format=%H%n%B%n==END==").split("==END==");
const offenders = bodies.filter((b) => TRAILER.test(b)).map((b) => b.trim().split("\n")[0]);
if (offenders.length) fail(`co-author trailers in ${offenders.join(", ")}`);

for (const [file, needles] of [
  ["README.md", ["MST Testnet", "Quick start", "Verification"]],
  ["HANDOFF.md", ["Known gaps", "Traps already found", "G9"]],
]) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  for (const n of needles) if (!text.includes(n)) fail(`${file} lacks "${n}"`);
}

// GATES.md is rewritten by the gate checker itself while it records evidence.
const dirty = git("status", "--porcelain")
  .split("\n")
  .filter((l) => l && !/^\s*M\s+GATES\.md$/.test(l))
  .join("\n");
if (dirty) fail(`working tree not clean:\n${dirty}`);
git("fetch", "--quiet", "origin", "main");
const local = git("rev-parse", "HEAD");
const remote = git("rev-parse", "origin/main");
if (local !== remote) fail(`HEAD ${local.slice(0, 8)} != origin/main ${remote.slice(0, 8)}`);
console.log(`${count} commits, head ${local.slice(0, 8)} pushed`);
console.log("REPO STATE VERIFIED");
