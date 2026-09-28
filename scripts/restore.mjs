import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromWeb = createRequire(path.join(repoRoot, "web", "package.json"));
const Database = requireFromWeb("better-sqlite3");

function usage() {
  return "Usage: node scripts/restore.mjs <backupDir> --data <targetDir> [--force]";
}

function parseArgs(argv) {
  let backup;
  let data;
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--force") {
      if (force) throw new Error(`duplicate argument: --force\n${usage()}`);
      force = true;
    } else if (arg === "--data") {
      if (data) throw new Error(`duplicate argument: --data\n${usage()}`);
      data = argv[i + 1];
      if (!data || data.startsWith("--")) throw new Error(`--data requires a directory\n${usage()}`);
      i += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}\n${usage()}`);
    } else if (backup) {
      throw new Error(`unexpected argument: ${arg}\n${usage()}`);
    } else {
      backup = arg;
    }
  }
  if (!backup || !data) throw new Error(usage());
  return { backupDir: path.resolve(backup), targetDir: path.resolve(data), force };
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = fs.createReadStream(file);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function listFiles(root, relative = "") {
  const result = [];
  const directory = path.join(root, relative);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(root, child));
    else if (entry.isFile()) result.push(child.split(path.sep).join("/"));
    else throw new Error(`backup contains a non-regular file: ${child}`);
  }
  return result;
}

function safeManifestPath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || relativePath.includes("\\")) return false;
  if (path.posix.isAbsolute(relativePath) || path.posix.normalize(relativePath) !== relativePath) return false;
  return !relativePath.split("/").includes("..");
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function validateManifest(manifest) {
  if (!manifest || manifest.formatVersion !== 1) throw new Error("unsupported or missing manifest formatVersion");
  if (typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error("manifest createdAt is invalid");
  }
  if (typeof manifest.sourceDataDir !== "string" || !path.isAbsolute(manifest.sourceDataDir)) {
    throw new Error("manifest sourceDataDir must be an absolute path");
  }
  if (!Array.isArray(manifest.files)) throw new Error("manifest files must be an array");
  if (!manifest.rowCounts || typeof manifest.rowCounts !== "object" || Array.isArray(manifest.rowCounts)) {
    throw new Error("manifest rowCounts must be an object");
  }

  const seen = new Set();
  for (const file of manifest.files) {
    if (!file || !safeManifestPath(file.path) || file.path === "manifest.json") {
      throw new Error(`invalid manifest file path: ${file?.path ?? "<missing>"}`);
    }
    if (seen.has(file.path)) throw new Error(`duplicate manifest file path: ${file.path}`);
    seen.add(file.path);
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error(`invalid size for ${file.path}`);
    if (typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)) {
      throw new Error(`invalid sha256 for ${file.path}`);
    }
  }
  // session.secret is optional: deployments may keep SESSION_SECRET in the environment instead.
  for (const required of ["releasebond.sqlite"]) {
    if (!seen.has(required)) throw new Error(`manifest is missing required file: ${required}`);
  }
  for (const [table, count] of Object.entries(manifest.rowCounts)) {
    if (!table || !Number.isSafeInteger(count) || count < 0) throw new Error(`invalid row count for table ${table}`);
  }
}

async function verifyBackup(backupDir) {
  const manifestFile = path.join(backupDir, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  } catch (error) {
    throw new Error(`cannot read manifest.json: ${error.message}`);
  }
  validateManifest(manifest);

  const actual = listFiles(backupDir).sort();
  const expected = ["manifest.json", ...manifest.files.map((file) => file.path)].sort();
  const missing = expected.filter((file) => !actual.includes(file));
  const extra = actual.filter((file) => !expected.includes(file));
  if (missing.length || extra.length) {
    const details = [missing.length ? `missing: ${missing.join(", ")}` : "", extra.length ? `extra: ${extra.join(", ")}` : ""]
      .filter(Boolean)
      .join("; ");
    throw new Error(`backup file inventory mismatch (${details})`);
  }

  for (const entry of manifest.files) {
    const file = path.join(backupDir, ...entry.path.split("/"));
    const stat = fs.statSync(file);
    if (stat.size !== entry.size) throw new Error(`size mismatch for ${entry.path}: expected ${entry.size}, got ${stat.size}`);
    const digest = await sha256File(file);
    if (digest !== entry.sha256) throw new Error(`sha256 mismatch for ${entry.path}: expected ${entry.sha256}, got ${digest}`);
  }
  return manifest;
}

function copyPayload(backupDir, stageDir, manifest) {
  fs.mkdirSync(stageDir, { recursive: true });
  fs.mkdirSync(path.join(stageDir, "artifacts"), { recursive: true });
  fs.mkdirSync(path.join(stageDir, "uploads"), { recursive: true });
  for (const entry of manifest.files) {
    const source = path.join(backupDir, ...entry.path.split("/"));
    const destination = path.join(stageDir, ...entry.path.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

function quoteIdentifier(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

function verifyRowCounts(db, expected) {
  const actualTables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(({ name }) => name);
  const expectedTables = Object.keys(expected).sort();
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) throw new Error("database table inventory does not match manifest");
  for (const table of expectedTables) {
    const actual = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count;
    if (actual !== expected[table]) throw new Error(`row count mismatch for table ${table}: expected ${expected[table]}, got ${actual}`);
  }
}

function rewriteStoredPaths(stageDir, targetDir, manifest) {
  const databaseFile = path.join(stageDir, "releasebond.sqlite");
  const db = new Database(databaseFile, { fileMustExist: true });
  try {
    verifyRowCounts(db, manifest.rowCounts);
    const sourceDir = path.resolve(manifest.sourceDataDir);
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map(({ name }) => name),
    );

    const specs = [
      { table: "attachments", key: "id", required: false },
      { table: "artifacts", key: "sha256", required: false },
    ];
    db.transaction(() => {
      for (const spec of specs) {
        if (!tables.has(spec.table)) {
          if (spec.required) throw new Error(`snapshot has no ${spec.table} table`);
          continue;
        }
        const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(spec.table)})`).all().map(({ name }) => name);
        if (!columns.includes(spec.key) || !columns.includes("storage_path")) {
          throw new Error(`snapshot has no usable ${spec.table} storage path`);
        }
        const rows = db
          .prepare(`SELECT ${quoteIdentifier(spec.key)} AS key, storage_path FROM ${quoteIdentifier(spec.table)}`)
          .all();
        const update = db.prepare(
          `UPDATE ${quoteIdentifier(spec.table)} SET storage_path = ? WHERE ${quoteIdentifier(spec.key)} = ?`,
        );
        for (const row of rows) {
          if (typeof row.storage_path !== "string" || !path.isAbsolute(row.storage_path)) continue;
          const relative = path.relative(sourceDir, path.resolve(row.storage_path));
          const inside =
            relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
          if (inside) update.run(path.join(targetDir, relative), row.key);
        }
      }
    })();
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

