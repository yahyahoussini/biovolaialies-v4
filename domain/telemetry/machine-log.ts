/**
 * Incubator logs imported from a file (document 3, lot 13: "intégration machines : Modbus, API
 * constructeur, import de fichiers"). Which of the three an incubator allows is unknown until its
 * plate is read (document 2, ch. 07); a file export is the path that works whatever the answer.
 * Vendors write their logs their own way, so the reading is driven by a profile: separator, decimal
 * mark, time column(s) and format, time zone, and which column holds which channel. The profile is
 * guessed from the file and shown before anything is stored; nothing is guessed silently.
 * Pure, no I/O, and free of server-only imports: the browser runs the same reading for the preview.
 */

export type Delimiter = ";" | "," | "\t";
export type DecimalMark = "," | ".";
export const TIME_FORMATS = ["ISO", "JJ/MM/AAAA HH:MM", "AAAA-MM-JJ HH:MM", "MM/JJ/AAAA HH:MM"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

/**
 * The clock the machine writes in. Morocco moves to UTC+0 during Ramadan; a machine set once and
 * never touched stays on UTC+1 all year, and its Ramadan lines would be an hour off if read as
 * legal time. Which one an incubator uses is asked on site, not assumed.
 */
export const LOG_TIME_ZONES = ["Africa/Casablanca", "Etc/GMT-1", "UTC"] as const;
export type LogTimeZone = (typeof LOG_TIME_ZONES)[number];
export const LOG_TIME_ZONE_LABEL: Record<LogTimeZone, string> = {
  "Africa/Casablanca": "Heure légale du Maroc (UTC+0 au Ramadan)",
  "Etc/GMT-1": "UTC+1 fixe (horloge réglée une fois, jamais changée)",
  UTC: "UTC",
};

export interface LogProfile {
  delimiter: Delimiter;
  decimal: DecimalMark;
  /** One column ("Horodatage"), or two read together ("Date" then "Heure"). */
  timeColumns: string[];
  timeFormat: TimeFormat;
  timeZone: LogTimeZone;
  /** Channel (sensor type) → column holding its values. */
  channels: Record<string, string>;
}

export interface ParsedLog {
  header: string[];
  /** Lines above the header (machine name, serial number, export date), shown, never read as data. */
  preamble: string[];
  rows: { line: number; at: string; values: Record<string, number> }[];
  errors: { line: number; message: string }[];
  /** Data lines met, read or not. */
  lines: number;
  from: string | null;
  to: string | null;
}

export const MAX_LINE_ERRORS = 200;
/** Written above the header of the example file: an example is never imported as real data. */
export const SAMPLE_MARKER = "#BIOVOLAILLES-EXEMPLE";

/** Splits one CSV line, honouring double-quoted fields. */
export function splitLine(line: string, delimiter: Delimiter): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      out.push(field.trim());
      field = "";
    } else field += c;
  }
  out.push(field.trim());
  return out;
}

function lines(text: string): string[] {
  return text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
}

/**
 * The bytes of the file as text. French machines often write Windows-1252 ("°C" as one byte), which
 * is not valid UTF-8: UTF-8 is tried strictly first, then Windows-1252. Server and browser decode alike.
 */
export function decodeLogBytes(bytes: Uint8Array): { text: string; encoding: "UTF-8" | "Windows-1252" } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "Windows-1252" };
  }
}

const SAMPLE_LINES = 30;

type Sample = { l: string; i: number }[];

const sampleOf = (all: string[]): Sample =>
  all
    .map((l, i) => ({ l, i }))
    .filter((x) => x.l.trim())
    .slice(0, SAMPLE_LINES);

