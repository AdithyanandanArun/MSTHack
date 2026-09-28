import { json, route } from "@/lib/server/api";
import { endSession } from "@/lib/server/auth";

export const POST = route(async () => {
  await endSession();
  return json({ ok: true });
});
