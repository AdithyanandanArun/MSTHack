// Browser tour of the hero demo (README "Hero demo script") against a running local stack.
// Started by scripts/check-ui.mjs, which provides a fresh chain, contract and production server.
//
// It drives every step through the real UI with the local dev wallets, then audits each page in four
// variants (light/dark x desktop/mobile) for console errors, horizontal overflow and axe colour-contrast
// violations, and saves a screenshot of every variant for visual review.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { chromePath } from "./chromium.mjs";

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = process.env.UI_BASE;
const RPC = process.env.UI_RPC;
const OUT = process.env.UI_OUT || path.join(ROOT, "web", ".ui-tour");
const SANDBOX = process.env.UI_SANDBOX === "1";
if (!BASE || !RPC) throw new Error("UI_BASE and UI_RPC are required (run scripts/check-ui.mjs)");

const VARIANTS = [
  { name: "light-desktop", colorScheme: "light", viewport: { width: 1280, height: 900 } },
  { name: "dark-desktop", colorScheme: "dark", viewport: { width: 1280, height: 900 } },
  { name: "light-mobile", colorScheme: "light", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: "dark-mobile", colorScheme: "dark", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
const TX_TIMEOUT = 60_000;


const rpc = (method, params = []) =>
  fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());
async function advance(seconds) {
  await rpc("evm_increaseTime", [seconds]);
  await rpc("evm_mine");
  await new Promise((r) => setTimeout(r, 3_100)); // the server caches chain time for 3 s
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: chromePath() });
const consoleErrors = [];
const overflow = [];
const contrast = [];
const audited = [];

function watch(page, where, { expect404 = false } = {}) {
  page.on("console", (m) => {
    // A not-found page is served with status 404, which the browser logs for the document itself.
    if (expect404 && /status of 404/.test(m.text()) && m.location().url === page.url()) return;
    if (m.type() === "error") consoleErrors.push(`${where} ${page.url().replace(BASE, "")}: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`${where} ${page.url().replace(BASE, "")}: pageerror ${e.message.slice(0, 300)}`));
}

function step(msg) {
  console.log(`• ${msg}`);
}

const HANDLES = ["maya-mod", "dana-dev", "alice", "bob", "carol"];

/** Signs in a dev wallet through /signin in its own browser context (separate cookies per actor). */
async function actor(n) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(TX_TIMEOUT);
  watch(page, `Dev #${n}`);
  await page.goto(`${BASE}/`);
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.waitForURL(/\/signin/);
  await page.getByRole("button", { name: new RegExp(`^Dev #${n} \\(`) }).click();
  await page.getByRole("button", { name: /^Sign in as/ }).click();
  await page.getByRole("heading", { name: "Choose a display name" }).waitFor();
  await page.getByPlaceholder("e.g. alice").fill(HANDLES[n]);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL((u) => u.pathname === "/"); // back where "Sign in" was clicked
  await page.getByRole("button", { name: new RegExp(HANDLES[n]) }).waitFor();
  const address = (await page.evaluate(() => fetch("/api/auth/me").then((r) => r.json()))).address;
  return { n, ctx, page, address };
}

/** Loads a page in all four variants as the given viewer and records every defect. */
async function audit(label, url, viewer, { status = 200 } = {}) {
  const storageState = viewer ? await viewer.ctx.storageState() : undefined;
  const slug = `${String(audited.length + 1).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  for (const v of VARIANTS) {
    const ctx = await browser.newContext({ colorScheme: v.colorScheme, viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, storageState });
    const page = await ctx.newPage();
    watch(page, `[${label} ${v.name}]`, { expect404: status === 404 });
    const res = await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
    if (res?.status() !== status) consoleErrors.push(`${label} ${v.name}: HTTP ${res?.status()} (expected ${status})`);
    await page.waitForTimeout(250);
    // clientWidth is the layout viewport; on mobile, innerWidth grows when the browser zooms out to fit
    // over-wide content, which would hide exactly the overflow this looks for.
    const over = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const extra = document.documentElement.scrollWidth - width;
      if (extra <= 1) return null;
      const offenders = [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > width + 1)
        .filter((el) => !el.parentElement || el.parentElement.getBoundingClientRect().right <= width + 1)
        .slice(0, 4)
        .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} "${(el.textContent || "").trim().slice(0, 40)}"`);
      return { extra, offenders };
    });
    if (over) overflow.push(`${label} ${v.name}: +${over.extra}px ${over.offenders.join(" | ")}`);
    await page.addScriptTag({ path: AXE });
    const violations = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] } });
      return r.violations.flatMap((x) => x.nodes.map((n) => `${n.target.join(" ")} — ${(n.any[0]?.message || "").split(".")[0]}`));
    });
    for (const x of violations) contrast.push(`${label} ${v.name}: ${x}`);
    await page.screenshot({ path: path.join(OUT, `${slug}-${v.name}.png`), fullPage: true });
    await ctx.close();
  }
  audited.push(label);
}

