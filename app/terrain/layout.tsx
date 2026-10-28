import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "BIOVOLAILLES — Terrain",
  description: "Saisie terrain hors ligne.",
  appleWebApp: { capable: true, title: "BV Terrain", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#12372a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** The field app has no office chrome: a phone screen, the person's lots, their entries. */
export default function FieldLayout({ children }: LayoutProps<"/terrain">) {
  return children;
}
