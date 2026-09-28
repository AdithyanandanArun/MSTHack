import { describe, expect, it } from "vitest";
import { Limiter } from "@/lib/server/rateLimit";

describe("rate limiter", () => {
  const rule = { limit: 3, windowMs: 60_000 };
  const clock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it("allows the budget within a window then blocks with a retry-after", () => {
    const c = clock();
    const l = new Limiter(c.now);
    expect([l.hit("k", rule), l.hit("k", rule), l.hit("k", rule)]).toEqual([0, 0, 0]);
    c.advance(15_000);
    expect(l.hit("k", rule)).toBe(45);
  });

  it("isolates keys so one wallet cannot spend another's budget", () => {
    const l = new Limiter(clock().now);
    for (let i = 0; i < 3; i++) l.hit("a", rule);
    expect(l.hit("a", rule)).toBeGreaterThan(0);
    expect(l.hit("b", rule)).toBe(0);
  });

  it("resets after the window elapses", () => {
    const c = clock();
    const l = new Limiter(c.now);
    for (let i = 0; i < 3; i++) l.hit("k", rule);
    expect(l.hit("k", rule)).toBeGreaterThan(0);
    c.advance(60_000);
    expect(l.hit("k", rule)).toBe(0);
  });
});
