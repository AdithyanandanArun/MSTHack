import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { withdrawComment } from "@/lib/server/findings";
import { enforceLimit } from "@/lib/server/rateLimit";

export const POST = route(async (req, ctx: IdParams) => {
  const address = await requireSession();
  enforceLimit("comment", req, address);
  withdrawComment(await idParam(ctx), address);
  return json({ ok: true });
});
