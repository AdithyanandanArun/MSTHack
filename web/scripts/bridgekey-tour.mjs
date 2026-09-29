// Drives the real BridgeKey extension (the MST wallet) through ReleaseBond against a local stack:
// connect, sign in, deploy from /admin, switch accounts, fund a room, commit a finding.
// Run with: npm run check:bridgekey  (scripts/check-ui.mjs --tour scripts/bridgekey-tour.mjs).
//
// Needs internet (downloads BridgeKey from the Chrome Web Store), `unzip` and `openssl`. BridgeKey only
// talks to https RPCs, so the local chain is fronted by a self-signed HTTPS proxy that this Chromium
// is told to trust. The wallet imports Hardhat's public test phrase, so its accounts are the funded
// dev accounts: Account 1 = owner/moderator, 2 = developer, 3 = researcher.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { chromePath } from "./chromium.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = process.env.UI_BASE;
const RPC_HTTP = process.env.UI_RPC;
if (!BASE || !RPC_HTTP) throw new Error("UI_BASE and UI_RPC are required (run npm run check:bridgekey)");
const EXTENSION_ID = "bfjojdcfenehemjgjlepdjomkpginlkg";
const MNEMONIC = "test test test test test test test test test test test junk"; // Hardhat's public test phrase
const PASSWORD = "releasebond-demo";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rb-bridgekey-"));
const OUT = process.env.UI_OUT || path.join(ROOT, "web", ".ui-tour", "bridgekey");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} failed (is it installed?): ${(r.stderr || r.stdout || "").slice(0, 300)}`);
}
function step(msg) {
  console.log(`• ${msg}`);
}

// 1. Fetch and unpack the published extension (a CRX3 file is a small header followed by a zip).
step("downloading BridgeKey from the Chrome Web Store");
const crx = Buffer.from(
  await (await fetch(`https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0&acceptformat=crx2,crx3&x=id%3D${EXTENSION_ID}%26uc`)).arrayBuffer(),
);
if (crx.subarray(0, 4).toString() !== "Cr24") throw new Error("download is not a Chrome extension package");
fs.writeFileSync(path.join(tmp, "ext.zip"), crx.subarray(12 + crx.readUInt32LE(8)));
run("unzip", ["-q", "-o", path.join(tmp, "ext.zip"), "-d", path.join(tmp, "ext")]);
fs.rmSync(path.join(tmp, "ext", "_metadata"), { recursive: true, force: true }); // Chrome refuses it when unpacked
const version = JSON.parse(fs.readFileSync(path.join(tmp, "ext", "manifest.json"), "utf8")).version;
console.log(`  BridgeKey ${version}`);

// 2. HTTPS proxy in front of the local chain.
run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "key.pem"), "-out", path.join(tmp, "cert.pem"), "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"]);
const proxy = https.createServer({ key: fs.readFileSync(path.join(tmp, "key.pem")), cert: fs.readFileSync(path.join(tmp, "cert.pem")) }, async (req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const r = await fetch(RPC_HTTP, { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.concat(chunks) });
  res.writeHead(r.status, { ...cors, "content-type": "application/json" }).end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const RPC = `https://127.0.0.1:${proxy.address().port}`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const ctx = await chromium.launchPersistentContext(path.join(tmp, "profile"), {
  executablePath: chromePath(),
  headless: true,
  args: [`--disable-extensions-except=${path.join(tmp, "ext")}`, `--load-extension=${path.join(tmp, "ext")}`, "--ignore-certificate-errors"],
  viewport: { width: 1280, height: 900 },
});
const pageErrors = [];
let failed = false;
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 20_000 });
  const EXT = new URL(sw.url()).host;
  const extUrl = `chrome-extension://${EXT}/src/popup/index.html`;

  // 3. Import the test wallet.
  step("importing the test wallet into BridgeKey");
  const ext = await ctx.newPage();
  await ext.goto(extUrl);
  await ext.getByRole("button", { name: "Import an existing wallet" }).click();
  await ext.locator("textarea").fill(MNEMONIC);
  await ext.locator("input[type=password]").nth(0).fill(PASSWORD);
  await ext.locator("input[type=password]").nth(1).fill(PASSWORD);
  await ext.getByRole("button", { name: "Import Wallet", exact: true }).click();
  await ext.getByRole("button", { name: "Account 1" }).waitFor({ timeout: 90_000 });

  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  page.on("pageerror", (e) => pageErrors.push(e.message));

  /** Triggers a wallet request and approves it in BridgeKey's approval window. */
  let shot = 0;
  async function approve(trigger, tag) {
    await trigger();
    await page.waitForTimeout(1500);
    const pop = ctx.pages().find((p) => p !== ext && p.url().startsWith(`chrome-extension://${EXT}`)) ?? ext;
    if (pop === ext) await ext.goto(extUrl);
    await pop.bringToFront();
    await pop.waitForTimeout(1500);
    if (await pop.locator("input[type=password]").isVisible().catch(() => false)) {
      await pop.locator("input[type=password]").fill(PASSWORD);
      await pop.getByRole("button", { name: "Unlock" }).click();
      await pop.waitForTimeout(1500);
    }
    const text = await pop.locator("body").innerText();
    await pop.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, "0")}-${tag}.png`) });
    if (/claims to be for/.test(text)) throw new Error(`${tag}: BridgeKey warns that the sign-in domain does not match the site`);
    const ok = pop.getByRole("button", { name: /^(Approve|Confirm|Connect|Add network|Switch network)\b/ });
    if ((await ok.count()) === 0) {
      // An account that is already connected to this site is answered without a prompt.
      if (tag.endsWith("-connect")) return void (await page.bringToFront());
      throw new Error(`${tag}: no approval in BridgeKey (${text.slice(0, 200).replace(/\s+/g, " ")})`);
    }
    await ok.last().click();
    await page.bringToFront();
  }
  /** Signs in through /signin: choose BridgeKey, approve the connection, sign, pick a display name. */
  async function signInAs(tag, handle, next) {
    await page.goto(`${BASE}/signin?switch=1&next=${encodeURIComponent(next)}`);
    // Step 1 (choose BridgeKey) is skipped when the wallet's active account is already connected here.
    const choice = page.getByRole("button", { name: /BridgeKey/ });
    const signBtn = page.getByRole("button", { name: /^Sign in as/ });
    await choice.or(signBtn).first().waitFor();
    await page.waitForTimeout(2500); // BridgeKey may still announce the newly selected account
    if (!(await signBtn.isVisible()) && (await choice.isVisible())) await approve(() => choice.click(), `${tag}-connect`);
    await approve(() => page.getByRole("button", { name: /^Sign in as/ }).click(), `${tag}-sign-in`);
    await page.getByRole("heading", { name: "Choose a display name" }).waitFor({ timeout: 30_000 });
    await page.getByPlaceholder("e.g. alice").fill(handle);
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL((u) => u.pathname === next, { timeout: 30_000 });
    return page.evaluate(() => fetch("/api/auth/me").then((r) => r.json()).then((j) => j.address));
  }
  async function becomeAccount(n) {
    await ext.bringToFront();
    await ext.goto(extUrl);
    await ext.getByRole("button", { name: /^Account \d$/ }).first().click();
    await ext.getByRole("button", { name: new RegExp(`Account ${n}\\s`) }).first().click();
    await page.bringToFront();
    // The app notices the switch without a reload (it polls eth_accounts) and says so in the account menu.
    await page.waitForTimeout(3000);
    await page.locator("header").getByRole("button").last().click();
    await page.getByText(/a different account|not connected/).first().waitFor({ timeout: 10_000 });
  }

  step("connect and sign in (personal_sign) as the owner");
  const owner = await signInAs("owner", "maya-mod", "/admin");
  if (owner !== "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266") throw new Error(`signed in as ${owner}`);
  const addChain = page.evaluate(
    (rpc) => window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x7a69", chainName: "ReleaseBond test chain", rpcUrls: [rpc], nativeCurrency: { name: "Ether", symbol: "tETH", decimals: 18 } }] }),
    RPC,
  );
  await approve(async () => {}, "add-test-chain");
  await addChain;

  step("EIP-712 support (moderator panels)");
  const typed = await page.evaluate(async () => {
    const [a] = await window.ethereum.request({ method: "eth_accounts" });
    return window.ethereum.request({ method: "eth_signTypedData_v4", params: [a, "{}"] }).then(() => "supported", (e) => `unsupported (${e.code})`);
  });
  console.log(`  eth_signTypedData_v4: ${typed}`);

  step("deploy ReleaseBond from /admin (contract creation)");
  await page.reload();
  await approve(() => page.getByRole("button", { name: "Deploy ReleaseBond from my wallet" }).click(), "deploy");
  const deployed = await page.getByText(/Deployed and registered at/).innerText({ timeout: 90_000 });
  console.log(`  ${deployed.trim()}`);

  step("switch to Account 2 (developer) and fund a room");
  await becomeAccount(2);
  const developer = await signInAs("developer", "dana-dev", "/rooms/new");
  if (developer !== "0x70997970c51812dc3a010c7d01b50e0d17dc79c8") throw new Error(`developer signed in as ${developer}`);
  await page.getByText("Upload artifact").click();
  await page.locator('input[type="file"]').nth(0).setInputFiles(path.join(ROOT, "demo/artifacts/releasebond-demo-telemetry-2.0.0.tgz"));
  await page.getByRole("button", { name: "Fetch & verify artifact" }).click();
  const lock = page.getByRole("button", { name: /^Lock .* and open the room$/ });
  await lock.waitFor({ timeout: 120_000 });
  await page.getByLabel("Hunt duration").selectOption({ label: "3 minutes (demo)" });
  await approve(() => lock.click(), "fund");
  await page.waitForURL(/\/rooms\/\d+$/, { timeout: 90_000 });
  const roomPath = new URL(page.url()).pathname;
  console.log(`  room ${roomPath} funded`);

  step("switch to Account 3 (researcher) and commit a finding");
  await becomeAccount(3);
  const researcher = await signInAs("researcher", "alice", "/dashboard");
  if (researcher !== "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc") throw new Error(`researcher signed in as ${researcher}`);
  await page.goto(`${BASE}${roomPath}/findings/new`);
  await page.getByPlaceholder(/^Title/).fill("postinstall reads ~/.ssh keys and posts them to a remote host");
  await page.getByLabel("Runs code at install time").check();
  await approve(() => page.getByRole("button", { name: "Commit finding on-chain" }).click(), "commit");
  await page.waitForURL(/\/findings\/\d+$/, { timeout: 90_000 });
  const index = await page.getByText(/Index \d+ · block \d+/).first().innerText();
  console.log(`  committed on-chain: ${index}`);
  const flashes = await page.locator(".flash-error").allInnerTexts();
  if (flashes.length || pageErrors.length) throw new Error(`errors: ${[...flashes, ...pageErrors].join(" | ")}`);
  console.log(`BRIDGEKEY TOUR PASSED: BridgeKey ${version}; connect, sign-in, admin deploy, account switch, fund, commit; typed data ${typed}`);
} catch (e) {
  failed = true;
  console.error(`bridgekey tour failed: ${e instanceof Error ? e.message.split("\n").slice(0, 4).join("\n") : e}`);
  for (const [i, p] of ctx.pages().entries()) await p.screenshot({ path: path.join(OUT, `failure-${i}.png`) }).catch(() => undefined);
  console.error(`screenshots in ${OUT}`);
} finally {
  await ctx.close();
  proxy.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