async function composer(page, kindLabel, body) {
  const box = page.locator(".card", { hasText: /Add a response|Reply to response/ }).last();
  await box.locator("select").first().selectOption({ label: kindLabel });
  await box.locator("textarea").fill(body);
  await box.getByRole("button", { name: /^Post / }).click();
  await page.getByText(body.slice(0, 40)).first().waitFor();
}

try {
  await audit("home (empty)", "/", null);
  await audit("sign in (choose wallet)", "/signin", null);

  step("developer funds the demo release from the UI");
  const dev = await actor(1);
  await dev.page.goto(`${BASE}/rooms/new`);
  await dev.page.getByText("Upload artifact").click();
  await dev.page.locator('input[type="file"]').nth(0).setInputFiles(path.join(ROOT, "demo/artifacts/releasebond-demo-telemetry-2.0.0.tgz"));
  await dev.page.locator('input[type="file"]').nth(1).setInputFiles(path.join(ROOT, "demo/artifacts/releasebond-demo-telemetry-1.0.0.tgz"));
  await dev.page.getByRole("button", { name: "Fetch & verify artifact" }).click();
  const lock = dev.page.getByRole("button", { name: /^Lock .* and open the room$/ });
  await lock.waitFor({ timeout: 120_000 });
  await dev.page.getByLabel("Title (optional)").fill("New streaming parser and install-time telemetry");
  await dev.page.getByLabel("Hunt duration").selectOption({ label: "3 minutes (demo)" });
  await dev.page.getByLabel("Private disclosure / patch window").selectOption({ label: "2 minutes (demo)" });
  await lock.click();
  await dev.page.waitForURL(/\/rooms\/\d+$/, { timeout: TX_TIMEOUT });
  const roomPath = new URL(dev.page.url()).pathname;
  await dev.page.getByText("Hunting", { exact: true }).first().waitFor();

  step("three researchers commit private findings");
  const [a, b, c] = [await actor(2), await actor(3), await actor(4)];
  const findingPath = {};
  const REPORT = {
    a: [
      "## Summary\n`scripts/telemetry.js` is new in 2.0.0 and runs from `postinstall`. It reads `~/.ssh/demo_key` and `AWS_SECRET_ACCESS_KEY` and POSTs both to `203.0.113.10:443`.\n\n## Impact\nAnyone installing 2.0.0 leaks their SSH key and AWS secret.\n\n## Root cause\n`package.json` adds `\"postinstall\": \"node scripts/telemetry.js\"`; the payload is in `scripts/telemetry.js:12-31`.\n",
      "```sh\nnpm install releasebond-demo-telemetry@2.0.0\nstrace -f -e trace=openat,connect npm install\n```",
      "1. Clean sandbox with a canary key at `~/.ssh/demo_key`\n2. `npm install releasebond-demo-telemetry@2.0.0`\n3. Observe the key read and the connect() to 203.0.113.10:443",
    ],
    b: ["## Summary\nThe install hook reads `AWS_SECRET_ACCESS_KEY` and sends it to a hard-coded host over HTTPS.\n", "", "1. `AWS_SECRET_ACCESS_KEY=canary npm install`\n2. Watch outbound traffic"],
    c: ["## Summary\nThe package installs a cron job so it keeps running after uninstall.\n", "", ""],
  };
  const DEMO_OBS = ["Runs code at install time", "Reads sensitive files (keys, credentials)", "Makes outbound network connections", "Reads secret environment variables"];
  for (const [who, key, title, sev, obs] of [
    [a, "a", "postinstall reads ~/.ssh keys and posts them to a remote host", "high", DEMO_OBS],
    [b, "b", "Install hook exfiltrates AWS credentials over HTTPS", "high", [DEMO_OBS[0], DEMO_OBS[3], DEMO_OBS[2]]],
    [c, "c", "Package installs a persistent cron job", "critical", ["Installs persistence (services, cron, shell rc)"]],
  ]) {
    await who.page.goto(`${BASE}${roomPath}`);
    await who.page.getByRole("link", { name: "Submit private finding" }).click();
    await who.page.waitForURL(/\/findings\/new$/);
    if (who === a) await audit("new finding editor", new URL(who.page.url()).pathname, who);
    await who.page.getByPlaceholder(/^Title/).fill(title);
    const [desc, poc, repro] = REPORT[key];
    const editors = who.page.locator("main textarea, textarea");
    await editors.nth(0).fill(desc);
    if (poc) await editors.nth(1).fill(poc);
    if (repro) await editors.nth(2).fill(repro);
    await who.page.locator("aside select").selectOption(sev);
    for (const label of obs) await who.page.getByLabel(label).check();
    await who.page.getByRole("button", { name: "Commit finding on-chain" }).click();
    await who.page.waitForURL(/\/findings\/\d+$/, { timeout: TX_TIMEOUT });
    findingPath[who.n] = new URL(who.page.url()).pathname;
  }
  await audit("room (hunting, public)", roomPath, null);
  await audit("finding (author, hunting)", findingPath[2], a);

  step("hunt closes: developer responds, researchers reveal");
  await advance(181);
  await dev.page.goto(`${BASE}${findingPath[2]}`);
  await composer(dev.page, "Developer response", "Confirmed: telemetry.js was added by a compromised maintainer token. 2.0.1 removes it.");
  for (const who of [a, b, c]) {
    await who.page.goto(`${BASE}${roomPath}`);
    const reveal = who.page.getByRole("button", { name: "Reveal", exact: true });
    await reveal.first().click();
    await reveal.first().waitFor({ state: "detached", timeout: TX_TIMEOUT });
  }
  await audit("room (disclosure, developer)", roomPath, dev);

  step("peer review: reproduce, refute, reply, withdraw");
  await advance(121);
  await b.page.goto(`${BASE}${findingPath[2]}`);
  if (SANDBOX) {
    await b.page.getByRole("button", { name: "Run reproduction" }).click();
    await b.page.getByText(/^Run #\d+:/).first().waitFor({ timeout: 240_000 });
  }
  await composer(b.page, "Reproduced", "Reproduced in a fresh sandbox: open(~/.ssh/demo_key) then connect(203.0.113.10:443).");
  await c.page.goto(`${BASE}${findingPath[2]}`);
  await composer(c.page, "Refutation", "Could not reproduce: the postinstall hook exits early on CI runners.");
  await a.page.goto(`${BASE}${findingPath[2]}`);
  await a.page.locator(".card", { hasText: "Could not reproduce" }).getByRole("button", { name: "Reply" }).click();
  await composer(a.page, "Comment", "The early exit only checks CI=true; on developer machines the hook runs. See the attached trace.");
  await c.page.reload();
  await c.page.locator(".card", { hasText: "Could not reproduce" }).getByRole("button", { name: "Withdraw" }).click();
  await c.page.locator(".card", { hasText: "Could not reproduce" }).getByText("withdrawn", { exact: true }).waitFor();

  step("moderator adjudicates, freezes the record and settles on-chain");
  const mod = await actor(0);
  const idOf = (p) => Number(p.split("/").pop());
  const verdicts = [
    [findingPath[2], "Valid", "high"],
    [findingPath[3], "Independent duplicate", String(idOf(findingPath[2]))],
    [findingPath[4], "Invalid", null],
  ];
  for (const [fp, verdict, extra] of verdicts) {
    await mod.page.goto(`${BASE}${fp}`);
    if (fp === findingPath[2]) await audit("finding (moderator, review)", fp, mod);
    const box = mod.page.locator("aside div.pb-4", { hasText: "Moderator: adjudicate" });
    await box.locator("select").first().selectOption({ label: verdict });
    if (verdict === "Valid") await box.locator("select").nth(1).selectOption(extra);
    if (verdict === "Independent duplicate") await box.getByPlaceholder("original finding #").fill(extra);
    await box.getByPlaceholder("Public reasoning (required)").fill(
      verdict === "Valid" ? "Reproduced independently; the hook reads the key and sends it off-host." : verdict === "Invalid" ? "No cron entry is created by any install script." : "Same root cause as the original, reported independently.",
    );
    const reviewer = box.locator('input[type="checkbox"]');
    if ((await reviewer.count()) > 0) await reviewer.first().check();
    await box.getByRole("button", { name: "Record verdict" }).click();
    await mod.page.getByText("Moderator adjudication").waitFor();
  }
  await mod.page.goto(`${BASE}${roomPath}?tab=settlement`);
  await mod.page.getByRole("button", { name: "1. Freeze adjudication record" }).click();
  await mod.page.getByText("Record hash (recomputed in your browser)").waitFor();
  await mod.page.getByRole("button", { name: "2. Sign finalizeSettlement" }).click();
  await mod.page.getByRole("heading", { name: "Settlement (on-chain)" }).waitFor({ timeout: TX_TIMEOUT });
  await mod.page.getByText("✔ matches the adjudication hash stored on-chain").waitFor();

  step("researcher withdraws the award");
  await a.page.goto(`${BASE}/dashboard`);
  const withdraw = a.page.getByRole("button", { name: "Withdraw to wallet" });
  await withdraw.click();
  await a.page.waitForFunction(() => [...document.querySelectorAll("button")].some((x) => x.textContent === "Withdraw to wallet" && x.disabled), null, { timeout: TX_TIMEOUT });

  step("auditing every page after settlement");
  await audit("home (with room)", "/", null);
  await audit("room findings (settled)", roomPath, null);
  await audit("room release & evidence", `${roomPath}?tab=release`, a);
  await audit("room settlement (settled)", `${roomPath}?tab=settlement`, mod);
  await audit("finding thread (settled)", findingPath[2], a);
  await audit("researcher dashboard", "/dashboard", a);
  await audit("moderator dashboard", "/dashboard", mod);
  await audit("researcher profile", `/researchers/${a.address}`, null);
  await audit("package history", "/packages/npm/releasebond-demo-telemetry", null);
  await audit("fund a release", "/rooms/new", dev);
  await audit("admin", "/admin", mod);
  await audit("sign in (already signed in)", "/signin", a);
  await audit("admin (researcher refused)", "/admin", a);
  await audit("not found", "/rooms/999", null, { status: 404 });
} catch (e) {
  console.error(`tour step failed: ${e instanceof Error ? e.message.split("\n").slice(0, 6).join("\n") : e}`);
  const pages = browser.contexts().flatMap((c) => c.pages());
  for (const [i, p] of pages.entries()) await p.screenshot({ path: path.join(OUT, `failure-${i}.png`), fullPage: true }).catch(() => undefined);
  console.error(`failure screenshots in ${OUT}`);
  console.error(consoleErrors.slice(0, 20).join("\n"));
  await browser.close();
  process.exit(1);
}
await browser.close();

fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ audited, consoleErrors, overflow, contrast }, null, 2));
for (const [name, list] of [["console errors", consoleErrors], ["horizontal overflow", overflow], ["contrast violations", contrast]]) {
  if (list.length) console.log(`\n${name} (${list.length}):\n  ${[...new Set(list)].slice(0, 60).join("\n  ")}`);
}
console.log(`screenshots: ${OUT}`);
const summary = `flow complete; ${audited.length} pages x ${VARIANTS.length} variants; ${consoleErrors.length} console errors; ${overflow.length} overflow; ${contrast.length} contrast violations`;
if (consoleErrors.length || overflow.length || contrast.length) {
  console.log(`UI TOUR FAILED: ${summary}`);
  process.exit(1);
}
console.log(`UI TOUR PASSED: ${summary}`);
