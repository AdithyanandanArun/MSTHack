import { parseSiweMessage } from "viem/siwe";
import { z } from "zod";
import { json, route } from "@/lib/server/api";
import { startSession, verifySiwe } from "@/lib/server/auth";
import { enforceLimit } from "@/lib/server/rateLimit";

const Body = z.object({
  message: z.string().min(10).max(4000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  scheme: z.enum(["eip191", "eip712"]).default("eip191"),
});

export const POST = route(async (req) => {
  const { message, signature, scheme } = Body.parse(await req.json());
  // Limit per claimed wallet (plus per IP behind a trusted proxy), never one shared bucket.
  enforceLimit("authVerify", req, parseSiweMessage(message).address?.toLowerCase() ?? null);
  const address = await verifySiwe(message, signature as `0x${string}`, scheme);
  await startSession(address);
  return json({ address: address.toLowerCase() });
});
