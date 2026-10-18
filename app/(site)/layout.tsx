import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata: Metadata = {
  title: { default: "BVU Tech — Traçabilité et pilotage des filières avicoles", template: "%s | BVU Tech" },
  description:
    "BVU Tech : traçabilité, suivi de production et interopérabilité pour les opérateurs avicoles et agroalimentaires au Maroc.",
  openGraph: {
    title: "BVU Tech — Relier les données. Maîtriser les flux. Tracer la production.",
    description: "Traçabilité de la génétique au QR code, pilotage de production et intégration terrain pour la filière avicole.",
    locale: "fr_MA",
    type: "website",
  },
};

/**
 * The public marketing site. Its own header/footer and the BVU Tech brand palette — separate
 * from the control center shell (app/(app)/layout.tsx) and from the QR passport group.
 * Public by design (lib/public-paths.ts); nothing here reads a session.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bvu-paper text-bvu-ink">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-bvu-green focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Aller au contenu
      </a>
      <SiteHeader />
      <main id="contenu" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
