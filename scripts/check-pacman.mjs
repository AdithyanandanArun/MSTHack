// Gate G7: the pacman adapter fetches a real Arch package, verifies it against the
// official repo database checksum, and normalizes it into a ReleaseArtifact.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const web = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "web");
const r = spawnSync("npx", ["tsx", "scripts/pacman-check.ts", "which"], { cwd: web, encoding: "utf8", timeout: 300_000 });
const fail = (m) => {
  console.error(`${r.stdout}\n${r.stderr}`.slice(-3000));
  console.error(`pacman check failed: ${m}`);
  process.exit(1);
};
if (r.status !== 0) fail(`exit ${r.status}`);
const a = JSON.parse(r.stdout.trim().split("\n").pop());
console.log(JSON.stringify(a, null, 1));
if (a.ecosystem !== "pacman" || a.name !== "which") fail("wrong package");
if (!/^[0-9a-f]{64}$/.test(a.sha256) || a.sha256 !== a.independentSha256) fail("hash mismatch");
if (!a.registryIntegrity?.verified) fail("not verified against the Arch repo database");
if (!a.hasPkginfo || a.files < 3) fail("package contents not parsed");
if (!a.dependencies.includes("glibc")) fail(".PKGINFO dependencies not parsed");
if (!a.previous) fail("previous version not found in the archive");
console.log("PACMAN ADAPTER VERIFIED");
