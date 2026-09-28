import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { withdrawComment } from "@/lib/server/findings";

export const POST = route(async (_req, ctx: IdParams) => {
  const address = await requireSession();
  withdrawComment(await idParam(ctx), address);
  return json({ ok: true });
});
