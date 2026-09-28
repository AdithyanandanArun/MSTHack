import "server-only";
import type { Observation } from "@/lib/canonical";
import { db, nowSec } from "./db";
import { buildReport, reportHash } from "./evidence";
import { getFinding, getRoom } from "./queries";

// Evidence runs (rules + repeated sandbox runs + agent) take seconds to
// minutes, so they run in the background. The evidence_runs table is the
// queue: rows go queued -> running -> done | error, and clients poll
// GET /api/evidence/:id.

const CONCURRENCY = Math.max(1, Number(process.env.RELEASEBOND_EVIDENCE_CONCURRENCY || 2));

type QueueState = { active: number; recovered: boolean };
const g = globalThis as typeof globalThis & { __rbEvidenceQueue?: QueueState };
const state = (g.__rbEvidenceQueue ??= { active: 0, recovered: false });

/** Runs left "running" by a previous process will never finish; fail them visibly. */
function recover() {
  if (state.recovered) return;
  state.recovered = true;
  db()
    .prepare("UPDATE evidence_runs SET status = 'error', error = 'interrupted by a server restart; run it again', finished_at = ? WHERE status = 'running'")
    .run(nowSec());
}

export function enqueueEvidence(opts: { roomId: number; findingId: number | null; requestedBy: string }): number {
  recover();
  const id = Number(
    db()
      .prepare("INSERT INTO evidence_runs(room_id, finding_id, requested_by, status, created_at) VALUES(?, ?, ?, 'queued', ?)")
      .run(opts.roomId, opts.findingId, opts.requestedBy, nowSec()).lastInsertRowid,
  );
  kick();
  return id;
}

/** The caller's run that is still queued or running, if any. */
export function pendingRunFor(address: string): { id: number; status: string } | undefined {
  recover();
  return db()
    .prepare("SELECT id, status FROM evidence_runs WHERE requested_by = ? AND status IN ('queued', 'running') ORDER BY id LIMIT 1")
    .get(address) as { id: number; status: string } | undefined;
}

/** 1-based position among queued runs, or null once it has started. */
export function queuePosition(id: number): number | null {
  const row = db().prepare("SELECT status FROM evidence_runs WHERE id = ?").get(id) as { status: string } | undefined;
  if (row?.status !== "queued") return null;
  const n = db().prepare("SELECT COUNT(*) AS n FROM evidence_runs WHERE status = 'queued' AND id <= ?").get(id) as { n: number };
  return n.n;
}

/** Starts as many queued runs as capacity allows. Safe to call any time. */
export function kick() {
  recover();
  while (state.active < CONCURRENCY) {
    const next = db().prepare("SELECT id FROM evidence_runs WHERE status = 'queued' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    if (!next) return;
    // Claim atomically so two kicks never start the same run.
    const claimed = db().prepare("UPDATE evidence_runs SET status = 'running' WHERE id = ? AND status = 'queued'").run(next.id).changes === 1;
    if (!claimed) continue;
    state.active++;
    void execute(next.id).finally(() => {
      state.active--;
      kick();
    });
  }
}

async function execute(id: number): Promise<void> {
  const d = db();
  try {
    const run = d.prepare("SELECT room_id, finding_id FROM evidence_runs WHERE id = ?").get(id) as { room_id: number; finding_id: number | null };
    const room = getRoom(run.room_id);
    if (!room) throw new Error("room no longer exists");
    let claims: Observation[] = [];
    let finding: Parameters<typeof buildReport>[0]["finding"];
    if (run.finding_id !== null) {
      const f = getFinding(run.finding_id);
      if (!f) throw new Error("finding no longer exists");
      claims = JSON.parse(f.observations_json) as Observation[];
      finding = {
        title: f.title,
        claimedSeverity: f.claimed_severity,
        description: f.description,
        proofOfConcept: f.proof_of_concept,
        reproduction: f.reproduction,
        observations: claims,
      };
    }
    const report = await buildReport({ sha256: room.artifact_hash.slice(2), claims, finding });
    d.prepare("UPDATE evidence_runs SET status = 'done', outcome = ?, report_json = ?, report_hash = ?, finished_at = ? WHERE id = ?").run(
      report.outcome,
      JSON.stringify(report),
      reportHash(report),
      nowSec(),
      id,
    );
  } catch (e) {
    d.prepare("UPDATE evidence_runs SET status = 'error', error = ?, finished_at = ? WHERE id = ?").run(
      e instanceof Error ? e.message : String(e),
      nowSec(),
      id,
    );
  }
}
