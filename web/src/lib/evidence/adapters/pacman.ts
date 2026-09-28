import zlib from "node:zlib";
import tar from "tar-stream";
import { Readable } from "node:stream";
import { decompress, fetchBuffer, fetchFirst, readTarball, sha256Hex } from "../archive";
import type { ArtifactFile, ReleaseArtifact } from "../types";

const ARCHIVE = process.env.ARCH_ARCHIVE_URL || "https://archive.archlinux.org/packages";
const MIRROR = process.env.ARCH_MIRROR_URL || "https://geo.mirror.pkgbuild.com";
const SEARCH = "https://archlinux.org/packages/search/json/";
const ARCH = "x86_64";

export function validPacmanName(name: string): boolean {
  return /^[a-z0-9@._+][a-z0-9@._+-]*$/.test(name) && name.length <= 128;
}
export function validPacmanVersion(v: string): boolean {
  // [epoch:]pkgver-pkgrel
  return /^(\d+:)?[A-Za-z0-9._+~]+-\d+(\.\d+)?$/.test(v);
}

interface SearchResult {
  pkgname: string;
  repo: string;
  arch: string;
  pkgver: string;
  pkgrel: string;
  epoch: number;
  filename: string;
}

async function search(name: string): Promise<SearchResult | null> {
  const res = await fetch(`${SEARCH}?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`archlinux.org search returned ${res.status}`);
  const j = (await res.json()) as { results: SearchResult[] };
  return j.results.find((r) => r.pkgname === name && (r.arch === ARCH || r.arch === "any")) ?? null;
}

const fullVersion = (r: SearchResult) => `${r.epoch ? `${r.epoch}:` : ""}${r.pkgver}-${r.pkgrel}`;

/** Simplified pacman vercmp: compares alphanumeric segments; enough to order archive listings. */
export function vercmp(a: string, b: string): number {
  const split = (v: string) => {
    const [epoch, rest] = v.includes(":") ? [Number(v.split(":")[0]), v.split(":").slice(1).join(":")] : [0, v];
    return { epoch, parts: rest.split(/[^A-Za-z0-9]+/).flatMap((p) => p.match(/\d+|[A-Za-z]+/g) ?? []) };
  };
  const A = split(a);
  const B = split(b);
  if (A.epoch !== B.epoch) return A.epoch - B.epoch;
  for (let i = 0; i < Math.max(A.parts.length, B.parts.length); i++) {
    const x = A.parts[i];
    const y = B.parts[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else if (nx !== ny) {
      return nx ? 1 : -1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

async function archivedVersions(name: string): Promise<{ version: string; file: string }[]> {
  const res = await fetch(`${ARCHIVE}/${name[0]}/${name}/`);
  if (!res.ok) return [];
  const html = await res.text();
  const re = new RegExp(`href="(${name.replace(/[.+]/g, "\\$&")}-([^"]+)-(${ARCH}|any)\\.pkg\\.tar\\.(zst|xz))"`, "g");
  const out: { version: string; file: string }[] = [];
  for (const m of html.matchAll(re)) out.push({ version: decodeURIComponent(m[2]), file: m[1] });
  return out;
}

const repoDbCache = new Map<string, { at: number; sums: Map<string, string> }>();

/** Reads %FILENAME% -> %SHA256SUM% from the official repo database. */
async function repoChecksums(repo: string): Promise<Map<string, string>> {
  const hit = repoDbCache.get(repo);
  if (hit && Date.now() - hit.at < 3600_000) return hit.sums;
  const buf = await fetchBuffer(`${MIRROR}/${repo}/os/${ARCH}/${repo}.db`, 64 * 1024 * 1024);
  const raw = buf[0] === 0x1f ? zlib.gunzipSync(buf) : decompress(buf);
  const sums = new Map<string, string>();
  const extract = tar.extract();
  await new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: unknown) => chunks.push(c as Buffer));
      stream.on("end", () => {
        if (header.name.endsWith("/desc")) {
          const text = Buffer.concat(chunks).toString("utf8");
          const fn = text.match(/%FILENAME%\n([^\n]+)/)?.[1];
          const sum = text.match(/%SHA256SUM%\n([0-9a-f]{64})/)?.[1];
          if (fn && sum) sums.set(fn, sum);
        }
        next();
      });
      stream.on("error", reject);
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
    Readable.from([raw]).pipe(extract);
  });
  repoDbCache.set(repo, { at: Date.now(), sums });
  return sums;
}

function parseKeyValues(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^(\w+)\s*=\s*(.*)$/);
    if (m) (out[m[1]] ??= []).push(m[2]);
  }
  return out;
}

