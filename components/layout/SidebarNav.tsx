"use client";

import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Bell,
  Bird,
  Building2,
  ClipboardCheck,
  Egg,
  Inbox,
  KeyRound,
  Link2,
  Map,
  ShieldAlert,
  Wrench,
  History,
  LayoutDashboard,
  Radio,
  Settings,
  ShieldCheck,
  UserCog,
  UserRound,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * Icon components can't be passed as props from a Server Component into a Client
 * Component (functions aren't serializable across that boundary) — so NavItem carries
 * an icon *name*, and this client-only map resolves it locally.
 */
const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  organizations: Building2,
  cooperatives: Users,
  producers: UserRound,
  farms: Warehouse,
  lots: Bird,
  iot: Radio,
  anomalies: AlertTriangle,
  alerts: Bell,
  administration: ShieldCheck,
  users: UserCog,
  audit: History,
  integrity: BadgeCheck,
  settings: Settings,
  demo: Activity,
  leads: Inbox,
  quality: ShieldAlert,
  hatchery: Egg,
  equipment: Wrench,
  commissioning: ClipboardCheck,
  programme: Map,
  ledger: Link2,
  apiClients: KeyRound,
};
export type NavIconName = keyof typeof ICONS;

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconName;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * `/fermes` must not light up while on `/fermes/x/batiments` *and* `/lots` at once, and a
 * prefix test alone would mark `/administration` active on `/administration/demo` as well as
 * its child entry. Longest matching href wins; exact match always wins.
 */
function isActive(pathname: string, href: string, allHrefs: string[]): boolean {
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  return !allHrefs.some((other) => other !== href && other.startsWith(`${href}/`) && (pathname === other || pathname.startsWith(`${other}/`)));
}

/** Nav list shared by the desktop sidebar and the mobile drawer — one source of truth. */
export function SidebarNav({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const allHrefs = sections.flatMap((s) => s.items.map((i) => i.href));

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Navigation principale">
      {sections.map((section) => (
        <div key={section.label} className="mb-5 last:mb-0">
          <p className="mb-1.5 px-2.5 text-micro font-semibold uppercase tracking-widest text-secondary">
            {section.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href, allHrefs);
              const Icon = ICONS[item.icon];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "focus-ring relative flex items-center gap-2.5 rounded-md py-2 pl-3 pr-2.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-bio-green/10 text-deep-green"
                        : "text-secondary hover:bg-background hover:text-text"
                    )}
                  >
                    {/* Active state is a bar + weight change, not colour alone (§18). */}
                    {active ? (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-bio-green" aria-hidden="true" />
                    ) : null}
                    <Icon className={cn("size-4 shrink-0", active ? "text-bio-green" : "text-secondary")} aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function SidebarBrand({ demoMode }: { demoMode: boolean }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-bio-green text-micro font-bold tracking-wider text-white">
        BV
      </span>
      <span className="text-sm font-semibold tracking-tight text-text">BIOVOLAILLES</span>
      {demoMode ? (
        <span className="ml-auto rounded-full border border-gold/45 bg-gold/15 px-1.5 py-0.5 text-micro font-bold tracking-wide text-deep-forest">
          DÉMO
        </span>
      ) : null}
    </div>
  );
}
