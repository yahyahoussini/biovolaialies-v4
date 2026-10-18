import { describe, expect, it } from "vitest";
import { parseEvidenceRefs, validateDecision } from "./holds";

const open = { status: "EN_BLOCAGE" as const, openedBy: "u-opener" };
const goodJustification = "Analyse salmonelle négative sur trois prélèvements.";

describe("validateDecision (R10)", () => {
  it("accepts a different decider with justification and evidence", () => {
    expect(validateDecision(open, "u-quality", goodJustification, ["LAB-2026-044"]).ok).toBe(true);
  });

  it("enforces four-eyes", () => {
    expect(validateDecision(open, "u-opener", goodJustification, ["LAB-1"]).ok).toBe(false);
  });

  it("requires a real justification and at least one evidence reference", () => {
    expect(validateDecision(open, "u-quality", "ok", ["LAB-1"]).ok).toBe(false);
    expect(validateDecision(open, "u-quality", goodJustification, ["  "]).ok).toBe(false);
  });

  it("refuses to decide a closed case", () => {
    expect(validateDecision({ ...open, status: "LIBERE" }, "u-quality", goodJustification, ["LAB-1"]).ok).toBe(false);
  });
});

describe("parseEvidenceRefs", () => {
  it("splits on separators and drops blanks", () => {
    expect(parseEvidenceRefs("RAP-12; LAB-44,\n photo-3 ;;")).toEqual(["RAP-12", "LAB-44", "photo-3"]);
  });
});
