import { describe, expect, it } from "vitest";
import { activeWithdrawals, eggClearAt, meatClearAt, treatmentError, treatmentSchema, withdrawalMessage, type Treatment } from "./health";

function treatment(overrides: Partial<Treatment> = {}): Treatment {
  return treatmentSchema.parse({
    product: "Amoxicilline 50 %",
    indication: "Colibacillose",
    route: "EAU_DE_BOISSON",
    startedAt: "2026-03-02T08:00:00.000Z",
    durationDays: 5,
    withdrawalMeatDays: 3,
    withdrawalEggDays: null,
    ...overrides,
  });
}

describe("withdrawal periods", () => {
  it("counts the withdrawal from the end of the treatment", () => {
    // 5 days of treatment from 2 March, then 3 days: cleared on 10 March, same hour.
    expect(meatClearAt(treatment())).toBe("2026-03-10T08:00:00.000Z");
  });

  it("has no egg window when no egg withdrawal was given", () => {
    expect(eggClearAt(treatment())).toBeNull();
    expect(eggClearAt(treatment({ withdrawalEggDays: 7 }))).toBe("2026-03-14T08:00:00.000Z");
  });

  it("flags a date inside the window and clears it at the end", () => {
    const recorded = [{ eventId: "e1", treatment: treatment() }];
    expect(activeWithdrawals(recorded, "2026-03-09T23:00:00.000Z", "meat")).toHaveLength(1);
    expect(activeWithdrawals(recorded, "2026-03-10T08:00:00.000Z", "meat")).toHaveLength(0);
    // Before the treatment started, nothing was withdrawn.
    expect(activeWithdrawals(recorded, "2026-03-01T08:00:00.000Z", "meat")).toHaveLength(0);
  });

  it("reports the longest running window first", () => {
    const recorded = [
      { eventId: "short", treatment: treatment({ product: "Produit court", withdrawalMeatDays: 1 }) },
      { eventId: "long", treatment: treatment({ product: "Produit long", withdrawalMeatDays: 20 }) },
    ];
    const active = activeWithdrawals(recorded, "2026-03-08T00:00:00.000Z", "meat");
    expect(active.map((w) => w.eventId)).toEqual(["long", "short"]);
    expect(withdrawalMessage(active, "meat")).toContain("Produit long");
  });

  it("requires an egg withdrawal on layers and breeders, not on meat lots", () => {
    expect(treatmentError(treatment(), { purpose: "PONTE" })).toMatch(/délai d'attente œufs/);
    expect(treatmentError(treatment({ withdrawalEggDays: 0 }), { purpose: "REPRODUCTION" })).toBeNull();
    expect(treatmentError(treatment(), { purpose: "CHAIR" })).toBeNull();
  });

  it("refuses a treatment longer than two months as a likely typing error", () => {
    expect(() => treatment({ durationDays: 90 })).toThrow();
  });
});
