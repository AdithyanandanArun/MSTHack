import { json, route } from "@/lib/server/api";
import { chainNow } from "@/lib/server/config";
import { HttpError } from "@/lib/server/httpError";
import { moderatorHistory } from "@/lib/server/moderation";

export const dynamic = "force-dynamic";

/** A moderator's public track record (spec §33). */
export const GET = route(async (_req, ctx: { params: Promise<{ address: string }> }) => {
  const { address } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new HttpError(400, "invalid address");
  return json(moderatorHistory(address, await chainNow()));
});
