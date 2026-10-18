import { Download, Inbox } from "lucide-react";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { LEAD_STATUS } from "@/domain/shared/enums";
import { can } from "@/domain/shared/permissions";
import { env } from "@/lib/env";
import { LEAD_ACTIVITY_LABEL, LEAD_STATUS_LABEL, LEAD_STATUS_TONE } from "@/lib/lead-labels";
import { requireModuleAccess } from "@/services/auth/guard";
import { listLeads } from "@/services/leads/leads";
import { isEmailNotificationConfigured } from "@/services/notify/email";
import { LeadEditor } from "./LeadEditor";

export default async function ProspectsPage({ searchParams }: PageProps<"/prospects">) {
  const session = await requireModuleAccess("LEADS");
  const { statut } = await searchParams;
  const statusFilter = typeof statut === "string" && (LEAD_STATUS as readonly string[]).includes(statut) ? statut : null;

  const all = await listLeads(session);
  const leads = statusFilter ? all.filter((l) => l.status === statusFilter) : all;
  const open = all.filter((l) => l.status !== "GAGNE" && l.status !== "PERDU").length;
  const fresh = all.filter((l) => l.status === "NOUVEAU").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Prospects"
        description="Demandes reçues par le formulaire du site BVU Tech, et leur suivi commercial."
        actions={
          can(session, "EXPORT", "LEADS") ? (
            <Button asChild size="sm" variant="secondary">
              <a href="/prospects/export">
                <Download className="size-4" aria-hidden="true" />
                Exporter (CSV)
              </a>
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Demandes reçues" value={all.length} icon={Inbox} />
        <StatCard label="À traiter (nouvelles)" value={fresh} tone={fresh > 0 ? "warning" : "default"} />
        <StatCard label="En cours" value={open} />
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 text-sm text-secondary">
        <p>
          Notification e-mail des nouvelles demandes :{" "}
          <strong className="text-text">{isEmailNotificationConfigured() ? "activée" : "non configurée"}</strong>
          {isEmailNotificationConfigured() ? null : " — définir RESEND_API_KEY, LEADS_NOTIFY_TO et LEADS_NOTIFY_FROM."}
        </p>
        {env.DATABASE_SNAPSHOT ? (
          <p className="text-warning-strong">
            Mode démonstration (instantané) : les demandes ne sont pas conservées durablement. Configurez une base Turso pour
            la production.
          </p>
        ) : null}
      </div>

      <nav aria-label="Filtrer par statut" className="flex flex-wrap gap-2 text-sm">
        <a href="/prospects" className={statusFilter ? "text-secondary underline" : "font-semibold text-text"}>
          Tous ({all.length})
        </a>
        {LEAD_STATUS.map((s) => (
          <a key={s} href={`/prospects?statut=${s}`} className={statusFilter === s ? "font-semibold text-text" : "text-secondary underline"}>
            {LEAD_STATUS_LABEL[s]} ({all.filter((l) => l.status === s).length})
          </a>
        ))}
      </nav>

      {leads.length === 0 ? (
        <EmptyState title="Aucune demande" description="Les demandes envoyées depuis la page d'accueil apparaîtront ici." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reçue le</TableHead>
              <TableHead>Entreprise</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Activité</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell className="whitespace-nowrap">{new Date(lead.createdAt).toLocaleDateString("fr-FR")}</TableCell>
                <TableCell className="font-medium">{lead.company}</TableCell>
                <TableCell>
                  {lead.contactName}
                  <span className="block text-xs text-secondary">{lead.email}</span>
                </TableCell>
                <TableCell>{LEAD_ACTIVITY_LABEL[lead.activity]}</TableCell>
                <TableCell>
                  <Badge tone={LEAD_STATUS_TONE[lead.status]}>{LEAD_STATUS_LABEL[lead.status]}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <LeadEditor lead={lead} activityLabel={LEAD_ACTIVITY_LABEL[lead.activity]} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
