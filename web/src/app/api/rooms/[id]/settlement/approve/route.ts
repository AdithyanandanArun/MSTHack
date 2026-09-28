import { z } from "zod";
import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { approveSettlement } from "@/lib/server/panel";
import { enforceLimit } from "@/lib/server/rateLimit";

const Body = z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) });

/** A panel member's EIP-712 approval of the frozen settlement. */
export const POST = route(async (req, ctx: IdParams) => {
  const signer = await requireSession();
  enforceLimit("comment", req, signer);
  const { signature } = Body.parse(await req.json());
  return json(await approveSettlement(await idParam(ctx), signer, signature as `0x${string}`));
});
