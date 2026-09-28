import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { artifactFromNpmTarball } from "@/lib/evidence/adapters/npm";
import { installFunctions, vercmp } from "@/lib/evidence/adapters/pacman";
import { correlateFile } from "@/lib/evidence/correlate";
import { diffReleases } from "@/lib/evidence/diff";
import { observationsIn, staticScan } from "@/lib/evidence/rules";

const ART = path.resolve(__dirname, "../../demo/artifacts");
const load = (f: string) => artifactFromNpmTarball(fs.readFileSync(path.join(ART, f)), { sourceUrl: null, sourceKind: "upload" });

describe("npm adapter + static rules", () => {
  it("normalizes the demo tarball into a ReleaseArtifact", async () => {
    const a = await load("releasebond-demo-telemetry-2.0.0.tgz");
    expect(a.name).toBe("releasebond-demo-telemetry");
    expect(a.version).toBe("2.0.0");
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.installScripts.postinstall).toBe("node scripts/telemetry.js");
    expect(a.files.map((f) => f.path)).toContain("scripts/telemetry.js");
  });

  it("flags the compromised release (positive control)", async () => {
    const facts = staticScan(await load("releasebond-demo-telemetry-2.0.0.tgz"));
    const obs = observationsIn(facts);
    for (const o of ["INSTALL_SCRIPT", "FS_SENSITIVE_READ", "NETWORK_EGRESS", "ENV_SECRET_READ"] as const) expect(obs.has(o)).toBe(true);
    const ssh = facts.find((f) => f.rule === "js.sensitive-path");
    expect(ssh?.file).toBe("scripts/telemetry.js");
    expect(ssh?.line).toBeGreaterThan(0);
    expect(facts.some((f) => f.rule === "js.hardcoded-endpoint" && f.detail.includes("203.0.113.10"))).toBe(true);
  });

  it("stays silent on the benign control package (negative control)", async () => {
    const facts = staticScan(await load("releasebond-benign-utils-1.0.0.tgz"));
    expect(facts.filter((f) => f.severity !== "info")).toEqual([]);
    expect(observationsIn(facts).size).toBe(0);
  });

  it("diffs a release against its predecessor", async () => {
    const prev = await load("releasebond-demo-telemetry-1.0.0.tgz");
    const next = await load("releasebond-demo-telemetry-2.0.0.tgz");
    const d = diffReleases(prev, next);
    expect(d.added).toContain("scripts/telemetry.js");
    expect(d.changed).toContain("package.json");
    expect(d.installScriptsChanged).toEqual(["postinstall"]);
    expect(d.linesAdded).toBeGreaterThan(10);
  });

  it("T_CORRELATE traces the key read into the outbound request", async () => {
    const a = await load("releasebond-demo-telemetry-2.0.0.tgz");
    const r = correlateFile(a.files.find((f) => f.path === "scripts/telemetry.js")!);
    expect(r.flows.length).toBeGreaterThan(0);
    expect(r.flows.some((f) => f.source.variable === "key")).toBe(true);
  });

  it("T_CORRELATE finds no flow in the clean release", async () => {
    const a = await load("releasebond-demo-telemetry-1.0.0.tgz");
    expect(correlateFile(a.files.find((f) => f.path === "index.js")!).flows).toEqual([]);
  });
});

describe("pacman helpers", () => {
  it("orders versions like vercmp", () => {
    expect(vercmp("2.25-1", "2.23-1")).toBeGreaterThan(0);
    expect(vercmp("1:1.0-1", "2.0-1")).toBeGreaterThan(0);
    expect(vercmp("1.0.10-1", "1.0.9-1")).toBeGreaterThan(0);
    expect(vercmp("1.0-2", "1.0-2")).toBe(0);
  });

  it("extracts install hook bodies", () => {
    const hooks = installFunctions("post_install() {\n  systemctl enable foo\n}\n\npost_upgrade() {\n  post_install\n}\n");
    expect(Object.keys(hooks)).toEqual(["post_install", "post_upgrade"]);
    expect(hooks.post_install).toContain("systemctl enable");
  });
});
