import { describe, expect, it } from "vitest";
import { eggsInRange, encodeSerial, isCovered, MAX_SERIAL, parseShellCode, readGuard, shellCode, splitCodes, storageDays, trayError } from "./marking";

describe("code on the shell", () => {
  it("is nine characters a person can read, and decodes back to its line and serial", () => {
    const code = shellCode("FA", 12345);
    expect(code).toHaveLength(9);
    expect(code).toMatch(/^FA[0-9A-HJKMNP-TV-Z]{7}$/);
    expect(parseShellCode(code)).toEqual({ prefix: "FA", serial: 12345, valid: true, code });
    expect(encodeSerial(MAX_SERIAL)).toBe("ZZZZZZ");
  });

  it("refuses a wrong character and a swap of neighbours", () => {
    const code = shellCode("FA", 777);
    const chars = [...code];
    const oneWrong = [...chars];
    oneWrong[4] = oneWrong[4] === "7" ? "8" : "7";
    expect(parseShellCode(oneWrong.join(""))?.valid).toBe(false);
    const swapped = [...chars];
    [swapped[6], swapped[7]] = [swapped[7], swapped[6]];
    if (swapped[6] !== swapped[7]) expect(parseShellCode(swapped.join(""))?.valid).toBe(false);
  });

  it("reads what a person types: spaces, dashes, lower case, O for 0 and I or L for 1", () => {
    const code = shellCode("EA", 1000);
    const typed = `${code.slice(0, 3)} - ${code.slice(3).toLowerCase()}`.replace(/0/g, "o").replace(/1/g, "l");
    expect(parseShellCode(typed)).toMatchObject({ serial: 1000, valid: true });
    expect(parseShellCode("ABC")).toBeNull();
  });

  it("splits what a scanner or a person pastes, once per code", () => {
    expect(splitCodes("FA0000017\nFA0000025, FA0000017 ;FA0000033")).toEqual(["FA0000017", "FA0000025", "FA0000033"]);
  });
});

describe("read-back control", () => {
  const batch = (ok: number, ko: number) => ({ ok, ko });

  it("does not stop a line on a handful of eggs", () => {
    expect(readGuard([batch(5, 5)], 0.98, 500).ok).toBe(true);
    expect(readGuard([], 0.98, 500)).toEqual({ ok: true, rate: null, considered: 0 });
  });

  it("stops the line when the recent read rate falls under the threshold", () => {
    expect(readGuard([batch(495, 5)], 0.98, 500)).toMatchObject({ ok: true, rate: 0.99 });
    const clogged = readGuard([batch(400, 0), batch(70, 30)], 0.98, 500);
    expect(clogged.ok).toBe(false);
    expect(clogged.rate).toBeCloseTo(0.94, 2);
  });

  it("judges the most recent eggs, not the whole day", () => {
    // Two thousand clean eggs this morning do not hide a clogged head now — unless the window is a day long.
    const day = [...Array.from({ length: 20 }, () => batch(100, 0)), ...Array.from({ length: 5 }, () => batch(92, 8))];
    expect(readGuard(day, 0.98, 500)).toMatchObject({ ok: false, considered: 500 });
    expect(readGuard(day, 0.98, 3000)).toMatchObject({ ok: true, considered: 2500 });
  });
});

describe("trays", () => {
  it("counts the eggs packed: the range minus those the camera rejected", () => {
    expect(eggsInRange({ firstSerial: 100, lastSerial: 131 }, [101, 120, 200])).toBe(30);
  });

  it("refuses codes never printed, codes already packed, and an overfull tray", () => {
    const printed = [{ firstSerial: 1, lastSerial: 1000 }];
    expect(trayError({ firstSerial: 990, lastSerial: 1010, capacity: 30 }, printed, [], [])).toMatch(/pas été imprimés/);
    expect(trayError({ firstSerial: 31, lastSerial: 60, capacity: 30 }, printed, [{ firstSerial: 1, lastSerial: 40 }], [])).toMatch(/autre plateau/);
    expect(trayError({ firstSerial: 61, lastSerial: 92, capacity: 30 }, printed, [], [70])).toMatch(/31 œufs/);
    expect(trayError({ firstSerial: 61, lastSerial: 91, capacity: 30 }, printed, [], [70])).toBeNull();
  });

  it("needs every code of the tray read back, across several reports but without a gap", () => {
    expect(isCovered({ firstSerial: 95, lastSerial: 124 }, [{ firstSerial: 0, lastSerial: 99 }, { firstSerial: 100, lastSerial: 199 }])).toBe(true);
    expect(isCovered({ firstSerial: 95, lastSerial: 124 }, [{ firstSerial: 0, lastSerial: 99 }, { firstSerial: 110, lastSerial: 199 }])).toBe(false);
  });

  it("tells how long a hatching egg waited before setting", () => {
    expect(storageDays("2026-09-20T07:00:00Z", "2026-09-22T08:00:00Z")).toBe(2);
  });
});
