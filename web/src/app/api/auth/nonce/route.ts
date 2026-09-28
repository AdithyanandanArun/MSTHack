import { json, route } from "@/lib/server/api";
import { createNonce } from "@/lib/server/auth";

export const POST = route(async () => json({ nonce: createNonce() }));
