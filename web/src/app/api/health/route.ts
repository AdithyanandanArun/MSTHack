import { NextResponse } from "next/server";
import { evaluateHealth, type HealthInput, type HealthReport } from "@/lib/health";
import { appConfig, contractInfo, publicClient } from "@/lib/server/config";
import { db, getSetting } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const RPC_TIMEOUT_MS = 5_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function threshold(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`RPC timed out after ${timeoutMs} ms`)), timeoutMs);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function response(report: HealthReport): NextResponse {
  return NextResponse.json(report, {
    status: report.httpStatus,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(): Promise<NextResponse> {
  try {
    let expectedChainId = 0;
    let contract: HealthInput["contract"] = { address: null, deployBlock: 0 };
    let configurationError: string | null = null;

    try {
      expectedChainId = appConfig().chainId;
      contract = contractInfo();
    } catch (error) {
      configurationError = `Configuration check failed: ${errorMessage(error)}`;
    }

    const database: HealthInput["db"] = { ok: false };
    const queue: HealthInput["queue"] = { queued: 0, running: 0 };
    let indexedThrough: number | null = null;

    try {
      const connection = db();
      connection.prepare("SELECT 1").get();

      const rows = connection
        .prepare("SELECT status, COUNT(*) AS count FROM evidence_runs WHERE status IN ('queued', 'running') GROUP BY status")
        .all() as Array<{ status: "queued" | "running"; count: number }>;
      for (const row of rows) queue[row.status] = Number(row.count);

      if (contract.address !== null) {
        const setting = getSetting(`sync:${contract.address.toLowerCase()}`);
        const parsed = setting === null ? Number.NaN : Number(setting);
        indexedThrough = Number.isFinite(parsed) ? parsed : null;
      }

      database.ok = true;
    } catch (error) {
      database.error = errorMessage(error);
    }

    const rpc: HealthInput["rpc"] = { reachable: false };
    if (configurationError) {
      rpc.error = configurationError;
    } else {
      const startedAt = performance.now();
      try {
        const client = publicClient();
        const [chainId, head] = await withTimeout(
          Promise.all([client.getChainId(), client.getBlockNumber()]),
          RPC_TIMEOUT_MS,
        );
        rpc.reachable = true;
        rpc.chainId = chainId;
        rpc.head = Number(head);
        rpc.latencyMs = Math.round(performance.now() - startedAt);
      } catch (error) {
        rpc.error = errorMessage(error);
        rpc.latencyMs = Math.round(performance.now() - startedAt);
      }
    }

    const report = evaluateHealth({
      db: database,
      rpc,
      expectedChainId,
      contract,
      indexer: { indexedThrough },
      queue,
      maxIndexerLagBlocks: threshold("RELEASEBOND_HEALTH_MAX_LAG_BLOCKS", 500),
      maxQueueDepth: threshold("RELEASEBOND_HEALTH_MAX_QUEUE", 50),
    });
    return response(report);
  } catch (error) {
    return response(evaluateHealth({
      db: { ok: false, error: errorMessage(error) },
      rpc: { reachable: false, error: "Health checks could not be completed" },
      expectedChainId: 0,
      contract: { address: null, deployBlock: 0 },
      indexer: { indexedThrough: null },
      queue: { queued: 0, running: 0 },
      maxIndexerLagBlocks: 500,
      maxQueueDepth: 50,
    }));
  }
}
