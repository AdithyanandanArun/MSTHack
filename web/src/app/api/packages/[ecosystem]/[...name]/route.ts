import { json, route } from "@/lib/server/api";
import { chainNow } from "@/lib/server/config";
import { packageHistory } from "@/lib/server/history";
import { HttpError } from "@/lib/server/httpError";
import { syncChain } from "@/lib/server/sync";

export const dynamic = "force-dynamic";

/**
 * Release security history of one package, for humans and CI/CD
 * (spec §25, §43). Decision support only: never a safety verdict.
 *   GET /api/packages/npm/left-pad   GET /api/packages/npm/@scope/pkg
 */
export const GET = route(async (_req, ctx: { params: Promise<{ ecosystem: string; name: string[] }> }) => {
  const { ecosystem, name } = await ctx.params;
  if (ecosystem !== "npm" && ecosystem !== "pacman") throw new HttpError(400, "ecosystem must be npm or pacman");
  await syncChain().catch(() => null);
  return json(packageHistory(ecosystem, name.map(decodeURIComponent).join("/"), await chainNow()));
});
