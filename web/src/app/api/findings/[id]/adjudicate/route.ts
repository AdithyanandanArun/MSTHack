import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { adjudicate, Adjudication } from "@/lib/server/findings";

export const POST = route(async (req, ctx: IdParams) => {
  const moderator = await requireSession();
  const input = Adjudication.parse(await req.json());
  await adjudicate(await idParam(ctx), moderator, input);
  return json({ ok: true });
});
