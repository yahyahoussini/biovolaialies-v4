/** RFC 4180 field quoting, plus a leading quote on values a spreadsheet would run as a formula. */
export function csvField(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole file: header, rows, CRLF, and a BOM so Excel opens the UTF-8 accents correctly. */
export function csvDocument(header: string[], rows: (string | number | null | undefined)[][]): string {
  return "﻿" + [header.map(csvField).join(","), ...rows.map((r) => r.map(csvField).join(","))].join("\r\n");
}
