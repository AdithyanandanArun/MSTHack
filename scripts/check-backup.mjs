import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromWeb = createRequire(path.join(repoRoot, "web", "package.json"));
const Database = requireFromWeb("better-sqlite3");

const SCHEMA = `
CREATE TABLE users (
  address TEXT PRIMARY KEY,
  researcher_no INTEGER UNIQUE NOT NULL,
  handle TEXT,
  bio TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE artifacts (
  sha256 TEXT PRIMARY KEY,
  ecosystem TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source_url TEXT,
  source_kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  previous_sha256 TEXT,
  diff_json TEXT,
  scan_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  title TEXT NOT NULL,
  claimed_severity TEXT NOT NULL,
  description TEXT NOT NULL,
  proof_of_concept TEXT NOT NULL,
  reproduction TEXT NOT NULL,
  observations_json TEXT NOT NULL,
  attachments_json TEXT NOT NULL,
  finding_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  commitment TEXT NOT NULL UNIQUE,
  commitment_index INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  verdict TEXT,
  final_severity TEXT,
  duplicate_of INTEGER,
  verdict_reasoning TEXT,
  material_reviewers_json TEXT,
  adjudicated_by TEXT,
  adjudicated_at INTEGER,
  award_wei TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uploader TEXT NOT NULL,
  finding_id INTEGER,
  comment_id INTEGER,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id INTEGER NOT NULL,
  parent_id INTEGER,
  author TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  proposed_severity TEXT,
  duplicate_of INTEGER,
  evidence_run_id INTEGER,
  withdrawn INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) fail(`${message}\nexpected: ${expectedJson}\nactual:   ${actualJson}`);
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function run(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, "scripts", script), ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (status, signal) => resolve({ status, signal }));
  });
}

function describeFailure(result) {
  return `exit=${result.status} signal=${result.signal ?? "none"}`;
}

function rowsByTable(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(({ name }) => name);
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()]));
}

function createFixture(dataDir) {
  fs.mkdirSync(path.join(dataDir, "artifacts"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "session.secret"), randomBytes(32), { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, "artifacts", "release-1.0.0.tgz"), Buffer.from("realistic release tarball bytes\0\x01\x02"));

  const uploads = [
    { name: "proof.log", bytes: Buffer.from("request -> token read -> egress\n") },
    { name: "screenshot.bin", bytes: Buffer.from([0, 255, 17, 34, 128, 64]) },
  ];
  for (const upload of uploads) fs.writeFileSync(path.join(dataDir, "uploads", upload.name), upload.bytes);

  const db = new Database(path.join(dataDir, "releasebond.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("wal_autocheckpoint = 0");
  db.exec(SCHEMA);
  db.pragma("wal_checkpoint(TRUNCATE)");

  const now = 1_760_000_000;
  const artifactFile = path.join(dataDir, "artifacts", "release-1.0.0.tgz");
  db.prepare(
    `INSERT INTO artifacts(
       sha256, ecosystem, name, version, source_url, source_kind, size, storage_path,
       metadata_json, previous_sha256, diff_json, scan_json, created_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sha256File(artifactFile),
    "npm",
    "releasebond-fixture",
    "1.0.0",
    "https://registry.example.invalid/release-1.0.0.tgz",
    "registry",
    fs.statSync(artifactFile).size,
    artifactFile,
    JSON.stringify({ fileCount: 1, files: [] }),
    null,
    null,
    JSON.stringify({ facts: [] }),
    now,
  );
  db.prepare("INSERT INTO users(address, researcher_no, handle, bio, verified, created_at) VALUES(?, ?, ?, ?, ?, ?)").run(
    "0x1111111111111111111111111111111111111111",
    821,
    "cipher-hawk",
    "Supply-chain researcher",
    1,
    now,
  );
  db.prepare(
    `INSERT INTO findings(
       room_id, author, title, claimed_severity, description, proof_of_concept, reproduction,
       observations_json, attachments_json, finding_hash, nonce, commitment, commitment_index,
       status, created_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    42,
    "0x1111111111111111111111111111111111111111",
    "Install hook exfiltrates credentials",
    "high",
    "## Impact\n\nThe install hook reads a token.\n\n- private disclosure\n- reproducible in sandbox",
    "npm install ./release-1.0.0.tgz",
    "Run in the no-network sandbox and inspect the syscall trace.",
    JSON.stringify(["INSTALL_SCRIPT", "SENSITIVE_READ"]),
    JSON.stringify(uploads.map((upload) => sha256File(path.join(dataDir, "uploads", upload.name)))),
    `0x${"ab".repeat(32)}`,
    `0x${"cd".repeat(32)}`,
    `0x${"ef".repeat(32)}`,
    7,
    "committed",
    now + 1,
  );
  db.prepare(
    "INSERT INTO comments(finding_id, author, kind, body, proposed_severity, created_at) VALUES(?, ?, ?, ?, ?, ?)",
  ).run(1, "0x2222222222222222222222222222222222222222", "REPRODUCED", "Confirmed across three clean runs.\nNo network was available.", "high", now + 2);
  const insertAttachment = db.prepare(
    "INSERT INTO attachments(uploader, finding_id, filename, mime, size, sha256, storage_path, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
  );
  uploads.forEach((upload, index) => {
    const file = path.join(dataDir, "uploads", upload.name);
    insertAttachment.run(
      "0x1111111111111111111111111111111111111111",
      1,
      upload.name,
      index === 0 ? "text/plain" : "application/octet-stream",
      upload.bytes.length,
      sha256File(file),
      file,
      now + 3 + index,
    );
  });

  const wal = `${path.join(dataDir, "releasebond.sqlite")}-wal`;
  assert(fs.existsSync(wal) && fs.statSync(wal).size > 0, "fixture rows were not left in the live WAL");
  return { db, uploads };
}

function verifyRestoredRows(sourceDb, restoredDb, sourceDir, restoredDir) {
  const expected = rowsByTable(sourceDb);
  for (const table of ["artifacts", "attachments"]) {
    for (const row of expected[table]) {
      const relative = path.relative(sourceDir, row.storage_path);
      row.storage_path = path.join(restoredDir, relative);
    }
  }
  assertDeepEqual(rowsByTable(restoredDb), expected, "restored database rows differ from the live source");

  for (const table of ["artifacts", "attachments"]) {
    for (const row of restoredDb.prepare(`SELECT storage_path FROM ${table} ORDER BY rowid`).all()) {
      assert(path.isAbsolute(row.storage_path), `restored ${table} path is not absolute`);
      assert(row.storage_path.startsWith(`${restoredDir}${path.sep}`), `restored ${table} path is outside the target`);
      assert(fs.existsSync(row.storage_path), `restored stored file does not exist: ${row.storage_path}`);
    }
  }
}

function verifyDataFiles(sourceDir, restoredDir, relativeFiles) {
  for (const relative of relativeFiles) {
    const source = path.join(sourceDir, relative);
    const restored = path.join(restoredDir, relative);
    assert(fs.existsSync(restored), `restored file is missing: ${relative}`);
    assert(sha256File(restored) === sha256File(source), `restored file bytes differ: ${relative}`);
  }
}

async function main() {
  const tempBase = path.resolve(process.env.TMPDIR || "/tmp");
  const tempRoot = fs.mkdtempSync(path.join(tempBase, "releasebond-backup-check-"));
  const sourceDir = path.join(tempRoot, "source-data");
  const backupsDir = path.join(tempRoot, "backups");
  const restoredDir = path.join(tempRoot, "restored-data");
  let sourceDb;
  let restoredDb;

  try {
    const fixture = createFixture(sourceDir);
    sourceDb = fixture.db;

    const backup = await run("backup.mjs", ["--data", sourceDir, "--out", backupsDir]);
    assert(backup.status === 0, `backup command failed\n${describeFailure(backup)}`);
    const backupEntries = fs.readdirSync(backupsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    assert(backupEntries.length === 1, `backup command created ${backupEntries.length} backup directories instead of one`);
    const backupDir = path.join(backupsDir, backupEntries[0].name);
    assert(fs.existsSync(backupDir), "reported backup directory does not exist");

    fs.mkdirSync(restoredDir);
    const restore = await run("restore.mjs", [backupDir, "--data", restoredDir]);
    assert(restore.status === 0, `restore command failed\n${describeFailure(restore)}`);

    restoredDb = new Database(path.join(restoredDir, "releasebond.sqlite"), { readonly: true, fileMustExist: true });
    verifyRestoredRows(sourceDb, restoredDb, sourceDir, restoredDir);
    verifyDataFiles(sourceDir, restoredDir, [
      "session.secret",
      path.join("artifacts", "release-1.0.0.tgz"),
      ...fixture.uploads.map((upload) => path.join("uploads", upload.name)),
    ]);
    restoredDb.close();
    restoredDb = undefined;

    const nonEmptyTarget = path.join(tempRoot, "non-empty-target");
    fs.mkdirSync(nonEmptyTarget);
    fs.writeFileSync(path.join(nonEmptyTarget, "keep.txt"), "must survive");
    const refused = await run("restore.mjs", [backupDir, "--data", nonEmptyTarget]);
    assert(refused.status !== 0, "restore accepted a non-empty target without --force");
    assert(fs.readFileSync(path.join(nonEmptyTarget, "keep.txt"), "utf8") === "must survive", "refused restore changed the target");
    assertDeepEqual(fs.readdirSync(nonEmptyTarget), ["keep.txt"], "refused restore added files to the target");
    console.log("NON-EMPTY TARGET REFUSAL OK");

    const forced = await run("restore.mjs", [backupDir, "--data", nonEmptyTarget, "--force"]);
    assert(forced.status === 0, `restore with --force failed\n${describeFailure(forced)}`);
    assert(!fs.existsSync(path.join(nonEmptyTarget, "keep.txt")), "forced restore retained a stale target file");
    assert(fs.existsSync(path.join(nonEmptyTarget, "releasebond.sqlite")), "forced restore did not install the database");
    console.log("FORCE REPLACE OK");

    const corruptBackup = path.join(tempRoot, "corrupt-backup");
    fs.cpSync(backupDir, corruptBackup, { recursive: true });
    const corruptUpload = path.join(corruptBackup, "uploads", fixture.uploads[0].name);
    const corrupted = fs.readFileSync(corruptUpload);
    corrupted[0] ^= 0xff;
    fs.writeFileSync(corruptUpload, corrupted);
    const corruptTarget = path.join(tempRoot, "corrupt-target");
    fs.mkdirSync(corruptTarget);
    const rejected = await run("restore.mjs", [corruptBackup, "--data", corruptTarget]);
    assert(rejected.status !== 0, "restore accepted a byte-corrupted backup");
    assertDeepEqual(fs.readdirSync(corruptTarget), [], "corrupt restore wrote to its target");
    console.log("CORRUPTION REJECTION OK");

    console.log("BACKUP RESTORE VERIFIED");
  } finally {
    if (restoredDb?.open) restoredDb.close();
    if (sourceDb?.open) sourceDb.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(`BACKUP RESTORE CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
}
