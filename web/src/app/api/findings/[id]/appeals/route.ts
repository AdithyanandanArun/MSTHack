import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { createAppeal, CreateAppeal } from "@/lib/server/findings";
import { enforceLimit } from "@/lib/server/rateLimit";

export const POST = route(async (req, ctx: IdParams) => {
  const appellant = await requireSession();
  enforceLimit("appeal", req, appellant);
  const input = CreateAppeal.parse(await req.json());
  return json(await createAppeal(await idParam(ctx), appellant, input), 201);
});
