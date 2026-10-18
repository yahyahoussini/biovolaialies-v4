import { describe, expect, it } from "vitest";
import { chicksAvailable, hatchRate, validateCandling, validateEggAllocation, validateHatchBalance } from "./balance";

describe("hatchery balances (T31)", () => {
  it("refuses to load more eggs than remain in the lot", () => {
    expect(validateEggAllocation(5000, 3000, 2000).ok).toBe(true);
    expect(validateEggAllocation(5000, 3000, 2001).ok).toBe(false);
    expect(validateEggAllocation(5000, 0, 0).ok).toBe(false);
  });

  it("checks candling against eggs set", () => {
    expect(validateCandling(5000, 400).ok).toBe(true);
    expect(validateCandling(5000, 5001).ok).toBe(false);
  });

  it("requires the hatch to account for every egg set", () => {
    const base = { eggsSet: 5000, clearsRemoved: 400, unhatched: 350, chicksHatched: 4250, culls: 60 };
    expect(validateHatchBalance(base).ok).toBe(true);
    expect(validateHatchBalance({ ...base, chicksHatched: 4249 }).ok).toBe(false);
    expect(validateHatchBalance({ ...base, culls: 4251 }).ok).toBe(false);
  });

  it("computes availability and hatch rate", () => {
    expect(chicksAvailable(4250, 60, 4000)).toBe(190);
    expect(hatchRate(5000, 4250)).toBe(0.85);
    expect(hatchRate(0, 0)).toBeNull();
  });
});
