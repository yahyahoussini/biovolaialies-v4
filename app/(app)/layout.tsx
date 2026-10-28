import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { repositories } from "@/data/repositories";
import { canAccessModule } from "@/domain/shared/permissions";
import { env } from "@/lib/env";
import { ROLE_LABEL } from "@/lib/labels";
import { getCurrentSession } from "@/services/auth/session";
import { datasetsFor } from "@/services/exports/exports";
import { resolveScopeDescriptor } from "@/services/identity/scope-label";
import type { NavSection } from "@/components/layout/Sidebar";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }

  const user = await repositories.users.findById(session.userId);
  if (!user) {
    redirect("/login");
  }

  const sections: NavSection[] = [
    {
      label: "Vue d'ensemble",
      items: [{ label: "Tableau de bord", href: "/dashboard", icon: "dashboard" }],
    },
    {
      label: "Opérations",
      items: (
        [
          canAccessModule(session, "ORGANIZATIONS") && { label: "Organisations", href: "/organisation", icon: "organizations" },
          canAccessModule(session, "COOPERATIVES") && { label: "Coopératives", href: "/cooperatives", icon: "cooperatives" },
          canAccessModule(session, "PRODUCERS") && { label: "Producteurs", href: "/producteurs", icon: "producers" },
          canAccessModule(session, "FARMS") && { label: "Fermes", href: "/fermes", icon: "farms" },
          canAccessModule(session, "HATCHERY") && { label: "Couvoir & amont", href: "/couvoir", icon: "hatchery" },
          canAccessModule(session, "LOTS") && { label: "Lots", href: "/lots", icon: "lots" },
          canAccessModule(session, "LOTS") && { label: "Lignes & phases", href: "/lignes", icon: "lines" },
          (canAccessModule(session, "LOTS") || canAccessModule(session, "HATCHERY")) && { label: "Transferts", href: "/transferts", icon: "transfers" },
          canAccessModule(session, "LOTS") && { label: "Œufs de consommation", href: "/oeufs-consommation", icon: "tableEggs" },
          canAccessModule(session, "MARKING") && { label: "Marquage des œufs", href: "/marquage", icon: "marking" },
          canAccessModule(session, "LAB") && { label: "Laboratoire", href: "/laboratoire", icon: "lab" },
          canAccessModule(session, "EVENTS") && { label: "Saisies terrain", href: "/saisies-terrain", icon: "field" },
          canAccessModule(session, "TRACEABILITY") && { label: "Identifiants", href: "/identifiants", icon: "identifiers" },
          canAccessModule(session, "IOT") && { label: "Télémétrie", href: "/telemetrie", icon: "iot" },
          canAccessModule(session, "IOT") && { label: "Appareils IoT", href: "/iot", icon: "iot" },
          canAccessModule(session, "PRODUCTS") && { label: "Produits & expéditions", href: "/expeditions", icon: "shipments" },
        ] as (NavSection["items"][number] | false)[]
      ).filter((item): item is NavSection["items"][number] => Boolean(item)),
    },
    {
      label: "Intelligence",
      items: (
        [
          canAccessModule(session, "ANOMALIES") && { label: "Anomalies", href: "/anomalies", icon: "anomalies" },
          canAccessModule(session, "ALERTS") && { label: "Alertes", href: "/alertes", icon: "alerts" },
          canAccessModule(session, "QUALITY") && { label: "Qualité & rappels", href: "/qualite", icon: "quality" },
        ] as (NavSection["items"][number] | false)[]
      ).filter((item): item is NavSection["items"][number] => Boolean(item)),
    },
    {
      label: "Projet & terrain",
      items: (
        [
          canAccessModule(session, "EQUIPMENT") && { label: "Équipements", href: "/equipements", icon: "equipment" },
          canAccessModule(session, "EQUIPMENT") && { label: "Mise en service", href: "/equipements/recette", icon: "commissioning" },
          canAccessModule(session, "LEADS") && { label: "Prospects", href: "/prospects", icon: "leads" },
          canAccessModule(session, "SETTINGS") && { label: "Programme", href: "/programme", icon: "programme" },
        ] as (NavSection["items"][number] | false)[]
      ).filter((item): item is NavSection["items"][number] => Boolean(item)),
    },
    {
      label: "Gouvernance",
      items: (
        [
          (canAccessModule(session, "USERS") || canAccessModule(session, "AUDIT") || canAccessModule(session, "INTEGRITY")) && {
            label: "Administration",
            href: "/administration",
            icon: "administration",
          },
          canAccessModule(session, "USERS") && { label: "Utilisateurs", href: "/utilisateurs", icon: "users" },
          canAccessModule(session, "AUDIT") && { label: "Audit", href: "/audit", icon: "audit" },
          datasetsFor(session).length > 0 && { label: "Exports", href: "/exports", icon: "exports" },
          canAccessModule(session, "INTEGRITY") && { label: "Intégrité", href: "/integrite", icon: "integrity" },
          canAccessModule(session, "INTEGRITY") && { label: "Journal chaîné", href: "/journal", icon: "ledger" },
          canAccessModule(session, "API_CLIENTS") && { label: "Accès API", href: "/acces-api", icon: "apiClients" },
          canAccessModule(session, "SETTINGS") && { label: "Paramètres", href: "/parametres", icon: "settings" },
        ] as (NavSection["items"][number] | false)[]
      ).filter((item): item is NavSection["items"][number] => Boolean(item)),
    },
  ];

  // A role with no module in a section (a producer has nothing under "Projet & terrain") gets no empty heading.
  const visibleSections = sections.filter((section) => section.items.length > 0);

  const scope = await resolveScopeDescriptor(session);

  return (
    <div className="flex min-h-screen">
      {/* First tab stop: lets keyboard users jump the whole nav rail (§18). */}
      <a
        href="#contenu-principal"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-bio-green focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Aller au contenu principal
      </a>

      <Sidebar sections={visibleSections} demoMode={env.DEMO_MODE} />

      {/* min-w-0 stops a wide table or chart from forcing the whole shell to scroll sideways. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          fullName={user.fullName}
          roleLabel={ROLE_LABEL[session.role]}
          role={session.role}
          isDemoSwitch={session.isDemoSwitch}
          demoMode={env.DEMO_MODE}
          scope={scope}
          sections={visibleSections}
        />
        <main id="contenu-principal" className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
