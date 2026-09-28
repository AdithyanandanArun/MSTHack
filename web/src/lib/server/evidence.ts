import "server-only";
import fs from "node:fs";
import { canonicalJson, type Observation } from "@/lib/canonical";
import { runAgent } from "@/lib/evidence/agent";
import { sha256Hex } from "@/lib/evidence/archive";
import { artifactFromNpmTarball, fetchNpmRelease, fetchNpmTarballBuffer } from "@/lib/evidence/adapters/npm";
import { artifactFromPacmanPackage, fetchPacmanRelease } from "@/lib/evidence/adapters/pacman";
import { checkClaims, outcomeOf } from "@/lib/evidence/claims";
import { diffReleases } from "@/lib/evidence/diff";
import { staticScan } from "@/lib/evidence/rules";
import { runNpmSandbox, ensureImage, sandboxAvailable } from "@/lib/evidence/sandbox";
import type { ArtifactSummary, DiffSummary, DynamicRun, Ecosystem, EvidenceReport, Fact, ReleaseArtifact } from "@/lib/evidence/types";
import { fetchBuffer } from "@/lib/evidence/archive";
import { dataPath, db, nowSec } from "./db";

export interface ArtifactRow {
  sha256: string;
  ecosystem: Ecosystem;
  name: string;
  version: string;
  source_url: string | null;
  source_kind: string;
  size: number;
  storage_path: string;
  metadata_json: string;
  previous_sha256: string | null;
  diff_json: string | null;
  scan_json: string | null;
  created_at: number;
}

const DYNAMIC_RUNS = Number(process.env.RELEASEBOND_DYNAMIC_RUNS || 3);

function summarize(a: ReleaseArtifact): ArtifactSummary {
  return {
    ...a,
    fileCount: a.files.length,
    files: a.files.slice(0, 2000).map((f) => ({ path: f.path, size: f.size, sha256: f.sha256, mode: f.mode, binary: f.binary })),
  };
}

function storeArtifact(a: ReleaseArtifact, buffer: Buffer, previousSha: string | null, diff: DiffSummary | null): void {
  const ext = a.ecosystem === "npm" ? "tgz" : "pkg.tar";
  const p = dataPath("artifacts", `${a.sha256}.${ext}`);
  if (!fs.existsSync(p)) fs.writeFileSync(p, buffer);
  const scan = staticScan(a);
  db()
    .prepare(
      `INSERT INTO artifacts(sha256, ecosystem, name, version, source_url, source_kind, size, storage_path, metadata_json,
         previous_sha256, diff_json, scan_json, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sha256) DO UPDATE SET
         previous_sha256 = COALESCE(excluded.previous_sha256, artifacts.previous_sha256),
         diff_json = COALESCE(excluded.diff_json, artifacts.diff_json)`,
    )
    .run(
      a.sha256,
      a.ecosystem,
      a.name,
      a.version,
      a.sourceUrl,
      a.sourceKind,
      a.size,
      p,
      JSON.stringify(summarize(a)),
      previousSha,
      diff ? JSON.stringify(diff) : null,
      JSON.stringify(scan),
      nowSec(),
    );
}

export function getArtifact(sha256: string): ArtifactRow | null {
  return (db().prepare("SELECT * FROM artifacts WHERE sha256 = ?").get(sha256.replace(/^0x/, "").toLowerCase()) as ArtifactRow) ?? null;
}

/** Re-reads the stored bytes and re-verifies the hash before any analysis. */
export async function loadArtifact(sha256: string): Promise<{ artifact: ReleaseArtifact; buffer: Buffer; row: ArtifactRow }> {
  const row = getArtifact(sha256);
  if (!row) throw new Error("artifact not registered with ReleaseBond");
  const buffer = fs.readFileSync(row.storage_path);
  const actual = sha256Hex(buffer);
  if (actual !== row.sha256) throw new Error(`stored artifact hash mismatch (${actual})`);
  const meta = JSON.parse(row.metadata_json) as ArtifactSummary;
  const opts = { sourceUrl: row.source_url, sourceKind: row.source_kind as "registry" | "upload", integrity: meta.registryIntegrity, previousVersion: meta.previousVersion };
  const artifact = row.ecosystem === "npm" ? await artifactFromNpmTarball(buffer, opts) : await artifactFromPacmanPackage(buffer, opts);
  return { artifact, buffer, row };
}

async function withPrevious(
  artifact: ReleaseArtifact,
  buffer: Buffer,
  previous: { artifact: ReleaseArtifact; buffer: Buffer } | null,
): Promise<ArtifactRow> {
  let diff: DiffSummary | null = null;
  if (previous) {
    storeArtifact(previous.artifact, previous.buffer, null, null);
    diff = diffReleases(previous.artifact, artifact);
  }
  storeArtifact(artifact, buffer, previous?.artifact.sha256 ?? null, diff);
  return getArtifact(artifact.sha256)!;
}

/** Fetches an exact release from its registry, verifies it, and indexes it with its predecessor. */
export async function ingestRegistryRelease(ecosystem: Ecosystem, name: string, version: string): Promise<ArtifactRow> {
  if (ecosystem === "npm") {
    const { buffer, artifact, previous } = await fetchNpmRelease(name, version);
    let prev: { artifact: ReleaseArtifact; buffer: Buffer } | null = null;
    if (previous) {
      try {
        const pbuf = await fetchNpmTarballBuffer(previous.tarball, previous.integrity, previous.shasum);
        prev = { buffer: pbuf, artifact: await artifactFromNpmTarball(pbuf, { sourceUrl: previous.tarball, sourceKind: "registry" }) };
      } catch {
        prev = null;
      }
    }
    return withPrevious(artifact, buffer, prev);
  }
  const { buffer, artifact, previous } = await fetchPacmanRelease(name, version || undefined);
  let prev: { artifact: ReleaseArtifact; buffer: Buffer } | null = null;
  if (previous) {
    try {
      const pbuf = await fetchBuffer(previous.url);
      prev = { buffer: pbuf, artifact: await artifactFromPacmanPackage(pbuf, { sourceUrl: previous.url, sourceKind: "registry" }) };
    } catch {
      prev = null;
    }
  }
  return withPrevious(artifact, buffer, prev);
}

