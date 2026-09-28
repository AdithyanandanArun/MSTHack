import { describe, expect, it } from "vitest";
import { evaluateHealth, type HealthInput } from "@/lib/health";

const healthy: HealthInput = {
  db: { ok: true },
  rpc: { reachable: true, chainId: 91_562_037, head: 10_000, latencyMs: 25 },
  expectedChainId: 91_562_037,
  contract: { address: "0x1234", deployBlock: 1_000 },
  indexer: { indexedThrough: 9_900 },
  queue: { queued: 2, running: 1 },
  maxIndexerLagBlocks: 500,
  maxQueueDepth: 50,
};

describe("evaluateHealth", () => {
  it("reports ready when every dependency is healthy", () => {
    expect(evaluateHealth(healthy)).toEqual({
      status: "ready",
      httpStatus: 200,
      problems: [],
      checks: {
        database: "ok",
        rpc: "ok",
        contract: "configured",
        indexer: "ok",
        queue: "ok",
      },
      chainId: 91_562_037,
      head: 10_000,
      indexedThrough: 9_900,
      lagBlocks: 100,
      queue: { queued: 2, running: 1 },
    });
  });

  it("is down with 503 on a wrong chain or unreachable RPC or failed database", () => {
    const wrongChain = evaluateHealth({
      ...healthy,
      rpc: { ...healthy.rpc, chainId: 1 },
    });
    const unreachable = evaluateHealth({
      ...healthy,
      rpc: { reachable: false, error: "timeout" },
    });
    const failedDatabase = evaluateHealth({
      ...healthy,
      db: { ok: false, error: "disk unavailable" },
    });

    for (const report of [wrongChain, unreachable, failedDatabase]) {
      expect(report.status).toBe("down");
      expect(report.httpStatus).toBe(503);
    }
    expect(wrongChain.checks.rpc).toBe("wrong-chain");
    expect(unreachable.checks.rpc).toBe("unreachable");
    expect(failedDatabase.checks.database).toBe("fail");
  });

  it("is degraded but serving when the contract is missing or the indexer lags or the queue backs up", () => {
    const missingContract = evaluateHealth({
      ...healthy,
      contract: { address: null, deployBlock: 0 },
      indexer: { indexedThrough: null },
    });
    const indexerNotStarted = evaluateHealth({
      ...healthy,
      indexer: { indexedThrough: null },
    });
    const laggingIndexer = evaluateHealth({
      ...healthy,
      indexer: { indexedThrough: 9_499 },
    });
    const backloggedQueue = evaluateHealth({
      ...healthy,
      queue: { queued: 51, running: 2 },
    });

    for (const report of [missingContract, indexerNotStarted, laggingIndexer, backloggedQueue]) {
      expect(report.status).toBe("degraded");
      expect(report.httpStatus).toBe(200);
      expect(report.problems).not.toHaveLength(0);
    }
    expect(missingContract.checks.contract).toBe("missing");
    expect(indexerNotStarted.checks.indexer).toBe("not-started");
    expect(laggingIndexer.checks.indexer).toBe("lagging");
    expect(laggingIndexer.lagBlocks).toBe(501);
    expect(backloggedQueue.checks.queue).toBe("backlogged");
  });
});
