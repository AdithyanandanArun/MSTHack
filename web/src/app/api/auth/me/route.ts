import { json, route } from "@/lib/server/api";
import { currentViewer } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const v = await currentViewer();
  return json({ address: v.address, isModerator: v.isModerator, user: v.user });
});
