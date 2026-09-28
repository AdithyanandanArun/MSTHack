// Runs the real Docker sandbox on the demo package (positive control) and the
// benign package (negative control) and prints the observations.
import fs from "node:fs";
import path from "node:path";
import { ensureImage, runNpmSandbox } from "../src/lib/evidence/sandbox";

const ART = path.resolve(__dirname, "../../demo/artifacts");

(async () => {
  await ensureImage();
  const bad = await runNpmSandbox(fs.readFileSync(path.join(ART, "releasebond-demo-telemetry-2.0.0.tgz")), 1);
  const good = await runNpmSandbox(fs.readFileSync(path.join(ART, "releasebond-benign-utils-1.0.0.tgz")), 1);
  const obs = (r: typeof bad) => [...new Set(r.facts.map((f) => f.observation).filter(Boolean))].sort();
  console.log(JSON.stringify({ bad: { ok: bad.ok, obs: obs(bad), details: bad.facts.map((f) => f.detail) }, good: { ok: good.ok, obs: obs(good) } }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
