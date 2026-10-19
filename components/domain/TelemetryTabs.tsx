import Link from "next/link";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/telemetrie", label: "Bâtiments" },
  { href: "/telemetrie/regles", label: "Règles" },
  { href: "/telemetrie/bandes", label: "Bandes de référence" },
  { href: "/telemetrie/occupation", label: "Occupation" },
  { href: "/telemetrie/etalonnage", label: "Étalonnage" },
  { href: "/telemetrie/ingestion", label: "Ingestion" },
  { href: "/telemetrie/catalogue", label: "Catalogue capteurs" },
] as const;

/** Section navigation for the telemetry screens (client documents 2 and 3). */
export function TelemetryTabs({ active }: { active: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Télémétrie" className="flex flex-wrap gap-1 border-b border-border pb-2">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === active ? "page" : undefined}
          className={cn(
            "focus-ring rounded-md px-3 py-1.5 text-sm",
            t.href === active ? "bg-bio-green/10 font-semibold text-bio-green" : "text-secondary hover:text-text"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
