import "server-only";
import { verifyTypedData, type Address, type Hex } from "viem";
import { adjudicationHash, hashAwards, SETTLEMENT_TYPES, settlementDomain, type AwardArgs } from "@/lib/canonical";
import { phaseOf } from "@/lib/phase";
import { appConfig, chainNow } from "./config";
import { db, nowSec } from "./db";
import { HttpError } from "./httpError";
import { requireRoom, roomPanel } from "./queries";

interface FrozenRecord {
  awards: {
    discoveries: { commitmentIndex: number; severity: number; duplicate: boolean; amount: string }[];
    reviews: { reviewer: string; amount: string }[];
    rejected: number[];
  };
}

/** The exact contract arguments encoded in a frozen adjudication record. */
export function awardArgsOf(record: FrozenRecord): AwardArgs {
  return {
    discoveries: record.awards.discoveries.map((d) => ({
      commitmentIndex: d.commitmentIndex,
      severity: d.severity,
      duplicate: d.duplicate,
      amount: BigInt(d.amount),
    })),
    reviews: record.awards.reviews.map((r) => ({ reviewer: r.reviewer as Address, amount: BigInt(r.amount) })),
    rejected: record.awards.rejected,
  };
}

/** Current frozen record of a room with the hashes panelists sign. */
export function frozenSettlement(roomId: number): { adjudicationHash: Hex; awardsHash: Hex } | null {
  const room = requireRoom(roomId);
  if (!room.adjudication_json) return null;
  const record = JSON.parse(room.adjudication_json) as FrozenRecord;
  return { adjudicationHash: adjudicationHash(record), awardsHash: hashAwards(awardArgsOf(record)) };
}

export function panelApprovals(roomId: number, adjHash: string): { signer: string; signature: Hex }[] {
  return db()
    .prepare("SELECT signer, signature FROM panel_approvals WHERE room_id = ? AND adjudication_hash = ? ORDER BY created_at")
    .all(roomId, adjHash.toLowerCase()) as { signer: string; signature: Hex }[];
}

/**
 * Records a panelist's EIP-712 approval of the room's currently frozen
 * settlement. The server recomputes both hashes from the stored record and
 * verifies the signature, so approvals of anything else are rejected.
 */
export async function approveSettlement(roomId: number, signer: string, signature: Hex) {
  const room = requireRoom(roomId);
  const panel = roomPanel(roomId);
  if (!panel) throw new HttpError(409, "this room has no moderator panel");
  if (!panel.panel.includes(signer)) throw new HttpError(403, "only panel members approve this settlement");
  const phase = phaseOf(room, await chainNow());
  if (phase !== "review") throw new HttpError(409, `approvals happen during peer review (room is ${phase})`);
  const frozen = frozenSettlement(roomId);
  if (!frozen) throw new HttpError(409, "the moderator has not frozen an adjudication record yet");
  const cfg = appConfig();
  if (!cfg.contractAddress) throw new HttpError(503, "contract not configured");
  const ok = await verifyTypedData({
    address: signer as Address,
    domain: settlementDomain(cfg.chainId, cfg.contractAddress),
    types: SETTLEMENT_TYPES,
    primaryType: "Settlement",
    message: { roomId: BigInt(roomId), adjudicationHash: frozen.adjudicationHash, awardsHash: frozen.awardsHash },
    signature,
  });
  if (!ok) throw new HttpError(400, "signature does not approve the current frozen settlement");
  db()
    .prepare(
      `INSERT INTO panel_approvals(room_id, adjudication_hash, awards_hash, signer, signature, created_at) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(room_id, adjudication_hash, signer) DO UPDATE SET signature = excluded.signature, created_at = excluded.created_at`,
    )
    .run(roomId, frozen.adjudicationHash.toLowerCase(), frozen.awardsHash.toLowerCase(), signer, signature, nowSec());
  return { approvals: panelApprovals(roomId, frozen.adjudicationHash).length, quorum: panel.quorum };
}
