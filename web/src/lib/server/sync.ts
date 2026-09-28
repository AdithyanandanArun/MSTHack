import "server-only";
import { decodeEventLog, type Hex, type Log } from "viem";
import { releaseBondAbi } from "@/lib/chain/releaseBondArtifact";
import { contractInfo, publicClient, resetChainNowCache } from "./config";
import { db, getSetting, setSetting } from "./db";

const LOG_CHUNK = 5_000n;
const lower = (a: string) => a.toLowerCase();

type Decoded = ReturnType<typeof decodeEventLog<typeof releaseBondAbi>>;

let syncing: Promise<SyncResult> | null = null;
let lastSyncAt = 0;

export interface SyncResult {
  fromBlock: number;
  toBlock: number;
  applied: number;
}

/**
 * Pulls ReleaseBond events since the last indexed block and applies them to
 * the SQLite mirror. Idempotent: every write is keyed by chain identifiers.
 */
export async function syncChain(opts: { force?: boolean; minIntervalMs?: number } = {}): Promise<SyncResult | null> {
  const { address, deployBlock } = contractInfo();
  if (!address) return null;
  if (!opts.force && Date.now() - lastSyncAt < (opts.minIntervalMs ?? 8_000)) return null;
  if (syncing) {
    // A pass already in flight may have read the chain head before the block
    // the caller cares about. Unforced callers can share it; forced callers
    // wait for it and then run their own pass.
    if (!opts.force) return syncing;
    await syncing.catch(() => null);
    if ((syncing as Promise<SyncResult> | null) !== null) return syncChain(opts);
  }
  syncing = (async () => {
    try {
      const client = publicClient();
      const key = `sync:${lower(address)}`;
      const last = getSetting(key);
      const from = last ? BigInt(last) + 1n : BigInt(deployBlock);
      const head = await client.getBlockNumber();
      let applied = 0;
      for (let start = from; start <= head; start += LOG_CHUNK) {
        const end = start + LOG_CHUNK - 1n > head ? head : start + LOG_CHUNK - 1n;
        const logs = await client.getLogs({ address, fromBlock: start, toBlock: end });
        applied += await applyLogs(logs);
        setSetting(key, end.toString());
      }
      lastSyncAt = Date.now();
      resetChainNowCache();
      return { fromBlock: Number(from), toBlock: Number(head), applied };
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

function indexedThrough(): bigint {
  const { address } = contractInfo();
  const last = address ? getSetting(`sync:${lower(address)}`) : null;
  return last ? BigInt(last) : -1n;
}

/** Wait for a transaction, then index everything up to its block. */
export async function syncAfterTx(txHash: Hex): Promise<{ status: "success" | "reverted"; blockNumber: number }> {
  const receipt = await publicClient().waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
  for (let i = 0; i < 5 && indexedThrough() < receipt.blockNumber; i++) await syncChain({ force: true });
  return { status: receipt.status, blockNumber: Number(receipt.blockNumber) };
}

const blockTimeCache = new Map<bigint, number>();
async function blockTime(blockNumber: bigint): Promise<number> {
  const hit = blockTimeCache.get(blockNumber);
  if (hit !== undefined) return hit;
  const b = await publicClient().getBlock({ blockNumber });
  const ts = Number(b.timestamp);
  blockTimeCache.set(blockNumber, ts);
  return ts;
}

async function applyLogs(logs: Log[]): Promise<number> {
  let applied = 0;
  for (const log of logs) {
    let ev: Decoded;
    try {
      ev = decodeEventLog({ abi: releaseBondAbi, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    await applyEvent(ev, log);
    applied++;
  }
  return applied;
}

async function applyEvent(ev: Decoded, log: Log): Promise<void> {
  const d = db();
  const tx = log.transactionHash as string;
  const logIndex = Number(log.logIndex);
  switch (ev.eventName) {
    case "ModeratorUpdated": {
      d.prepare(
        "INSERT INTO moderators(address, enabled) VALUES(?, ?) ON CONFLICT(address) DO UPDATE SET enabled = excluded.enabled",
      ).run(lower(ev.args.moderator), ev.args.enabled ? 1 : 0);
      break;
    }
    case "RoomCreated": {
      const a = ev.args;
      const developer = lower(a.developer);
      const artifactSha = a.artifactHash.slice(2).toLowerCase();
      const draft = d
        .prepare("SELECT title, description, require_verified FROM room_drafts WHERE artifact_sha256 = ? AND developer = ?")
        .get(artifactSha, developer) as { title: string | null; description: string | null; require_verified: number } | undefined;
      const createdAt = await blockTime(log.blockNumber!);
      d.prepare(
        `INSERT INTO rooms(id, developer, moderator, artifact_hash, ecosystem, package_name, version, bounty_wei,
           created_at, hunt_ends_at, disclosure_ends_at, adjudication_deadline, status, title, description, create_tx, require_verified)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      ).run(
        Number(a.roomId),
        developer,
        lower(a.moderator),
        lower(a.artifactHash),
        a.ecosystem,
        a.packageName,
        a.version,
        a.bounty.toString(),
        createdAt,
        Number(a.huntEndsAt),
        Number(a.disclosureEndsAt),
        Number(a.adjudicationDeadline),
        draft?.title ?? null,
        draft?.description ?? null,
        tx,
        draft?.require_verified ?? 0,
      );
      break;
    }
    case "PanelConfigured": {
      const a = ev.args;
      d.prepare("INSERT INTO room_panels(room_id, panel_json, quorum) VALUES(?, ?, ?) ON CONFLICT(room_id) DO NOTHING").run(
        Number(a.roomId),
        JSON.stringify(a.panel.map(lower)),
        Number(a.quorum),
      );
      break;
    }
    case "BountyIncreased": {
      d.prepare("UPDATE rooms SET bounty_wei = ? WHERE id = ?").run(ev.args.newBounty.toString(), Number(ev.args.roomId));
      break;
    }
    case "FindingCommitted": {
      const a = ev.args;
      const committedAt = await blockTime(log.blockNumber!);
      d.prepare(
        `INSERT INTO commitments(room_id, idx, researcher, commitment, block_number, committed_at, tx_hash)
         VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      ).run(Number(a.roomId), Number(a.index), lower(a.researcher), lower(a.commitment), Number(log.blockNumber), committedAt, tx);
      // Link the off-chain report only if the committer is its author.
      d.prepare(
        `UPDATE findings SET status = 'committed', commitment_index = ?
         WHERE commitment = ? AND author = ? AND room_id = ?`,
      ).run(Number(a.index), lower(a.commitment), lower(a.researcher), Number(a.roomId));
      break;
    }
    case "FindingRevealed": {
      const a = ev.args;
      d.prepare("UPDATE commitments SET revealed = 1, finding_hash = ?, reveal_tx = ? WHERE room_id = ? AND idx = ?").run(
        lower(a.findingHash),
        tx,
        Number(a.roomId),
        Number(a.index),
      );
      break;
    }
    case "DiscoveryAwarded": {
      const a = ev.args;
      d.prepare(
        `INSERT INTO payouts(room_id, account, kind, commitment_index, severity, duplicate, amount_wei, tx_hash, log_index)
         VALUES(?, ?, 'discovery', ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      ).run(Number(a.roomId), lower(a.researcher), Number(a.index), a.severity, a.duplicate ? 1 : 0, a.amount.toString(), tx, logIndex);
      d.prepare("UPDATE findings SET award_wei = ? WHERE room_id = ? AND commitment_index = ?").run(
        a.amount.toString(),
        Number(a.roomId),
        Number(a.index),
      );
      break;
    }
    case "ReviewAwarded": {
      const a = ev.args;
      d.prepare(
        `INSERT INTO payouts(room_id, account, kind, amount_wei, tx_hash, log_index)
         VALUES(?, ?, 'review', ?, ?, ?) ON CONFLICT DO NOTHING`,
      ).run(Number(a.roomId), lower(a.reviewer), a.amount.toString(), tx, logIndex);
      break;
    }
    case "RoomSettled": {
      const a = ev.args;
      d.prepare(
        `UPDATE rooms SET status = 'settled', settle_tx = ?, adjudication_hash = ?, total_awarded_wei = ?, refunded_wei = ?
         WHERE id = ?`,
      ).run(tx, lower(a.adjudicationHash), a.totalAwarded.toString(), a.refunded.toString(), Number(a.roomId));
      break;
    }
    case "RoomRefunded": {
      const a = ev.args;
      d.prepare("UPDATE rooms SET status = 'refunded', settle_tx = ?, refunded_wei = ? WHERE id = ?").run(
        tx,
        a.amount.toString(),
        Number(a.roomId),
      );
      break;
    }
    case "Withdrawal": {
      const a = ev.args;
      d.prepare(
        "INSERT INTO withdrawals(account, amount_wei, tx_hash, log_index) VALUES(?, ?, ?, ?) ON CONFLICT DO NOTHING",
      ).run(lower(a.account), a.amount.toString(), tx, logIndex);
      break;
    }
    default:
      break;
  }
}