/** Extracts the bodies of pacman install hook functions from a .INSTALL script. */
export function installFunctions(script: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /^\s*(pre_install|post_install|pre_upgrade|post_upgrade|pre_remove|post_remove)\s*\(\)\s*\{([\s\S]*?)^\s*\}/gm;
  for (const m of script.matchAll(re)) out[m[1]] = m[2].trim();
  return out;
}

export async function artifactFromPacmanPackage(
  buf: Buffer,
  opts: { sourceUrl: string | null; sourceKind: "registry" | "upload"; integrity?: { value: string; verified: boolean } | null; previousVersion?: string | null },
): Promise<ReleaseArtifact> {
  const files: ArtifactFile[] = await readTarball(buf);
  const pkginfo = files.find((f) => f.path === ".PKGINFO")?.text;
  if (!pkginfo) throw new Error("not a pacman package: missing .PKGINFO");
  const kv = parseKeyValues(pkginfo);
  const name = kv.pkgname?.[0];
  const version = kv.pkgver?.[0];
  if (!name || !version) throw new Error(".PKGINFO lacks pkgname/pkgver");
  const install = files.find((f) => f.path === ".INSTALL")?.text;
  const installScripts = install ? installFunctions(install) : {};
  if (install && Object.keys(installScripts).length === 0) installScripts[".INSTALL"] = install;
  const dependencies: Record<string, string> = {};
  for (const dep of kv.depend ?? []) {
    const m = dep.match(/^([^<>=]+)(.*)$/);
    if (m) dependencies[m[1]] = m[2] || "*";
  }
  const sha = sha256Hex(buf);
  return {
    ecosystem: "pacman",
    name,
    version,
    artifactHash: `sha256:${sha}`,
    sha256: sha,
    size: buf.length,
    sourceUrl: opts.sourceUrl,
    sourceKind: opts.sourceKind,
    registryIntegrity: opts.integrity ?? null,
    dependencies,
    installScripts,
    metadata: {
      description: kv.pkgdesc?.[0] ?? null,
      url: kv.url?.[0] ?? null,
      arch: kv.arch?.[0] ?? null,
      packager: kv.packager?.[0] ?? null,
      builddate: kv.builddate?.[0] ? Number(kv.builddate[0]) : null,
      license: kv.license ?? [],
      backup: kv.backup ?? [],
    },
    previousVersion: opts.previousVersion ?? null,
    files,
  };
}

export async function fetchPacmanRelease(
  name: string,
  version?: string,
): Promise<{ buffer: Buffer; artifact: ReleaseArtifact; previous: { version: string; url: string } | null }> {
  if (!validPacmanName(name)) throw new Error("invalid pacman package name");
  if (version && !validPacmanVersion(version)) throw new Error("version must look like pkgver-pkgrel, e.g. 2.25-1");
  const current = await search(name);
  const archived = await archivedVersions(name);
  const target = version ?? (current ? fullVersion(current) : archived.map((a) => a.version).sort(vercmp).pop());
  if (!target) throw new Error(`pacman package ${name} not found`);

  const candidates: string[] = [];
  let integrity: { value: string; verified: boolean } | null = null;
  const isCurrent = current && fullVersion(current) === target;
  if (isCurrent) {
    candidates.push(`${MIRROR}/${current.repo}/os/${ARCH}/${current.filename}`);
    // The archive also carries the current build; it is the fallback when the mirror flakes.
    candidates.push(`${ARCHIVE}/${name[0]}/${name}/${current.filename}`);
  } else {
    const hit = archived.find((a) => a.version === target);
    if (!hit) throw new Error(`${name} ${target} not found in the Arch archive`);
    candidates.push(`${ARCHIVE}/${name[0]}/${name}/${hit.file}`);
  }
  const { url, buffer } = await fetchFirst(candidates);
  if (isCurrent) {
    try {
      const sums = await repoChecksums(current.repo);
      const expected = sums.get(current.filename);
      if (expected) {
        integrity = { value: `sha256-${expected}`, verified: expected === sha256Hex(buffer) };
        if (!integrity.verified) throw new Error("downloaded package does not match the repo database checksum");
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("does not match")) throw e;
      integrity = null; // repo db unreachable: hash is still recorded, just not cross-checked
    }
  }

  const older = archived.filter((a) => vercmp(a.version, target) < 0).sort((a, b) => vercmp(a.version, b.version));
  const prev = older.length ? older[older.length - 1] : null;
  const artifact = await artifactFromPacmanPackage(buffer, {
    sourceUrl: url,
    sourceKind: "registry",
    integrity,
    previousVersion: prev?.version ?? null,
  });
  if (artifact.name !== name) throw new Error("package .PKGINFO does not match the requested name");
  return {
    buffer,
    artifact,
    previous: prev ? { version: prev.version, url: `${ARCHIVE}/${name[0]}/${name}/${prev.file}` } : null,
  };
}
