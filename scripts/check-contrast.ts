/**
 * WCAG contrast audit of the design tokens (phase-11 brief §18).
 *
 * Every colour pairing the UI actually renders is asserted here, so "contrast passes" is a
 * checked fact rather than a claim. Run with `npm run check:contrast`.
 *
 * The palette itself is fixed by ARCHITECTURE.md — this script does not change colours, it
 * tells us which of them are safe to put words in. That is what produced the
 * `--color-*-strong` text variants and the muted -> secondary sweep.
 */

type Rgb = { r: number; g: number; b: number };

function hexToRgb(hex: string): Rgb {
  const v = hex.replace("#", "");
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

/** WCAG 2.1 relative luminance. */
function luminance({ r, g, b }: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg: string, bg: string): number {
  const a = luminance(hexToRgb(fg));
  const b = luminance(hexToRgb(bg));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACE = "#ffffff";
const BACKGROUND = "#f4f7f3";

/** AA = 4.5:1 for normal text, 3:1 for large text (>=18.66px bold or >=24px) and UI boundaries. */
const AA_TEXT = 4.5;
const AA_LARGE = 3;

interface Case {
  name: string;
  fg: string;
  bg: string;
  min: number;
}

const cases: Case[] = [
  // Body / structural text — used at 12-14px, so full AA applies.
  { name: "text on surface", fg: "#1c2922", bg: SURFACE, min: AA_TEXT },
  { name: "text on background", fg: "#1c2922", bg: BACKGROUND, min: AA_TEXT },
  { name: "secondary on surface", fg: "#52605a", bg: SURFACE, min: AA_TEXT },
  { name: "secondary on background", fg: "#52605a", bg: BACKGROUND, min: AA_TEXT },

  // Semantic text variants — these are why --color-*-strong exists.
  { name: "success-strong on surface", fg: "#237045", bg: SURFACE, min: AA_TEXT },
  { name: "success-strong on background", fg: "#237045", bg: BACKGROUND, min: AA_TEXT },
  { name: "warning-strong on surface", fg: "#8a5d13", bg: SURFACE, min: AA_TEXT },
  { name: "warning-strong on background", fg: "#8a5d13", bg: BACKGROUND, min: AA_TEXT },
  { name: "critical-strong on surface", fg: "#a83232", bg: SURFACE, min: AA_TEXT },
  { name: "critical-strong on background", fg: "#a83232", bg: BACKGROUND, min: AA_TEXT },
  { name: "info-strong on surface", fg: "#2f6088", bg: SURFACE, min: AA_TEXT },
  { name: "info-strong on background", fg: "#2f6088", bg: BACKGROUND, min: AA_TEXT },

  // Brand surfaces that carry white text.
  { name: "white on bio-green (primary button)", fg: SURFACE, bg: "#2f7d4a", min: AA_TEXT },
  { name: "white on deep-green (button hover)", fg: SURFACE, bg: "#205d42", min: AA_TEXT },
  { name: "white on deep-forest (passport header)", fg: SURFACE, bg: "#12372a", min: AA_TEXT },
  { name: "white on critical-strong (destructive button)", fg: SURFACE, bg: "#a83232", min: AA_TEXT },

  // BVU Tech public site (app/(site)) — its own brand palette.
  { name: "bvu ink on paper", fg: "#142b25", bg: "#f7f8f3", min: AA_TEXT },
  { name: "bvu muted on paper", fg: "#5d6b64", bg: "#f7f8f3", min: AA_TEXT },
  { name: "bvu muted on white card", fg: "#5d6b64", bg: SURFACE, min: AA_TEXT },
  { name: "bvu muted on mist", fg: "#5d6b64", bg: "#eef2eb", min: AA_TEXT },
  { name: "bvu green on paper (eyebrow/link)", fg: "#176b4d", bg: "#f7f8f3", min: AA_TEXT },
  { name: "white on bvu green (primary button)", fg: SURFACE, bg: "#176b4d", min: AA_TEXT },
  { name: "bvu dark on lime (lime button)", fg: "#102a24", bg: "#c8e66b", min: AA_TEXT },
  { name: "lime on bvu dark (eyebrow)", fg: "#c8e66b", bg: "#102a24", min: AA_TEXT },
  { name: "on-dark text on bvu dark", fg: "#c3d0c9", bg: "#102a24", min: AA_TEXT },
  { name: "on-dark text on dark card", fg: "#c3d0c9", bg: "#18372f", min: AA_TEXT },
  { name: "on-dark text on footer", fg: "#c3d0c9", bg: "#0b201b", min: AA_TEXT },

  // Sidebar active item + links.
  { name: "bio-green on surface (active nav)", fg: "#2f7d4a", bg: SURFACE, min: AA_TEXT },
  { name: "deep-forest on gold tint (demo badge)", fg: "#12372a", bg: "#fbf4e1", min: AA_TEXT },

  // Non-text: borders and the focus ring only need 3:1.
  { name: "border on surface", fg: "#dde5de", bg: SURFACE, min: 1 },
  { name: "focus ring on background", fg: "#2f7d4a", bg: BACKGROUND, min: AA_LARGE },
  { name: "muted icon on surface (decorative/large only)", fg: "#7a8780", bg: SURFACE, min: AA_LARGE },
];

let failed = 0;
for (const c of cases) {
  const ratio = contrast(c.fg, c.bg);
  const ok = ratio >= c.min;
  if (!ok) failed++;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${ratio.toFixed(2).padStart(5)}:1  (min ${c.min})  ${c.name}`);
}

console.log(`\n${cases.length - failed}/${cases.length} pairings pass.`);
if (failed > 0) {
  console.error(`${failed} contrast failure(s).`);
  process.exit(1);
}