/** The most common field count above one for a separator, and the first line with it — or null when no count repeats. */
function layoutFor(sample: Sample, d: Delimiter): { headerLine: number; fields: number; support: number } | null {
  const counts = sample.map((x) => splitLine(x.l, d).length);
  const freq = new Map<number, number>();
  for (const c of counts) if (c > 1) freq.set(c, (freq.get(c) ?? 0) + 1);
  let fields = 0;
  let support = 0;
  for (const [c, n] of freq) if (n > support || (n === support && c > fields)) [fields, support] = [c, n];
  // A field count shared by one line only says nothing about the file.
  if (fields === 0 || support < Math.min(2, sample.length)) return null;
  return { headerLine: sample[counts.indexOf(fields)].i, fields, support };
}

/**
 * Separator and header line. A machine export may open with a few lines of its own (model, serial
 * number, export date), so the header is not assumed to be the first line: for each separator the
 * most common field count among the first lines is taken, and the header is the first line with it.
 */
export function detectLayout(text: string): { delimiter: Delimiter; headerLine: number } {
  const sample = sampleOf(lines(text));
  let best = { delimiter: ";" as Delimiter, headerLine: sample[0]?.i ?? 0, fields: 0, support: 0 };
  for (const d of [";", "\t", ","] as const) {
    const layout = layoutFor(sample, d);
    if (layout && (layout.fields > best.fields || (layout.fields === best.fields && layout.support > best.support))) best = { delimiter: d, ...layout };
  }
  return { delimiter: best.delimiter, headerLine: best.headerLine };
}

/** The header as read with a given separator: what the screen offers once the user changes it. */
export function headerFor(text: string, delimiter: Delimiter): string[] {
  const all = lines(text);
  const sample = sampleOf(all);
  const layout = layoutFor(sample, delimiter);
  return splitLine(layout ? all[layout.headerLine] : (sample[0]?.l ?? ""), delimiter);
}

/** True when the file is the example the platform hands out. */
export function isSampleLog(text: string): boolean {
  return lines(text)
    .slice(0, 10)
    .some((l) => l.trim().startsWith(SAMPLE_MARKER));
}

