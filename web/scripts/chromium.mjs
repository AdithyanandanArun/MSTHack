// Locates a Chromium for the browser tours: CHROME_PATH, a cached Playwright Chromium, or a system one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  const dirs = fs.existsSync(cache)
    ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
    : [];
  for (const d of dirs) {
    for (const rel of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-win/chrome.exe"]) {
      const p = path.join(cache, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("no Chromium found: set CHROME_PATH or run `npx playwright install chromium`");
}
