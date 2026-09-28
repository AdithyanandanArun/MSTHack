// Fixed-window rate limiting for write endpoints. In-memory per process: fine
// for a single server; move to Redis (or similar) when running several.
import { HttpError } from "./httpError";

export interface LimitRule {
  /** Max requests per window. */
  limit: number;
  windowMs: number;
}

/** Budgets per action. Tunable with RELEASEBOND_RATE_LIMIT_SCALE (e.g. 0.1 for tests, 10 for demos). */
export const RULES = {
  auth: { limit: 30, windowMs: 60_000 },
  artifact: { limit: 10, windowMs: 10 * 60_000 },
  roomDraft: { limit: 20, windowMs: 10 * 60_000 },
  finding: { limit: 10, windowMs: 10 * 60_000 },
  comment: { limit: 30, windowMs: 60_000 },
  vote: { limit: 60, windowMs: 60_000 },
  upload: { limit: 30, windowMs: 10 * 60_000 },
  evidence: { limit: 20, windowMs: 60 * 60_000 },
  profile: { limit: 10, windowMs: 60_000 },
} satisfies Record<string, LimitRule>;

export type LimitName = keyof typeof RULES;

export class RateLimitError extends HttpError {
  constructor(public retryAfterSec: number) {
    super(429, `too many requests; try again in ${retryAfterSec}s`);
  }
}

export class Limiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(private now: () => number = Date.now) {}

  /** Records one hit; returns seconds to wait if the budget is already spent, else 0. */
  hit(key: string, rule: LimitRule): number {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= rule.windowMs) {
      this.windows.set(key, { start: t, count: 1 });
      this.sweep(t);
      return 0;
    }
    if (w.count >= rule.limit) return Math.max(1, Math.ceil((w.start + rule.windowMs - t) / 1000));
    w.count++;
    return 0;
  }

  /** Drops expired windows so memory stays bounded by active keys. */
  private sweep(t: number) {
    if (this.windows.size < 10_000) return;
    for (const [k, w] of this.windows) if (t - w.start > 60 * 60_000) this.windows.delete(k);
  }
}

const g = globalThis as typeof globalThis & { __rbLimiter?: Limiter };
const limiter = (g.__rbLimiter ??= new Limiter());

function scaled(rule: LimitRule): LimitRule {
  const scale = Number(process.env.RELEASEBOND_RATE_LIMIT_SCALE || 1);
  return { ...rule, limit: Math.max(1, Math.round(rule.limit * (Number.isFinite(scale) && scale > 0 ? scale : 1))) };
}

/**
 * Client IP, only when a trusted reverse proxy sets it. Without
 * RELEASEBOND_TRUST_PROXY=1 forwarded headers are spoofable and ignored.
 */
export function clientIp(req: Request): string | null {
  if (process.env.RELEASEBOND_TRUST_PROXY !== "1") return null;
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || null;
}

/** Throws RateLimitError when the wallet (and, behind a proxy, the IP) is over budget for this action. */
export function enforceLimit(name: LimitName, req: Request, address: string | null): void {
  if (process.env.RELEASEBOND_RATE_LIMIT === "off") return;
  const rule = scaled(RULES[name]);
  const keys = [address ? `${name}:a:${address}` : null, clientIp(req) ? `${name}:ip:${clientIp(req)}` : null];
  // Unauthenticated calls without a trusted IP share one bucket so they stay bounded.
  if (!keys[0] && !keys[1]) keys.push(`${name}:anon`);
  for (const k of keys) {
    if (!k) continue;
    const wait = limiter.hit(k, rule);
    if (wait) throw new RateLimitError(wait);
  }
}
