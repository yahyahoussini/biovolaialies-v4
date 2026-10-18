import { PageHeader } from "@/components/domain/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { can } from "@/domain/shared/permissions";
import { env } from "@/lib/env";
import { requireModuleAccess } from "@/services/auth/guard";
import { listApiClients } from "@/services/api/clients";
import { CreateApiClientDialog, RevokeButton } from "./ApiClientControls";

export default async function ApiAccessPage() {
  const session = await requireModuleAccess("API_CLIENTS");
  const clients = await listApiClients(session);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Administration", href: "/administration" }, { label: "Accès API" }]}
        title="Accès API"
        description="Clés des systèmes qui écrivent ou lisent par l'API v1 : passerelles terrain, ERP/MES, laboratoires, terminaux hors ligne."
        actions={can(session, "CREATE", "API_CLIENTS") ? <CreateApiClientDialog /> : null}
      />

      <Card>
        <CardHeader>
          <CardTitle>Contrat d&apos;API</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-secondary">
          <p>
            Spécification OpenAPI 3.1 :{" "}
            <a className="text-bio-green underline" href="/api/v1/openapi.json">
              {env.APP_URL}/api/v1/openapi.json
            </a>{" "}
            · Disponibilité : <code>/api/v1/health/ready</code>
          </p>
          <p>
            Authentification : en-tête <code>Authorization: Bearer bvu_…</code>. Chaque réponse porte un{" "}
            <code>X-Correlation-ID</code>. Rejeu hors ligne sans doublon par <code>Idempotency-Key</code>. Quota de 120
            requêtes/minute par client et par instance serveur.
          </p>
          <p>
            Les actions d&apos;un client sont journalisées à son nom dans le journal chaîné, sous la responsabilité de
            l&apos;administrateur qui a émis la clé. La levée d&apos;un blocage qualité n&apos;est jamais possible par API.
          </p>
        </CardContent>
      </Card>

      {clients.length === 0 ? (
        <EmptyState title="Aucun accès API" description="Créez un accès par système intégré, avec les seuls droits nécessaires." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Système</TableHead>
              <TableHead>Clé</TableHead>
              <TableHead>Droits</TableHead>
              <TableHead>Dernier appel</TableHead>
              <TableHead>État</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="font-mono text-xs">{c.keyPrefix}…</TableCell>
                <TableCell className="text-xs">{c.scopes.join(", ")}</TableCell>
                <TableCell>{c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString("fr-FR") : "Jamais"}</TableCell>
                <TableCell>{c.active ? <Badge tone="success">Actif</Badge> : <Badge tone="neutral">Révoqué</Badge>}</TableCell>
                <TableCell className="text-right">{c.active && can(session, "EDIT", "API_CLIENTS") ? <RevokeButton clientId={c.id} /> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
