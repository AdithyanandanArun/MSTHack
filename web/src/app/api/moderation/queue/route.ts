import { json, route } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { chainNow } from "@/lib/server/config";
import { moderatorQueue } from "@/lib/server/moderation";
import { syncChain } from "@/lib/server/sync";

export const dynamic = "force-dynamic";

/** What needs the signed-in moderator now: verdicts, appeals, panel approvals, deadlines. */
export const GET = route(async () => {
  const address = await requireSession();
  await syncChain().catch(() => null);
  return json(moderatorQueue(address, await chainNow()));
});
