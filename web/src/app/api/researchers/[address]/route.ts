import { json, route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/httpError";
import { researcherAppealOutcomes } from "@/lib/server/moderation";
import { statsOf } from "@/lib/server/onchain";
import { getUser } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

/** Researcher reputation: on-chain counters plus off-chain appeal outcomes (spec §26). */
export const GET = route(async (_req, ctx: { params: Promise<{ address: string }> }) => {
  const { address } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new HttpError(400, "invalid address");
  const user = getUser(address);
  return json({
    address: address.toLowerCase(),
    researcherNo: user?.researcher_no ?? null,
    handle: user?.handle ?? null,
    verified: !!user?.verified,
    onchain: await statsOf(address),
    appeals: researcherAppealOutcomes(address),
  });
});