export function parseNumber(raw: string, decimal: DecimalMark): number | null {
  const cleaned = raw.replace(/[\s  ]/g, "");
  if (!cleaned) return null;
  const normalized = decimal === "," ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  if (!/^[-+]?\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

/** Offset, in milliseconds, of a time zone at an instant (local minus UTC), from the platform's time-zone data. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(utcMs / 1000) * 1000;
}

const DAY_MS = 86_400_000;

/**
 * The instants a wall-clock time stands for in a zone, earliest first: usually one; two in the hour
 * repeated when the clock goes back (Morocco, the Sunday before Ramadan: 03:00 becomes 02:00); none
 * in the hour skipped when it goes forward again after Ramadan. The zone data knows the dates.
 */
export function zonedCandidates(y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string): number[] {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const out: number[] = [];
  // The offsets in force a day either side cover both sides of any change near this time.
  for (const offset of new Set([zoneOffsetMs(wall - DAY_MS, timeZone), zoneOffsetMs(wall + DAY_MS, timeZone)])) {
    const t = wall - offset;
    if (zoneOffsetMs(t, timeZone) === offset && !out.includes(t)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/** A wall-clock time in a zone, as an instant — the earlier one in a repeated hour; null when the time never happened. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string): number | null {
  return zonedCandidates(y, mo, d, h, mi, s, timeZone)[0] ?? null;
}

/** A date that exists in the calendar: 31/02 is refused, never rolled over to 3 March. */
const valid = (y: number, mo: number, d: number, h: number, mi: number, s: number) =>
  y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && new Date(Date.UTC(y, mo - 1, d)).getUTCDate() === d && h <= 23 && mi <= 59 && s <= 59;

/** Every instant a time written in the log can stand for; null when it cannot be read at all. */
export function parseTimeCandidates(raw: string, format: TimeFormat, timeZone: string): number[] | null {
  const v = raw.trim();
  if (format === "ISO") {
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
      const t = Date.parse(v.replace(" ", "T"));
      return Number.isNaN(t) ? null : [t];
    }
    format = "AAAA-MM-JJ HH:MM";
  }
  const m =
    format === "AAAA-MM-JJ HH:MM"
      ? /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(v)
      : /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(v);
  if (!m) return null;
  const n = m.slice(1).map((x) => Number(x ?? 0));
  const [y, mo, d] = format === "AAAA-MM-JJ HH:MM" ? [n[0], n[1], n[2]] : format === "JJ/MM/AAAA HH:MM" ? [n[2], n[1], n[0]] : [n[2], n[0], n[1]];
  const [h, mi, s] = [n[3], n[4], n[5] || 0];
  if (!valid(y, mo, d, h, mi, s)) return null;
  return zonedCandidates(y, mo, d, h, mi, s, timeZone);
}

/** The instant a time stands for — the earlier one in a repeated hour; null when unreadable or when that time never happened. */
export function parseTime(raw: string, format: TimeFormat, timeZone: string): number | null {
  return parseTimeCandidates(raw, format, timeZone)?.[0] ?? null;
}

/**
 * Guesses a profile from the file: separator, header line, decimal mark, the time column(s) and
 * their format, and the columns holding numbers. A day-first date is assumed when nothing in the
 * file tells day from month (French machines write JJ/MM) — and the preview says it was assumed.
 */
export function guessProfile(text: string, timeZone: LogTimeZone = "Africa/Casablanca"): { profile: LogProfile; header: string[]; numericColumns: string[]; assumedDayFirst: boolean } {
  const { delimiter, headerLine } = detectLayout(text);
  const all = lines(text);
  const header = splitLine(all[headerLine] ?? "", delimiter);
  const body = all
    .slice(headerLine + 1)
    .filter((l) => l.trim())
    .slice(0, 50)
    .map((l) => splitLine(l, delimiter));
  const decimal: DecimalMark = delimiter === "," ? "." : body.some((r) => r.some((c) => /^-?\d+,\d+$/.test(c))) ? "," : ".";
  const column = (i: number) => body.map((r) => r[i] ?? "");

  const dateTime = header.findIndex((_, i) => column(i).every((v) => /\d{1,4}[/-]\d{1,2}[/-]\d{1,4}[ T]\d{1,2}:\d{2}/.test(v)));
  const dateOnly = header.findIndex((_, i) => column(i).every((v) => /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(v)));
  const timeOnly = header.findIndex((_, i) => column(i).every((v) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(v)));
  const timeColumns = dateTime >= 0 ? [header[dateTime]] : dateOnly >= 0 && timeOnly >= 0 ? [header[dateOnly], header[timeOnly]] : [];
  const sample = timeColumns.length ? body.map((r) => timeColumns.map((c) => r[header.indexOf(c)] ?? "").join(" ")) : [];

  let timeFormat: TimeFormat = "JJ/MM/AAAA HH:MM";
  let assumedDayFirst = false;
  if (sample.every((v) => /^\d{4}-/.test(v))) timeFormat = /[zZ]|[+-]\d{2}:?\d{2}$/.test(sample[0] ?? "") ? "ISO" : "AAAA-MM-JJ HH:MM";
  else if (sample.some((v) => Number(v.split("/")[1]) > 12)) timeFormat = "MM/JJ/AAAA HH:MM";
  else if (!sample.some((v) => Number(v.split("/")[0]) > 12)) assumedDayFirst = true;

  const used = new Set(timeColumns);
  // Numeric when most filled cells read as numbers: machines write "ERR" or "---" when a probe faults,
  // and those cells are reported line by line at import rather than hiding the column.
  const numericColumns = header.filter((h, i) => {
    const filled = column(i).filter((v) => v !== "");
    return !used.has(h) && filled.length > 0 && filled.filter((v) => parseNumber(v, decimal) !== null).length > filled.length / 2;
  });
  // The displayed air temperature: a temperature column that is not a set point.
  const temperature = numericColumns.find((h) => /temp|t\s*air|°c/i.test(h) && !/consigne|set|cible/i.test(h));
  return { profile: { delimiter, decimal, timeColumns, timeFormat, timeZone, channels: temperature ? { TEMPERATURE_MACHINE: temperature } : {} }, header, numericColumns, assumedDayFirst };
}

/** Reads every line with the profile. A line that cannot be read is reported with its number, never dropped in silence. */
export function parseLog(text: string, profile: LogProfile): ParsedLog {
  const all = lines(text);
  // The header is the first line naming the time column(s): whatever the machine wrote above it is preamble.
  const headerIndex = all.findIndex((l) => {
    const cells = splitLine(l, profile.delimiter);
    return l.trim() !== "" && profile.timeColumns.length > 0 && profile.timeColumns.every((c) => cells.includes(c));
  });
  const errors: ParsedLog["errors"] = [];
  const rows: ParsedLog["rows"] = [];
  const empty = (message: string): ParsedLog => ({ header: [], preamble: [], rows, errors: [{ line: 1, message }], lines: 0, from: null, to: null });
  if (headerIndex < 0) return empty(`Colonne d'horodatage « ${profile.timeColumns.join(" + ") || "?"} » introuvable dans le fichier.`);
  const header = splitLine(all[headerIndex], profile.delimiter);
  const preamble = all.slice(0, headerIndex).filter((l) => l.trim());
  const timeIdx = profile.timeColumns.map((c) => header.indexOf(c));
  const channelIdx = Object.entries(profile.channels).map(([channel, col]) => [channel, header.indexOf(col)] as const);
  const report = (line: number, message: string) => {
    if (errors.length < MAX_LINE_ERRORS) errors.push({ line, message });
  };
  for (const [channel, i] of channelIdx) if (i < 0) report(headerIndex + 1, `Colonne « ${profile.channels[channel]} » introuvable dans l'en-tête.`);

  let count = 0;
  let previous = Number.NEGATIVE_INFINITY;
  const seen = new Map<number, number>();
  for (let n = headerIndex + 1; n < all.length; n++) {
    if (!all[n].trim()) continue;
    count++;
    const cells = splitLine(all[n], profile.delimiter);
    const stamp = timeIdx.map((i) => cells[i] ?? "").join(" ");
    const candidates = parseTimeCandidates(stamp, profile.timeFormat, profile.timeZone);
    if (candidates === null) {
      report(n + 1, `Horodatage illisible : « ${stamp} ».`);
      continue;
    }
    if (candidates.length === 0) {
      report(n + 1, `Heure qui n'existe pas ce jour-là, l'heure légale ayant avancé : « ${stamp} ». L'horloge de la machine suit-elle l'heure légale ?`);
      continue;
    }
    // In the hour repeated when the clock goes back, a time stands for two instants: the log's own order says which.
    const t = candidates.find((c) => c >= previous) ?? candidates[candidates.length - 1];
    previous = t;
    // One value per instant: a second line with the same stamp (logging faster than the minute it
    // writes, or a repeated line) is reported, never stored over the first.
    const first = seen.get(t);
    if (first !== undefined) {
      report(n + 1, `Même horodatage que la ligne ${first} (« ${stamp} ») : ligne non lue.`);
      continue;
    }
    const values: Record<string, number> = {};
    for (const [channel, i] of channelIdx) {
      if (i < 0) continue;
      const raw = cells[i] ?? "";
      const v = parseNumber(raw, profile.decimal);
      if (v === null) report(n + 1, `Valeur illisible pour ${profile.channels[channel]} : « ${raw} ».`);
      else values[channel] = v;
    }
    if (Object.keys(values).length) {
      rows.push({ line: n + 1, at: new Date(t).toISOString(), values });
      seen.set(t, n + 1);
    }
  }
  const times = rows.map((r) => r.at).sort();
  return { header, preamble, rows, errors, lines: count, from: times[0] ?? null, to: times[times.length - 1] ?? null };
}
