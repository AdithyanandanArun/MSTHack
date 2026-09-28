import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.RELEASEBOND_DATA_DIR || path.join(process.cwd(), "data"));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  address TEXT PRIMARY KEY,               -- lowercase 0x address
  researcher_no INTEGER UNIQUE NOT NULL,  -- public "Researcher #821" id
  handle TEXT,
  bio TEXT,
  verified INTEGER NOT NULL DEFAULT 0,    -- human verification badge (moderator granted)
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

-- Exact release artifacts fetched and hashed by the server.
CREATE TABLE IF NOT EXISTS artifacts (
  sha256 TEXT PRIMARY KEY,
  ecosystem TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source_url TEXT,
  source_kind TEXT NOT NULL,              -- registry | upload
  size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  metadata_json TEXT NOT NULL,            -- normalized ReleaseArtifact minus file contents
  previous_sha256 TEXT,
  diff_json TEXT,
  scan_json TEXT,                         -- deterministic static scan of the release
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_drafts (
  artifact_sha256 TEXT NOT NULL,
  developer TEXT NOT NULL,
  title TEXT,
  description TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (artifact_sha256, developer)
);

-- Mirror of on-chain rooms (source of truth: ReleaseBond events).
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,                 -- on-chain roomId
  developer TEXT NOT NULL,
  moderator TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,            -- bytes32 hex
  ecosystem TEXT NOT NULL,
  package_name TEXT NOT NULL,
  version TEXT NOT NULL,
  bounty_wei TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  hunt_ends_at INTEGER NOT NULL,
  disclosure_ends_at INTEGER NOT NULL,
  adjudication_deadline INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active | settled | refunded
  title TEXT,
  description TEXT,
  create_tx TEXT,
  settle_tx TEXT,
  adjudication_hash TEXT,
  adjudication_json TEXT,                 -- frozen record whose hash went on-chain
  total_awarded_wei TEXT,
  refunded_wei TEXT
);

CREATE TABLE IF NOT EXISTS commitments (
  room_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  researcher TEXT NOT NULL,
  commitment TEXT NOT NULL UNIQUE,
  block_number INTEGER NOT NULL,
  committed_at INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  revealed INTEGER NOT NULL DEFAULT 0,
  finding_hash TEXT,
  reveal_tx TEXT,
  PRIMARY KEY (room_id, idx)
);

CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  title TEXT NOT NULL,
  claimed_severity TEXT NOT NULL,
  description TEXT NOT NULL,
  proof_of_concept TEXT NOT NULL,
  reproduction TEXT NOT NULL,
  observations_json TEXT NOT NULL,
  attachments_json TEXT NOT NULL,         -- sha256 list bound into finding_hash
  finding_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,                    -- private until reveal
  commitment TEXT NOT NULL UNIQUE,
  commitment_index INTEGER,               -- set once FindingCommitted is observed
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | committed
  verdict TEXT,                           -- valid | invalid | duplicate | inconclusive
  final_severity TEXT,
  duplicate_of INTEGER,
  verdict_reasoning TEXT,
  material_reviewers_json TEXT,
  adjudicated_by TEXT,
  adjudicated_at INTEGER,
  award_wei TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS findings_room ON findings(room_id);

CREATE TABLE IF NOT EXISTS attachments (
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

CREATE TABLE IF NOT EXISTS comments (
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
CREATE INDEX IF NOT EXISTS comments_finding ON comments(finding_id);

CREATE TABLE IF NOT EXISTS votes (
  target_type TEXT NOT NULL,              -- finding | comment
  target_id INTEGER NOT NULL,
  voter TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (target_type, target_id, voter)
);

CREATE TABLE IF NOT EXISTS evidence_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  finding_id INTEGER,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL,                   -- running | done | error
  outcome TEXT,                           -- REPRODUCED | PARTIALLY_REPRODUCED | NOT_REPRODUCED | INCONCLUSIVE
  report_json TEXT,
  report_hash TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS moderators (
  address TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payouts (
  room_id INTEGER NOT NULL,
  account TEXT NOT NULL,
  kind TEXT NOT NULL,                     -- discovery | review | refund
  commitment_index INTEGER,
  severity INTEGER,
  duplicate INTEGER,
  amount_wei TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS withdrawals (
  account TEXT NOT NULL,
  amount_wei TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
`;

type GlobalWithDb = typeof globalThis & { __releasebondDb?: Database.Database };

export function db(): Database.Database {
  const g = globalThis as GlobalWithDb;
  if (!g.__releasebondDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const conn = new Database(path.join(DATA_DIR, "releasebond.sqlite"));
    conn.pragma("journal_mode = WAL");
    conn.pragma("foreign_keys = ON");
    conn.pragma("busy_timeout = 5000");
    conn.exec(SCHEMA);
    g.__releasebondDb = conn;
  }
  return g.__releasebondDb;
}

export function getSetting(key: string): string | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db()
    .prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export const nowSec = () => Math.floor(Date.now() / 1000);

export function dataPath(...parts: string[]): string {
  const p = path.join(DATA_DIR, ...parts);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}
