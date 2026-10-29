import Link from "next/link";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/equipements", label: "Registre par unité" },
  { href: "/equipements/nomenclature", label: "Nomenclature d'achat" },
  { href: "/equipements/recette", label: "Mise en service" },
] as const;

/** Section navigation for the equipment screens (document 2 and the client's register). */
export function EquipmentTabs({ active }: { active: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Équipements" className="flex flex-wrap gap-1 border-b border-border pb-2">
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
