import { z } from "zod";
import { json, route } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { getUser, HttpError } from "@/lib/server/queries";
import { enforceLimit } from "@/lib/server/rateLimit";

const Body = z.object({
  handle: z.string().trim().regex(/^[A-Za-z0-9_.-]{2,32}$/, "2-32 letters, digits, _ . -").nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
});

export const PATCH = route(async (req) => {
  const address = await requireSession();
  enforceLimit("profile", req, address);
  const body = Body.parse(await req.json());
  if (body.handle) {
    const taken = db().prepare("SELECT address FROM users WHERE lower(handle) = lower(?) AND address != ?").get(body.handle, address);
    if (taken) throw new HttpError(409, "handle already taken");
  }
  db()
    .prepare("UPDATE users SET handle = COALESCE(?, handle), bio = COALESCE(?, bio) WHERE address = ?")
    .run(body.handle ?? null, body.bio ?? null, address);
  return json(getUser(address));
});
