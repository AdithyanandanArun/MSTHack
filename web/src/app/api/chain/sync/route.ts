import { z } from "zod";
import { json, route } from "@/lib/server/api";
import { syncAfterTx, syncChain } from "@/lib/server/sync";

const Body = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional() });

/** Clients call this after sending a transaction; the server reads the receipt itself. */
export const POST = route(async (req) => {
  const body = Body.parse(await req.json().catch(() => ({})));
  if (body.txHash) {
    const r = await syncAfterTx(body.txHash as `0x${string}`);
    return json(r);
  }
  return json(await syncChain({ force: true }));
});
