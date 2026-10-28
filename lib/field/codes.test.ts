import { describe, expect, it } from "vitest";
import { formatBvuId } from "../../domain/identity/bvu-id-format";
import { lookupCode, normalizeCode } from "./codes";

const lotId = formatBvuId("FLK", "ED83048253CBB");
const snapshot = {
  codes: [
    { code: "REP-2026-03", kind: "LOT" as const, id: "l1", lotId: "l1", label: "REP-2026-03" },
    { code: lotId, kind: "LOT" as const, id: "l1", lotId: "l1", label: "REP-2026-03" },
    { code: "E28011AA", kind: "SUBJECT" as const, id: "s1", lotId: "l1", label: "Sujet R26-0001" },
  ],
};

describe("reading codes offline", () => {
  it("finds a lot by its code or its identifier, whatever the case and spacing", () => {
    expect(lookupCode(snapshot, " rep-2026-03 ")).toMatchObject({ status: "FOUND", match: { id: "l1" } });
    expect(lookupCode(snapshot, lotId.toLowerCase())).toMatchObject({ status: "FOUND" });
    expect(lookupCode(snapshot, "e2 80 11 aa")).toMatchObject({ status: "FOUND", match: { kind: "SUBJECT" } });
  });

  it("refuses an identifier read wrong instead of looking it up", () => {
    const wrong = lotId.slice(0, -1) + (lotId.endsWith("0") ? "1" : "0");
    expect(lookupCode(snapshot, wrong)).toEqual({ status: "BAD_CHECK", code: wrong });
  });

  it("takes the code at the end of a link printed in a QR", () => {
    expect(normalizeCode("https://biovolailles.ma/terrain/REP-2026-03?src=etiquette")).toBe("REP-2026-03");
  });

  it("says when a code is unknown on this phone", () => {
    expect(lookupCode(snapshot, "XYZ-1")).toEqual({ status: "UNKNOWN", code: "XYZ-1" });
    expect(lookupCode(snapshot, "   ")).toEqual({ status: "EMPTY" });
  });
});
