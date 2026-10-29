import { describe, expect, it } from "vitest";
import { compareMachineWithProbes } from "./machine-compare";
import { decodeLogBytes, guessProfile, isSampleLog, parseLog, parseNumber, splitLine } from "./machine-log";
import { buildSampleLog, toWindows1252 } from "./machine-sample";

const french = ["Date;Heure;T air (°C);Consigne T (°C);HR (%);Retournements", "22/09/2026;10:00;37,6;37,8;55;1", "22/09/2026;10:05;37,7;37,8;56;1", "22/09/2026;10:10;;37,8;56;1", "22/09/2026;10:15;ERR;37,8;56;1", "31/02/2026;10:20;37,6;37,8;56;1"].join("\r\n");

describe("incubator log import", () => {
  it("recognises a French export: semicolons, decimal commas, date and time in two columns", () => {
    const { profile, numericColumns, assumedDayFirst } = guessProfile(french);
    expect(profile).toMatchObject({ delimiter: ";", decimal: ",", timeColumns: ["Date", "Heure"], timeFormat: "JJ/MM/AAAA HH:MM", channels: { TEMPERATURE_MACHINE: "T air (°C)" } });
    expect(numericColumns).toEqual(expect.arrayContaining(["Consigne T (°C)", "HR (%)"]));
    // 22/09 cannot be a month-first date: nothing was assumed.
    expect(assumedDayFirst).toBe(false);
  });

  it("reads Moroccan local time, Ramadan included, and reports every line it cannot read", () => {
    const { profile } = guessProfile(french);
    const log = parseLog(french, profile);
    expect(log.rows.map((r) => [r.at, r.values.TEMPERATURE_MACHINE])).toEqual([
      ["2026-09-22T09:00:00.000Z", 37.6],
      ["2026-09-22T09:05:00.000Z", 37.7],
    ]);
    expect(log.errors.map((e) => e.line)).toEqual([4, 5, 6]);
    expect(log.errors[1].message).toMatch(/ERR/);
    expect(log.errors[2].message).toMatch(/Horodatage illisible/);
    const ramadan = parseLog("Date;Heure;T air (°C)\n01/03/2026;10:00;37,5", profile);
    expect(ramadan.rows[0].at).toBe("2026-03-01T10:00:00.000Z");
  });

  it("takes an ISO export as written, and tells a month-first file from its days", () => {
    const iso = "timestamp,air_temp_c\n2026-09-22T08:00:00Z,37.6\n2026-09-22T08:05:00+01:00,37.7";
    const g = guessProfile(iso);
    expect(g.profile).toMatchObject({ delimiter: ",", decimal: ".", timeColumns: ["timestamp"], timeFormat: "ISO", channels: { TEMPERATURE_MACHINE: "air_temp_c" } });
    expect(parseLog(iso, g.profile).rows.map((r) => r.at)).toEqual(["2026-09-22T08:00:00.000Z", "2026-09-22T07:05:00.000Z"]);
    expect(guessProfile("Time;Temp\n09/22/2026 10:00;37,6").profile.timeFormat).toBe("MM/JJ/AAAA HH:MM");
    expect(guessProfile("Horodatage;Temp\n05/09/2026 10:00;37,6").assumedDayFirst).toBe(true);
  });

  it("splits quoted fields and reads numbers in either convention", () => {
    expect(splitLine('"a;b";"c ""d""";3', ";")).toEqual(["a;b", 'c "d"', "3"]);
    expect(parseNumber("1 234,5", ",")).toBe(1234.5);
    expect(parseNumber("1,234.5", ".")).toBe(1234.5);
    expect(parseNumber("37°", ",")).toBeNull();
  });

  it("skips the lines a machine writes above its header, and reads a Windows-1252 file", () => {
    const text = ["Petersime S-576 n° 4411", "Export du 22/09/2026 12:00", "", "Date;Heure;T air (°C);HR (%)", "22/09/2026;10:00;37,6;55", "22/09/2026;10:01;37,7;55"].join("\r\n");
    const bytes = toWindows1252(text);
    // "°" is one byte (0xB0) in Windows-1252, which is not valid UTF-8.
    expect(bytes.includes(0xb0)).toBe(true);
    const decoded = decodeLogBytes(bytes);
    expect(decoded.encoding).toBe("Windows-1252");
    expect(decodeLogBytes(new TextEncoder().encode(text)).encoding).toBe("UTF-8");
    const { profile, header } = guessProfile(decoded.text);
    expect(header).toEqual(["Date", "Heure", "T air (°C)", "HR (%)"]);
    expect(profile.channels).toEqual({ TEMPERATURE_MACHINE: "T air (°C)" });
    const log = parseLog(decoded.text, profile);
    expect(log.preamble).toEqual(["Petersime S-576 n° 4411", "Export du 22/09/2026 12:00"]);
    expect(log.rows.map((r) => r.values.TEMPERATURE_MACHINE)).toEqual([37.6, 37.7]);
    expect(log.errors).toEqual([]);
  });

  it("reads a clock left on UTC+1 through Ramadan an hour apart from legal time", () => {
    const text = "Date;Heure;T air (°C)\n01/03/2026;10:00;37,5";
    const { profile } = guessProfile(text);
    expect(parseLog(text, profile).rows[0].at).toBe("2026-03-01T10:00:00.000Z");
    expect(parseLog(text, { ...profile, timeZone: "Etc/GMT-1" }).rows[0].at).toBe("2026-03-01T09:00:00.000Z");
    expect(parseLog(text, { ...profile, timeZone: "UTC" }).rows[0].at).toBe("2026-03-01T10:00:00.000Z");
  });

  it("tells the two passes of the hour repeated when the clock goes back, and reports the hour that never was", () => {
    // 15/02/2026, before Ramadan: at 03:00 legal time the clock went back to 02:00 (UTC+1 → UTC+0).
    const times = ["01:59", "02:00", "02:30", "02:59", "02:00", "02:30", "02:59", "03:00"];
    const text = ["Date;Heure;T air (°C)", ...times.map((t, i) => `15/02/2026;${t};37,${i}`)].join("\n");
    const { profile } = guessProfile(text);
    const log = parseLog(text, profile);
    expect(log.errors).toEqual([]);
    expect(log.rows.map((r) => r.at.slice(11, 16))).toEqual(["00:59", "01:00", "01:30", "01:59", "02:00", "02:30", "02:59", "03:00"]);
    // 22/03/2026, after Ramadan: the clock went from 02:00 to 03:00, so a machine writing 02:30 is not on legal time.
    const gap = parseLog("Date;Heure;T air (°C)\n22/03/2026;01:59;37,5\n22/03/2026;02:30;37,5\n22/03/2026;03:00;37,5", profile);
    expect(gap.rows.map((r) => r.at.slice(11, 16))).toEqual(["01:59", "02:00"]);
    expect(gap.errors).toEqual([expect.objectContaining({ line: 3, message: expect.stringContaining("n'existe pas") })]);
  });

  it("reports a line stamped like the one before instead of keeping two values for one instant", () => {
    const text = "Date;Heure;T air (°C)\n22/09/2026;10:00;37,6\n22/09/2026;10:00;37,7\n22/09/2026;10:01;37,6";
    const log = parseLog(text, guessProfile(text).profile);
    expect(log.rows.map((r) => r.values.TEMPERATURE_MACHINE)).toEqual([37.6, 37.6]);
    expect(log.errors).toEqual([{ line: 3, message: expect.stringContaining("ligne 2") }]);
  });

  it("produces an example the reader recognises as such, with its faults reported", () => {
    const to = Date.parse("2026-08-16T12:00:00.000Z");
    const sample = buildSampleLog({ machine: "COUV01-INC-1", from: to - 3_600_000, to, driftFrom: to - 1_800_000, faultMinutes: [5], marker: true });
    expect(isSampleLog(sample)).toBe(true);
    expect(isSampleLog(buildSampleLog({ machine: "x", from: to - 120_000, to, marker: false }))).toBe(false);
    const { profile } = guessProfile(decodeLogBytes(toWindows1252(sample)).text);
    const log = parseLog(sample, profile);
    expect(log.lines).toBe(60);
    expect(log.rows).toHaveLength(59);
    expect(log.errors).toEqual([expect.objectContaining({ message: expect.stringContaining("ERR") })]);
    // Written in local time (UTC+1 in August) and read back with the zone: 12:00 on the file is 11:00 UTC.
    expect(log.from).toBe("2026-08-16T11:00:00.000Z");
    // The display drifts up over the last half hour, towards +0.7 °C.
    expect(log.rows[log.rows.length - 1].values.TEMPERATURE_MACHINE).toBeGreaterThan(38.1);
  });
});

describe("machine against the independent probes", () => {
  it("compares hour by hour with the trolley probes, leaving the return air out", () => {
    const h = (i: number) => new Date(Date.UTC(2026, 7, 16, i)).toISOString();
    const probes = [0, 1, 2].flatMap((i) => [
      { at: h(i), mean: 37.6, position: "HAUT" },
      { at: h(i), mean: 37.5, position: "BAS" },
      { at: h(i), mean: 36.9, position: "REPRISE" },
    ]);
    const c = compareMachineWithProbes(
      [
        { at: h(0), mean: 37.6 },
        { at: h(1), mean: 38.05 },
        { at: h(2), mean: 38.2 },
        { at: h(3), mean: 37.6 },
      ],
      probes,
      0.5
    );
    expect(c.hours.map((x) => [x.probes, x.gap, x.beyond])).toEqual([
      [37.55, 0.05, false],
      // Exactly the tolerance, as displayed: not beyond it.
      [37.55, 0.5, false],
      [37.55, 0.65, true],
    ]);
    expect(c).toMatchObject({ machineOnly: 1, beyond: 1, maxGap: 0.65, firstBeyondAt: h(2) });
  });
});
