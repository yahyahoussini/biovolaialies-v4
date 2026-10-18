import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimits } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit then refuses until the window resets", () => {
    const t0 = 1_000_000;
    expect(rateLimit("k", 2, 1000, t0).allowed).toBe(true);
    expect(rateLimit("k", 2, 1000, t0 + 1).allowed).toBe(true);
    const third = rateLimit("k", 2, 1000, t0 + 2);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBe(1);
    expect(rateLimit("k", 2, 1000, t0 + 1000).allowed).toBe(true);
  });

  it("counts keys independently", () => {
    expect(rateLimit("a", 1, 1000, 0).allowed).toBe(true);
    expect(rateLimit("b", 1, 1000, 0).allowed).toBe(true);
    expect(rateLimit("a", 1, 1000, 1).allowed).toBe(false);
  });
});
