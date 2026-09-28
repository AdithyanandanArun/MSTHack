import { json, route } from "@/lib/server/api";
import { chainNow } from "@/lib/server/config";
import { developerHistory } from "@/lib/server/history";
import { HttpError } from "@/lib/server/httpError";

export const dynamic = "force-dynamic";

/** A developer's review track record (spec §27). Historical evidence, not a guarantee. */
export const GET = route(async (_req, ctx: { params: Promise<{ address: string }> }) => {
  const { address } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new HttpError(400, "invalid address");
  return json(developerHistory(address, await chainNow()));
});