/** Indexes an uploaded artifact (e.g. a release candidate or the demo fixture). */
export async function ingestUpload(ecosystem: Ecosystem, buffer: Buffer, previousBuffer: Buffer | null): Promise<ArtifactRow> {
  const parse = (b: Buffer, previousVersion?: string | null) =>
    ecosystem === "npm"
      ? artifactFromNpmTarball(b, { sourceUrl: null, sourceKind: "upload", previousVersion })
      : artifactFromPacmanPackage(b, { sourceUrl: null, sourceKind: "upload", previousVersion });
  const prevArtifact = previousBuffer ? await parse(previousBuffer) : null;
  const artifact = await parse(buffer, prevArtifact?.version ?? null);
  if (prevArtifact && prevArtifact.name !== artifact.name) throw new Error("previous artifact is a different package");
  return withPrevious(artifact, buffer, prevArtifact && previousBuffer ? { artifact: prevArtifact, buffer: previousBuffer } : null);
}

async function dynamicRuns(artifact: ReleaseArtifact, buffer: Buffer, count: number): Promise<{ enabled: boolean; reason?: string; runs: DynamicRun[] }> {
  if (artifact.ecosystem !== "npm") {
    return { enabled: false, reason: "dynamic execution is implemented for npm; pacman releases get static analysis only", runs: [] };
  }
  const avail = await sandboxAvailable();
  if (!avail.ok) return { enabled: false, reason: avail.reason, runs: [] };
  await ensureImage();
  const runs: DynamicRun[] = [];
  for (let i = 1; i <= count; i++) runs.push(await runNpmSandbox(buffer, i)); // fresh container each time
  return { enabled: true, runs };
}

export async function buildReport(opts: {
  sha256: string;
  claims: Observation[];
  finding?: { title: string; claimedSeverity: string; description: string; proofOfConcept: string; reproduction: string; observations: Observation[] };
  dynamicCount?: number;
}): Promise<EvidenceReport> {
  const { artifact, buffer, row } = await loadArtifact(opts.sha256);
  let previous: ReleaseArtifact | null = null;
  if (row.previous_sha256) {
    try {
      previous = (await loadArtifact(row.previous_sha256)).artifact;
    } catch {
      previous = null;
    }
  }
  const staticFacts = staticScan(artifact);
  const dynamic = await dynamicRuns(artifact, buffer, opts.dynamicCount ?? DYNAMIC_RUNS);
  const allFacts: Fact[] = [...staticFacts, ...dynamic.runs.flatMap((r) => r.facts)];
  const claims = checkClaims(opts.claims, staticFacts, dynamic.runs);
  let extraRun = dynamic.runs.length;
  const agent = await runAgent({
    artifact,
    previous,
    facts: allFacts,
    claims,
    finding: opts.finding,
    runDynamic: dynamic.enabled
      ? async () => {
          extraRun++;
          const r = await runNpmSandbox(buffer, extraRun);
          dynamic.runs.push(r);
          return r.facts;
        }
      : undefined,
  });
  const anyDynamicConfirmed = claims.some((c) => c.result === "confirmed" && c.basis === "dynamic");
  const suspicious = allFacts.some((f) => f.severity === "high") || agent.hypotheses.some((h) => h.status === "supported");
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    artifact: { ecosystem: artifact.ecosystem, name: artifact.name, version: artifact.version, sha256: artifact.sha256, verified: true },
    environment: dynamic.enabled ? `ReleaseBond npm sandbox (docker, no network, strace) x${dynamic.runs.length}` : `static analysis only (${dynamic.reason})`,
    staticFacts,
    dynamic,
    claims,
    outcome: opts.finding ? outcomeOf(claims) : null,
    confidence: anyDynamicConfirmed ? "REPRODUCED_EVIDENCE" : suspicious ? "SUSPICIOUS" : "NONE",
    agent,
  };
}

export function reportHash(report: EvidenceReport): string {
  return sha256Hex(Buffer.from(canonicalJson(report)));
}

/** Runs the pipeline for a finding and stores the run. */
export async function runEvidence(opts: {
  roomId: number;
  sha256: string;
  findingId: number | null;
  requestedBy: string;
  claims: Observation[];
  finding?: Parameters<typeof buildReport>[0]["finding"];
}): Promise<{ id: number; report: EvidenceReport | null; error?: string }> {
  const d = db();
  const id = Number(
    d
      .prepare("INSERT INTO evidence_runs(room_id, finding_id, requested_by, status, created_at) VALUES(?, ?, ?, 'running', ?)")
      .run(opts.roomId, opts.findingId, opts.requestedBy, nowSec()).lastInsertRowid,
  );
  try {
    const report = await buildReport({ sha256: opts.sha256, claims: opts.claims, finding: opts.finding });
    d.prepare("UPDATE evidence_runs SET status = 'done', outcome = ?, report_json = ?, report_hash = ?, finished_at = ? WHERE id = ?").run(
      report.outcome,
      JSON.stringify(report),
      reportHash(report),
      nowSec(),
      id,
    );
    return { id, report };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    d.prepare("UPDATE evidence_runs SET status = 'error', error = ?, finished_at = ? WHERE id = ?").run(msg, nowSec(), id);
    return { id, report: null, error: msg };
  }
}
