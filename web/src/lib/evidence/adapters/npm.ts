import crypto from "node:crypto";
import semver from "semver";
import { fetchBuffer, readTarball, sha256Hex } from "../archive";
import type { ReleaseArtifact } from "../types";

const REGISTRY = process.env.NPM_REGISTRY_URL || "https://registry.npmjs.org";
const LIFECYCLE = ["preinstall", "install", "postinstall", "prepare", "preuninstall", "uninstall", "postuninstall"];

const encodeName = (name: string) => (name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name));

export function validNpmName(name: string): boolean {
  return /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name) && name.length <= 214;
}

interface Packument {
  versions: Record<string, { dist: { tarball: string; integrity?: string; shasum?: string } }>;
  "dist-tags"?: Record<string, string>;
}

async function packument(name: string): Promise<Packument> {
  const res = await fetch(`${REGISTRY}/${encodeName(name)}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (res.status === 404) throw new Error(`npm package ${name} not found`);
  if (!res.ok) throw new Error(`npm registry returned ${res.status}`);
  return (await res.json()) as Packument;
}

/** Highest published version lower than `version` (the release being replaced). */
export function previousVersionOf(versions: string[], version: string): string | null {
  const lower = versions.filter((v) => semver.valid(v) && semver.lt(v, version) && !semver.prerelease(v));
  return lower.length ? semver.rsort(lower)[0] : null;
}

function verifyIntegrity(buf: Buffer, integrity?: string, shasum?: string): { value: string; verified: boolean } | null {
  if (integrity) {
    const [algo, b64] = integrity.split("-", 2);
    const actual = crypto.createHash(algo).update(buf).digest("base64");
    return { value: integrity, verified: actual === b64 };
  }
  if (shasum) return { value: `sha1-${shasum}`, verified: crypto.createHash("sha1").update(buf).digest("hex") === shasum };
  return null;
}

export async function artifactFromNpmTarball(
  buf: Buffer,
  opts: { sourceUrl: string | null; sourceKind: "registry" | "upload"; integrity?: { value: string; verified: boolean } | null; previousVersion?: string | null },
): Promise<ReleaseArtifact> {
  // npm tarballs normally root everything at "package/" (some use another single dir).
  const files = await readTarball(buf, { stripPrefix: /^[^/]+\// });
  const pkgFile = files.find((f) => f.path === "package.json");
  if (!pkgFile?.text) throw new Error("tarball has no package.json");
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(pkgFile.text);
  } catch {
    throw new Error("package.json is not valid JSON");
  }
  const name = String(pkg.name ?? "");
  const version = String(pkg.version ?? "");
  if (!validNpmName(name) || !semver.valid(version)) throw new Error("package.json has an invalid name or version");
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  const installScripts: Record<string, string> = {};
  for (const k of LIFECYCLE) if (typeof scripts[k] === "string") installScripts[k] = scripts[k];
  // npm runs `node-gyp rebuild` implicitly when binding.gyp exists and no install script is set.
  if (!installScripts.install && !installScripts.preinstall && files.some((f) => f.path === "binding.gyp")) {
    installScripts.install = "node-gyp rebuild (implicit: binding.gyp present)";
  }
  const sha = sha256Hex(buf);
  return {
    ecosystem: "npm",
    name,
    version,
    artifactHash: `sha256:${sha}`,
    sha256: sha,
    size: buf.length,
    sourceUrl: opts.sourceUrl,
    sourceKind: opts.sourceKind,
    registryIntegrity: opts.integrity ?? null,
    dependencies: {
      ...((pkg.dependencies as Record<string, string>) ?? {}),
      ...Object.fromEntries(Object.entries((pkg.optionalDependencies as Record<string, string>) ?? {}).map(([k, v]) => [k, v])),
    },
    installScripts,
    metadata: {
      description: pkg.description ?? null,
      license: pkg.license ?? null,
      main: pkg.main ?? null,
      bin: pkg.bin ?? null,
      repository: pkg.repository ?? null,
      author: pkg.author ?? null,
      maintainersNote: "from package.json inside the tarball",
    },
    previousVersion: opts.previousVersion ?? null,
    files,
  };
}

export async function fetchNpmRelease(
  name: string,
  version: string,
): Promise<{ buffer: Buffer; artifact: ReleaseArtifact; previous: { version: string; tarball: string; integrity?: string; shasum?: string } | null }> {
  if (!validNpmName(name)) throw new Error("invalid npm package name");
  if (!semver.valid(version)) throw new Error("version must be an exact semver version");
  const doc = await packument(name);
  const entry = doc.versions[version];
  if (!entry) throw new Error(`${name}@${version} is not published`);
  const buffer = await fetchBuffer(entry.dist.tarball);
  const integrity = verifyIntegrity(buffer, entry.dist.integrity, entry.dist.shasum);
  if (integrity && !integrity.verified) throw new Error("downloaded tarball does not match the registry integrity hash");
  const prevVersion = previousVersionOf(Object.keys(doc.versions), version);
  const artifact = await artifactFromNpmTarball(buffer, {
    sourceUrl: entry.dist.tarball,
    sourceKind: "registry",
    integrity,
    previousVersion: prevVersion,
  });
  if (artifact.name !== name || artifact.version !== version) {
    throw new Error("tarball package.json does not match the requested name/version");
  }
  const prev = prevVersion ? { version: prevVersion, ...doc.versions[prevVersion].dist } : null;
  return { buffer, artifact, previous: prev };
}

export async function fetchNpmTarballBuffer(tarball: string, integrity?: string, shasum?: string): Promise<Buffer> {
  const buf = await fetchBuffer(tarball);
  const check = verifyIntegrity(buf, integrity, shasum);
  if (check && !check.verified) throw new Error("previous tarball failed integrity verification");
  return buf;
}
