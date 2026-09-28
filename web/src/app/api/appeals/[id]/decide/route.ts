import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { decideAppeal, DecideAppeal } from "@/lib/server/findings";
import { enforceLimit } from "@/lib/server/rateLimit";

export const POST = route(async (req, ctx: IdParams) => {
  const reviewer = await requireSession();
  enforceLimit("appeal", req, reviewer);
  const input = DecideAppeal.parse(await req.json());
  await decideAppeal(await idParam(ctx), reviewer, input);
  return json({ ok: true });
});
