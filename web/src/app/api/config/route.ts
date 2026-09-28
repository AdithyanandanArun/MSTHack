import { json, route } from "@/lib/server/api";
import { appConfig } from "@/lib/server/config";
import { listModerators } from "@/lib/server/queries";
import { syncChain } from "@/lib/server/sync";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await syncChain().catch(() => null);
  return json({ ...appConfig(), moderators: listModerators() });
});
