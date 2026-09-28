import { json, route } from "@/lib/server/api";
import { createNonce } from "@/lib/server/auth";
import { enforceLimit } from "@/lib/server/rateLimit";

export const POST = route(async (req) => {
  enforceLimit("authNonce", req, null);
  return json({ nonce: createNonce() });
});
