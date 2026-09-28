import crypto from "node:crypto";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import tar from "tar-stream";
import { Decompress as ZstdDecompress } from "fzstd";
import type { ArtifactFile } from "./types";

export const MAX_ARTIFACT_BYTES = 150 * 1024 * 1024;
/** Bound on decompressed size: archives are untrusted (uploads), so no decompression bombs. */
export const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;
const MAX_TEXT_FILE = 1024 * 1024;
const MAX_TOTAL_TEXT = 40 * 1024 * 1024;
const MAX_ENTRIES = 50_000;

export const sha256Hex = (buf: Buffer | Uint8Array) => crypto.createHash("sha256").update(buf).digest("hex");

export function decompress(buf: Buffer): Buffer {
  // gzip
  if (buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf, { maxOutputLength: MAX_UNPACKED_BYTES });
  // zstd frame magic 28 B5 2F FD
  if (buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd) return zstdBounded(buf, MAX_UNPACKED_BYTES);
  // xz (older Arch packages) is not supported without a native binding.
  if (buf[0] === 0xfd && buf[1] === 0x37 && buf[2] === 0x7a) {
    throw new Error("xz-compressed packages are not supported yet (use a .zst or .tgz artifact)");
  }
  return buf; // assume plain tar
}

/** Streaming zstd decode that aborts as soon as output exceeds `max` bytes. */
export function zstdBounded(buf: Buffer, max: number): Buffer {
  const out: Uint8Array[] = [];
  let total = 0;
  const d = new ZstdDecompress((chunk) => {
    total += chunk.length;
    if (total > max) throw new Error(`archive expands beyond ${max} bytes`);
    out.push(chunk);
  });
  const STEP = 64 * 1024;
  for (let i = 0; i < buf.length; i += STEP) {
    d.push(new Uint8Array(buf.subarray(i, Math.min(buf.length, i + STEP))), i + STEP >= buf.length);
  }
  return Buffer.concat(out);
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * Reads every regular file of a (compressed) tarball into memory with
 * size limits. Paths are normalized and path traversal entries are dropped:
 * the archive is only ever inspected, never extracted to disk.
 */
export async function readTarball(
  compressed: Buffer,
  opts: { stripPrefix?: RegExp } = {},
): Promise<ArtifactFile[]> {
  const raw = decompress(compressed);
  const extract = tar.extract();
  const files: ArtifactFile[] = [];
  let totalText = 0;
  let entries = 0;

  await new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      entries++;
      if (entries > MAX_ENTRIES) {
        stream.resume();
        reject(new Error("archive has too many entries"));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (c: unknown) => chunks.push(c as Buffer));
      stream.on("end", () => {
        if (header.type === "file" || header.type === "contiguous-file") {
          let p = header.name.replace(/\\/g, "/").replace(/^\.\//, "");
          if (opts.stripPrefix) p = p.replace(opts.stripPrefix, "");
          const safe = p && !p.startsWith("/") && !p.split("/").includes("..");
          if (safe) {
            const buf = Buffer.concat(chunks);
            const binary = looksBinary(buf);
            const file: ArtifactFile = {
              path: p,
              size: buf.length,
              sha256: sha256Hex(buf),
              mode: header.mode ?? 0o644,
              binary,
            };
            if (!binary && buf.length <= MAX_TEXT_FILE && totalText + buf.length <= MAX_TOTAL_TEXT) {
              file.text = buf.toString("utf8");
              totalText += buf.length;
            }
            files.push(file);
          }
        }
        next();
      });
      stream.on("error", reject);
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
    Readable.from([raw]).pipe(extract);
  });

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export async function fetchBuffer(url: string, maxBytes = MAX_ARTIFACT_BYTES): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "ReleaseBond/0.1 (+evidence-engine)" } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > maxBytes) throw new Error(`artifact too large (${len} bytes)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`artifact too large (${buf.length} bytes)`);
  return buf;
}