function inspectTarget(targetDir, force) {
  if (!fs.existsSync(targetDir)) return false;
  const stat = fs.lstatSync(targetDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`target is not a real directory: ${targetDir}`);
  const entries = fs.readdirSync(targetDir);
  if (entries.length > 0 && !force) throw new Error(`target directory is not empty (use --force to replace it): ${targetDir}`);
  return true;
}

async function verifyStagedPayload(stageDir, manifest) {
  for (const entry of manifest.files) {
    if (entry.path === "releasebond.sqlite") continue;
    const file = path.join(stageDir, ...entry.path.split("/"));
    const stat = fs.statSync(file);
    const digest = await sha256File(file);
    if (stat.size !== entry.size || digest !== entry.sha256) throw new Error(`staged copy verification failed for ${entry.path}`);
  }
}

function installStage(stageDir, targetDir, targetExists) {
  if (!targetExists) {
    fs.renameSync(stageDir, targetDir);
    return;
  }

  const parent = path.dirname(targetDir);
  const rollbackContainer = fs.mkdtempSync(path.join(parent, `.${path.basename(targetDir)}.previous-`));
  const previous = path.join(rollbackContainer, "data");
  fs.renameSync(targetDir, previous);
  try {
    fs.renameSync(stageDir, targetDir);
  } catch (error) {
    fs.renameSync(previous, targetDir);
    fs.rmSync(rollbackContainer, { recursive: true, force: true });
    throw error;
  }
  fs.rmSync(rollbackContainer, { recursive: true, force: true });
}

async function main() {
  const { backupDir, targetDir, force } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(backupDir) || !fs.statSync(backupDir).isDirectory()) throw new Error(`backup directory not found: ${backupDir}`);
  if (targetDir === path.parse(targetDir).root) throw new Error("refusing to restore over a filesystem root");
  if (isInside(backupDir, targetDir) || isInside(targetDir, backupDir)) {
    throw new Error("backup and target directories must not overlap");
  }

  // Integrity and inventory verification deliberately happen before target inspection or any write.
  const manifest = await verifyBackup(backupDir);
  const targetExists = inspectTarget(targetDir, force);
  const parent = path.dirname(targetDir);
  fs.mkdirSync(parent, { recursive: true });
  const stageDir = fs.mkdtempSync(path.join(parent, `.${path.basename(targetDir)}.restore-`));

  try {
    copyPayload(backupDir, stageDir, manifest);
    rewriteStoredPaths(stageDir, targetDir, manifest);
    await verifyStagedPayload(stageDir, manifest);
    installStage(stageDir, targetDir, targetExists);
  } catch (error) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    throw error;
  }

  console.log(`RESTORE OK ${targetDir}`);
}

try {
  await main();
} catch (error) {
  console.error(`RESTORE FAILED: ${error.message}`);
  process.exitCode = 1;
}
