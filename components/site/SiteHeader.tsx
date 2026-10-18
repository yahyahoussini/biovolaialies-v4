import Link from "next/link";
import { BrandMark } from "./BrandMark";

const NAV = [
  { href: "/#solution", label: "Solution" },
  { href: "/#tracabilite", label: "Traçabilité" },
  { href: "/#demonstration", label: "Démonstration" },
  { href: "/#methode", label: "Déploiement" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-bvu-line bg-bvu-paper/95 backdrop-blur">
      <div className="mx-auto flex min-h-[72px] w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3 font-extrabold text-bvu-ink" aria-label="BVU Tech — accueil">
          <BrandMark />
          <span className="leading-tight">
            BVU TECH
            <small className="block text-[11px] font-bold tracking-[0.18em] text-bvu-muted">AGRI-TECH B2B</small>
          </span>
        </Link>
        <nav aria-label="Navigation du site" className="flex items-center gap-5 text-sm font-medium text-bvu-ink">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hidden hover:text-bvu-green md:inline">
              {item.label}
            </Link>
          ))}
          <Link href="/login" className="hidden hover:text-bvu-green sm:inline">
            Espace client
          </Link>
          <Link
            href="/#contact"
            className="rounded-full bg-bvu-green px-4 py-2.5 text-sm font-bold text-white transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bvu-ink"
          >
            Demander un échange
          </Link>
        </nav>
      </div>
    </header>
  );
}
