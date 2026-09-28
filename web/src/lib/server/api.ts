import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "./auth";
import { HttpError } from "./httpError";
import { RateLimitError } from "./rateLimit";

/** JSON.stringify that turns bigints into decimal strings. */
export function json(data: unknown, status = 200): NextResponse {
  return new NextResponse(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler<C> = (req: Request, ctx: C) => Promise<NextResponse | Response>;

export function route<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof AuthError) return json({ error: e.message }, 401);
      if (e instanceof RateLimitError) {
        const res = json({ error: e.message, retryAfter: e.retryAfterSec }, 429);
        res.headers.set("retry-after", String(e.retryAfterSec));
        return res;
      }
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof ZodError) {
        return json({ error: e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, 400);
      }
      console.error("[api]", e);
      return json({ error: e instanceof Error ? e.message : "internal error" }, 500);
    }
  };
}

export type IdParams = { params: Promise<{ id: string }> };

export async function idParam(ctx: IdParams): Promise<number> {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, "invalid id");
  return n;
}
