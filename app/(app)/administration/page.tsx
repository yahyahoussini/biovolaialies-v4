import {
  FileDown,
  KeyRound,
  Activity,
  AlertTriangle,
  Bird,
  Building2,
  History,
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
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/domain/PageHeader";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import type { Module } from "@/domain/shared/permissions";
import { canAccessModule } from "@/domain/shared/permissions";
import { getCurrentSession } from "@/services/auth/session";

interface AdminEntry {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  module: Module;
}

const ENTRIES: { section: string; items: AdminEntry[] }[] = [
  {
    section: "Gouvernance",
    items: [
      { label: "Utilisateurs", description: "Comptes, rôles et périmètres d'accès.", href: "/utilisateurs", icon: UserCog, module: "USERS" },
      { label: "Audit", description: "Journal complet des mutations importantes.", href: "/audit", icon: History, module: "AUDIT" },
      { label: "Connexions", description: "Journal des connexions, échecs et blocages.", href: "/administration/connexions", icon: KeyRound, module: "AUDIT" },
      { label: "Exports", description: "Exports enregistrés avec leur empreinte, et vérification d'un fichier.", href: "/exports", icon: FileDown, module: "AUDIT" },
      { label: "Intégrité", description: "Preuve de cohérence de la plateforme.", href: "/integrite", icon: ShieldCheck, module: "INTEGRITY" },
      { label: "Paramètres", description: "Règles d'alerte et informations système.", href: "/parametres", icon: Settings, module: "SETTINGS" },
      {
        label: "Démonstration",
        description: "État du système et réinitialisation du scénario héros.",
        href: "/administration/demo",
        icon: Activity,
        module: "SETTINGS",
      },
    ],
  },
  {
    section: "Structure",
    items: [
      { label: "Organisations", description: "La fédération faîtière.", href: "/organisation", icon: Building2, module: "ORGANIZATIONS" },
      { label: "Coopératives", description: "Coopératives et leurs régions.", href: "/cooperatives", icon: Users, module: "COOPERATIVES" },
      { label: "Producteurs", description: "Producteurs rattachés à chaque coopérative.", href: "/producteurs", icon: UserRound, module: "PRODUCERS" },
      { label: "Fermes & bâtiments", description: "Fermes, bâtiments et leur capacité.", href: "/fermes", icon: Warehouse, module: "FARMS" },
    ],
  },
  {
    section: "Exploitation",
    items: [
      { label: "Lots", description: "Cycles d'élevage et leur statut.", href: "/lots", icon: Bird, module: "LOTS" },
      { label: "IoT", description: "Appareils, capteurs et mesures.", href: "/iot", icon: Radio, module: "IOT" },
      { label: "Anomalies", description: "Résultat du moteur de règles.", href: "/anomalies", icon: AlertTriangle, module: "ANOMALIES" },
    ],
  },
];

export default async function AdministrationPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const sections = ENTRIES.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAccessModule(session, item.module)),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Administration"
        description="Contrôle de la plateforme — gouvernance, structure organisationnelle et exploitation."
      />

      {sections.map((section) => (
        <div key={section.section} className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-secondary">{section.section}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item) => (
              <Link key={item.href} href={item.href}>
                <Card className="flex h-full flex-col gap-2 transition-colors hover:border-bio-green">
                  <div className="flex items-center gap-2">
                    <item.icon className="size-4 text-bio-green" aria-hidden="true" />
                    <CardTitle>{item.label}</CardTitle>
                  </div>
                  <CardDescription>{item.description}</CardDescription>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
