import { z } from "zod";
import { json, route } from "@/lib/server/api";
import { startSession, verifySiwe } from "@/lib/server/auth";
import { enforceLimit } from "@/lib/server/rateLimit";

const Body = z.object({ message: z.string().min(10).max(4000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });

export const POST = route(async (req) => {
  enforceLimit("auth", req, null);
  const { message, signature } = Body.parse(await req.json());
  const address = await verifySiwe(message, signature as `0x${string}`);
  await startSession(address);
  return json({ address: address.toLowerCase() });
});
