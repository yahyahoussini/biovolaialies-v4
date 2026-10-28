import { describe, expect, it } from "vitest";
import { decideDailyMortality, displayedDeclaration, fieldOpSchema, type Declaration } from "./field";

const d = (authorId: string, count: number, capturedAt: string): Declaration => ({ authorId, count, capturedAt });

describe("daily mortality declarations (document 3, ch. 05)", () => {
  it("applies the first declaration of the day", () => {
    expect(decideDailyMortality([], d("A", 5, "2026-10-20T07:00:00Z"), 0)).toEqual({ status: "APPLIQUEE", apply: 5, reason: null });
  });

  it("lets the same person raise their own day total, adding only the difference", () => {
    const prior = [d("A", 5, "2026-10-20T07:00:00Z")];
    expect(decideDailyMortality(prior, d("A", 8, "2026-10-20T17:00:00Z"), 5)).toMatchObject({ status: "APPLIQUEE", apply: 3 });
  });

  it("treats the same number again as a confirmation", () => {
    const prior = [d("A", 5, "2026-10-20T07:00:00Z")];
    expect(decideDailyMortality(prior, d("B", 5, "2026-10-20T09:00:00Z"), 5)).toMatchObject({ status: "CONFIRMEE", apply: 0 });
  });

  it("flags two people declaring different numbers, and changes nothing until a manager decides", () => {
    const prior = [d("A", 5, "2026-10-20T07:00:00Z")];
    const decision = decideDailyMortality(prior, d("B", 8, "2026-10-20T09:00:00Z"), 5);
    expect(decision).toMatchObject({ status: "EN_ECART", apply: 0 });
    expect(decision.reason).toMatch(/Deux personnes/);
  });

  it("never gives birds back on its own: a lower number is flagged, even from the same person", () => {
    const prior = [d("A", 8, "2026-10-20T07:00:00Z")];
    const decision = decideDailyMortality(prior, d("A", 5, "2026-10-20T17:00:00Z"), 8);
    expect(decision).toMatchObject({ status: "EN_ECART", apply: 0 });
    expect(decision.reason).toMatch(/inférieure/);
  });

  it("flags an older declaration that arrives late and disagrees, and shows the most recent", () => {
    const prior = [d("B", 6, "2026-10-20T18:00:00Z")];
    const late = d("A", 4, "2026-10-20T07:00:00Z");
    expect(decideDailyMortality(prior, late, 6)).toMatchObject({ status: "EN_ECART", apply: 0 });
    expect(displayedDeclaration([...prior, late])?.count).toBe(6);
  });

  it("does not let a second person raise the count without arbitration once someone else declared", () => {
    const prior = [d("A", 5, "2026-10-20T07:00:00Z"), d("B", 5, "2026-10-20T08:00:00Z")];
    expect(decideDailyMortality(prior, d("A", 7, "2026-10-20T17:00:00Z"), 5).status).toBe("EN_ECART");
  });
});

describe("field entry envelope", () => {
  it("requires a real identifier, a sequence and a dated capture", () => {
    const ok = { opId: "6f1c1b7e-2f4a-4f7e-9d8b-3a2c1b0e9f11", deviceId: "phone-0001", seq: 1, authorId: "u1", kind: "MORTALITE", lotId: "l1", capturedAt: "2026-10-20T07:00:00.000Z", payload: { count: 3 } };
    expect(fieldOpSchema.safeParse(ok).success).toBe(true);
    expect(fieldOpSchema.safeParse({ ...ok, opId: "not-a-uuid" }).success).toBe(false);
    expect(fieldOpSchema.safeParse({ ...ok, seq: 0 }).success).toBe(false);
    expect(fieldOpSchema.safeParse({ ...ok, kind: "DANSE" }).success).toBe(false);
  });
});
