import { describe, expect, it } from "vitest";
import { A01_SHEET, NOMENCLATURE_REFERENCE } from "../../data/seed/reference/nomenclature";
import { budget, cablingShare, familyBands, filledCount, isPurchasable, sheetStatus, type NomenclatureArticle } from "./nomenclature";
import { COMMISSIONING_RECIPES, receptionStatus, type CommissioningRecord } from "./recipes";

const articles: NomenclatureArticle[] = NOMENCLATURE_REFERENCE.map(([ref, designation, quantity, priceLowMad, priceHighMad, priceConfidence, origin], sortOrder) => ({
  id: ref,
  ref,
  family: ref[0],
  designation,
  manufacturer: null,
  quantity,
  quantityFormula: null,
  location: null,
  function: null,
  specifications: null,
  communication: null,
  power: null,
  connectors: null,
  cables: null,
  priceLowMad,
  priceHighMad,
  priceConfidence,
  priceDate: null,
  installation: null,
  spares: null,
  maintenance: null,
  origin,
  sortOrder,
  updatedAt: null,
  updatedBy: null,
  ...(ref === "A01" ? A01_SHEET : {}),
}));

describe("document 2 nomenclature", () => {
  it("holds the 106 articles of ch. 09, family by family", () => {
    expect(articles).toHaveLength(106);
    expect(articles.reduce((n, a) => n + a.quantity, 0)).toBe(358);
    // The ch. 09 summary plate: articles and units per family.
    expect(Object.fromEntries(familyBands(articles).map((f) => [f.family, [f.articles, f.units]]))).toEqual({
      A: [8, 50], B: [3, 4], C: [7, 14], D: [5, 24], E: [3, 7], F: [6, 14], G: [7, 34], H: [7, 26],
      I: [11, 41], J: [8, 15], K: [4, 6], L: [3, 12], M: [7, 40], N: [7, 7], O: [2, 4], P: [18, 60],
    });
    expect(new Set(articles.map((a) => a.ref)).size).toBe(106);
  });

  it("computes the budget from the articles, and shows where ch. 11 does not follow from them", () => {
    const lines = Object.fromEntries(budget(articles).map((b) => [b.origin, b]));
    // The Chinese block agrees with ch. 11 to the thousand it is rounded to…
    expect(lines.Chine).toMatchObject({ articles: 90, lowMad: 105_141, highMad: 316_852, agrees: true });
    // …the Moroccan and European blocks do not: the article table gives less than the printed totals.
    expect(lines.Maroc).toMatchObject({ articles: 10, lowMad: 68_860, highMad: 170_217, agrees: false });
    expect(lines.UE).toMatchObject({ articles: 6, lowMad: 11_539, highMad: 37_663, agrees: false });
    expect(lines.total).toMatchObject({ articles: 106, units: 358, lowMad: 185_540, highMad: 524_732, agrees: false });
    // Cabling and connectors weigh less than the 15–25 % the document calls usual.
    const share = cablingShare(articles);
    expect(share.low).toBeCloseTo(0.105, 3);
    expect(share.high).toBeCloseTo(0.118, 3);
    expect(share.withinRange).toBe(false);
  });

  it("calls a line purchasable only with all fifteen fields, a quantity formula and a dated price", () => {
    const a01 = articles.find((a) => a.ref === "A01")!;
    // Ch. 10's own example still lacks the manufacturer ("à arrêter") and the date of its price band.
    expect(filledCount(a01)).toBe(13);
    expect(sheetStatus(a01)).toMatchObject({ manufacturer: false, price: false, quantity: true, location: true, cables: true });
    expect(isPurchasable({ ...a01, manufacturer: "Équivalent : caractéristiques du champ 07", priceDate: "2026-10-20" })).toBe(true);
    expect(isPurchasable({ ...a01, manufacturer: "Équivalent", priceDate: "2026-10-20", quantityFormula: null })).toBe(false);
    expect(articles.filter(isPurchasable)).toHaveLength(0);
  });

  it("receives a building only when every test that applies has passed, the latest run deciding", () => {
    expect(COMMISSIONING_RECIPES).toHaveLength(24);
    const record = (code: string, result: CommissioningRecord["result"]): CommissioningRecord => ({ id: code, buildingId: "b", code, result, performedAt: "2025-02-17", performedBy: "x", measured: null, evidence: "PV", notes: null, recordedBy: "u", recordedAt: "2025-02-17T18:00:00Z" });
    const latest = new Map([
      ["A01", record("A01", "CONFORME")],
      ["A03", record("A03", "NON_CONFORME")],
    ]);
    expect(receptionStatus(["A01", "A03", "B01"], latest)).toEqual({ applicable: 3, conforming: 1, nonConforming: ["A03"], missing: ["B01"], complete: false });
    latest.set("A03", record("A03", "CONFORME"));
    latest.set("B01", record("B01", "CONFORME"));
    expect(receptionStatus(["A01", "A03", "B01"], latest).complete).toBe(true);
    expect(receptionStatus([], latest).complete).toBe(false);
  });
});
