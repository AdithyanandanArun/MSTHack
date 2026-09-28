import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromWeb = createRequire(path.join(repoRoot, "web", "package.json"));
const Database = requireFromWeb("better-sqlite3");

function usage() {
  return "Usage: node scripts/backup.mjs [--data <dir>] [--out <backupsDir>]";
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== "--data" && arg !== "--out") throw new Error(`unknown argument: ${arg}\n${usage()}`);
    if (options[arg]) throw new Error(`duplicate argument: ${arg}\n${usage()}`);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a directory\n${usage()}`);
    options[arg] = value;
    i += 1;
  }
  return options;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
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

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  if (!fs.existsSync(source)) return;

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
    else throw new Error(`refusing to back up non-regular file: ${from}`);
  }
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

function quoteIdentifier(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

function readRowCounts(databaseFile) {
  const db = new Database(databaseFile, { readonly: true, fileMustExist: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    return Object.fromEntries(
      tables.map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get().count]),
    );
  } finally {
    db.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dataDir = path.resolve(options["--data"] || process.env.RELEASEBOND_DATA_DIR || path.join(repoRoot, "web", "data"));
  const outDir = path.resolve(options["--out"] || path.join(repoRoot, "backups"));
  const sourceDatabase = path.join(dataDir, "releasebond.sqlite");
  const sourceSecret = path.join(dataDir, "session.secret");

  if (!fs.existsSync(sourceDatabase) || !fs.statSync(sourceDatabase).isFile()) {
    throw new Error(`database not found: ${sourceDatabase}`);
  }
  // Deployments that set SESSION_SECRET in the environment have no secret file; back up without it.
  const hasSecret = fs.existsSync(sourceSecret) && fs.statSync(sourceSecret).isFile();
  if (!hasSecret) console.warn(`note: ${sourceSecret} not found (SESSION_SECRET is probably set in the environment); keep that secret safe separately`);
  if (isInside(dataDir, outDir)) throw new Error("backup output directory must be outside the data directory");

  const createdAt = new Date().toISOString();
  const timestamp = createdAt.replaceAll(":", "-").replaceAll(".", "-");
  const backupDir = path.join(outDir, `releasebond-${timestamp}`);
  let created = false;

  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(backupDir);
    created = true;

    const snapshotFile = path.join(backupDir, "releasebond.sqlite");
    const source = new Database(sourceDatabase, { readonly: true, fileMustExist: true });
    try {
      await source.backup(snapshotFile);
    } finally {
      source.close();
    }

    if (hasSecret) fs.copyFileSync(sourceSecret, path.join(backupDir, "session.secret"));
    copyTree(path.join(dataDir, "artifacts"), path.join(backupDir, "artifacts"));
    copyTree(path.join(dataDir, "uploads"), path.join(backupDir, "uploads"));

    const rowCounts = readRowCounts(snapshotFile);
    // The online backup is self-contained. A read used for row counts may leave
    // transient WAL bookkeeping files, which are not part of the snapshot.
    fs.rmSync(`${snapshotFile}-wal`, { force: true });
    fs.rmSync(`${snapshotFile}-shm`, { force: true });
    const relativeFiles = listFiles(backupDir).filter((file) => file !== "manifest.json").sort();
    const files = [];
    for (const relativePath of relativeFiles) {
      const file = path.join(backupDir, ...relativePath.split("/"));
      const stat = fs.statSync(file);
      files.push({ path: relativePath, size: stat.size, sha256: await sha256File(file) });
    }

    const manifest = {
      formatVersion: 1,
      createdAt,
      sourceDataDir: dataDir,
      files,
      rowCounts,
    };
    fs.writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });

    console.log(`Backup created at ${backupDir}`);
    console.log(`BACKUP OK ${backupDir}`);
  } catch (error) {
    if (created) fs.rmSync(backupDir, { recursive: true, force: true });
    throw error;
  }
}

try {
  await main();
} catch (error) {
  console.error(`BACKUP FAILED: ${error.message}`);
  process.exitCode = 1;
}
