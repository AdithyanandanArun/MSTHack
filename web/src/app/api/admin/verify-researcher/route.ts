import { z } from "zod";
import { json, route } from "@/lib/server/api";
import { ensureUser, requireSession } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { HttpError, isModerator } from "@/lib/server/queries";

const Body = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), verified: z.boolean() });

/** Moderators grant the "verified human" badge after an off-platform identity check. */
export const POST = route(async (req) => {
  const caller = await requireSession();
  if (!isModerator(caller)) throw new HttpError(403, "moderators only");
  const { address, verified } = Body.parse(await req.json());
  ensureUser(address);
  db().prepare("UPDATE users SET verified = ? WHERE address = ?").run(verified ? 1 : 0, address.toLowerCase());
  return json({ ok: true });
});
