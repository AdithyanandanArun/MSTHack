// Gate G18: the app's explorer link formats resolve on MST Testnet's Blockscout.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const web = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "web");
const r = spawnSync("npx", ["tsx", "scripts/explorer-check.ts"], { cwd: web, encoding: "utf8", timeout: 300_000 });
const fail = (m) => {
  console.error(`${r.stdout}\n${r.stderr}`.slice(-2000));
  console.error(`explorer check failed: ${m}`);
  process.exit(1);
};
if (r.status !== 0) fail(`exit ${r.status}`);
const o = JSON.parse(r.stdout.trim().split("\n").pop());
console.log(JSON.stringify(o, null, 1));
if (!o.txTitle.toLowerCase().includes(`transaction ${o.tx.toLowerCase()}`)) fail("tx page is not titled for that transaction");
if (!/address details for 0x9ddd1f5ac413abb02d642471fb0d415a75fa17be/i.test(o.addrTitle)) fail("address page is not titled for that address");
if (o.apiRealStatus !== 200) fail("explorer API does not know the real transaction");
if (o.apiBogusStatus !== 404) fail("explorer API did not reject a random hash (negative control)");
console.log("EXPLORER LINKS VERIFIED");
