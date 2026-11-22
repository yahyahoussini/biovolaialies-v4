import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/(app)/actions";
import { MobileNav } from "@/components/layout/MobileNav";
import { RoleSwitcher } from "@/components/layout/RoleSwitcher";
import type { NavSection } from "@/components/layout/SidebarNav";
import { Button } from "@/components/ui/Button";
import type { Role } from "@/domain/shared/enums";
import type { ScopeDescriptor } from "@/services/identity/scope-label";

export function Topbar({
  fullName,
  roleLabel,
  role,
  isDemoSwitch,
  demoMode,
  roleSwitch,
  scope,
  sections,
}: {
  fullName: string;
  roleLabel: string;
  role: Role;
  isDemoSwitch: boolean;
  /** Environment-level flag (lib/env.ts). Keeps the whole dataset visibly labelled as a demonstration — phase-10 brief §21. */
  demoMode: boolean;
  /** Whether the demo role switcher is offered (services/auth/demo-switch.ts refuses it otherwise). */
  roleSwitch: boolean;
  scope: ScopeDescriptor;
  /** Passed through to the mobile drawer, which renders the same nav as the desktop rail. */
  sections: NavSection[];
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur supports-backdrop-filter:bg-surface/80 sm:px-6">
      <MobileNav sections={sections} demoMode={demoMode} />

      {/* Brand only shows where the sidebar is hidden, so it is never duplicated. */}
      <span className="flex items-center gap-2 lg:hidden">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-bio-green text-micro font-bold tracking-wider text-white">
          BV
        </span>
        <span className="hidden text-sm font-semibold tracking-tight text-text sm:inline">BIOVOLAILLES</span>
      </span>

      {/*
       * "What am I looking at?" (§6). The scope is the one piece of context that stays true
       * on every route, so it lives in the shell rather than being repeated per page.
       */}
      <div className="hidden min-w-0 flex-col leading-tight lg:flex">
        <span className="text-micro font-semibold uppercase tracking-widest text-secondary">{scope.kind}</span>
        <span className="truncate text-caption font-medium text-text">
          {scope.name}
          {scope.qualifier ? <span className="font-normal text-secondary"> · {scope.qualifier}</span> : null}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {isDemoSwitch ? (
          <span
            className="hidden rounded-full border border-border bg-background px-2 py-0.5 text-micro font-medium text-secondary md:inline"
            title="Rôle emprunté via le sélecteur de démonstration."
          >
            Session de démonstration
          </span>
        ) : null}

        {roleSwitch ? <RoleSwitcher currentRole={role} /> : null}

        <div className="hidden text-right leading-tight sm:block">
          <p className="text-caption font-semibold text-text">{fullName}</p>
          <p className="text-micro text-secondary">{roleLabel}</p>
        </div>

        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="icon" className="size-9" title="Se déconnecter">
            <LogOut className="size-4" aria-hidden="true" />
            <span className="sr-only">Se déconnecter</span>
          </Button>
        </form>
      </div>
    </header>
  );
}
