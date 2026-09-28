export interface HealthInput {
  db: { ok: boolean; error?: string };
  rpc: { reachable: boolean; chainId?: number; head?: number; latencyMs?: number; error?: string };
  expectedChainId: number;
  contract: { address: string | null; deployBlock: number };
  indexer: { indexedThrough: number | null };
  queue: { queued: number; running: number };
  maxIndexerLagBlocks: number;
  maxQueueDepth: number;
}

export interface HealthReport {
  status: "ready" | "degraded" | "down";
  httpStatus: 200 | 503;
  problems: string[];
  checks: {
    database: "ok" | "fail";
    rpc: "ok" | "unreachable" | "wrong-chain";
    contract: "configured" | "missing";
    indexer: "ok" | "lagging" | "not-started";
    queue: "ok" | "backlogged";
  };
  chainId: number | null;
  head: number | null;
  indexedThrough: number | null;
  lagBlocks: number | null;
  queue: { queued: number; running: number };
}

function detail(message: string, error?: string): string {
  return error ? `${message}: ${error}` : message;
}

export function evaluateHealth(input: HealthInput): HealthReport {
  try {
    const database = input.db.ok ? "ok" : "fail";
    const rpc = !input.rpc.reachable
      ? "unreachable"
      : input.rpc.chainId !== input.expectedChainId
        ? "wrong-chain"
        : "ok";
    const contract = input.contract.address === null ? "missing" : "configured";

    const chainId = input.rpc.chainId ?? null;
    const head = input.rpc.head ?? null;
    const indexedThrough = input.indexer.indexedThrough;
    const lagBlocks = head !== null && indexedThrough !== null ? head - indexedThrough : null;

    const indexer = indexedThrough === null
      ? "not-started"
      : lagBlocks !== null && lagBlocks > input.maxIndexerLagBlocks
        ? "lagging"
        : "ok";
    const queue = input.queue.queued > input.maxQueueDepth ? "backlogged" : "ok";

    const problems: string[] = [];
    if (database === "fail") problems.push(detail("Database check failed", input.db.error));
    if (rpc === "unreachable") problems.push(detail("RPC is unreachable", input.rpc.error));
    if (rpc === "wrong-chain") {
      problems.push(`RPC is on chain ${chainId ?? "unknown"}; expected chain ${input.expectedChainId}`);
    }
    if (contract === "missing") problems.push("Contract is not configured");
    if (indexer === "not-started" && contract === "configured") problems.push("Indexer has not started");
    if (indexer === "lagging") problems.push(`Indexer is ${lagBlocks} blocks behind the chain head`);
    if (queue === "backlogged") {
      problems.push(`Evidence queue is backlogged with ${input.queue.queued} queued runs`);
    }

    const isDown = database === "fail" || rpc === "unreachable" || rpc === "wrong-chain";
    const isDegraded = contract === "missing"
      || (indexer === "not-started" && contract === "configured")
      || indexer === "lagging"
      || queue === "backlogged";

    return {
      status: isDown ? "down" : isDegraded ? "degraded" : "ready",
      httpStatus: isDown ? 503 : 200,
      problems,
      checks: { database, rpc, contract, indexer, queue },
      chainId,
      head,
      indexedThrough,
      lagBlocks,
      queue: { ...input.queue },
    };
  } catch {
    return {
      status: "down",
      httpStatus: 503,
      problems: ["Health evaluation failed"],
      checks: {
        database: "fail",
        rpc: "unreachable",
        contract: "missing",
        indexer: "not-started",
        queue: "ok",
      },
      chainId: null,
      head: null,
      indexedThrough: null,
      lagBlocks: null,
      queue: { queued: 0, running: 0 },
    };
  }
}
