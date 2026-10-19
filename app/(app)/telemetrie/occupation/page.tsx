import Link from "next/link";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { TelemetryTabs } from "@/components/domain/TelemetryTabs";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { repositories } from "@/data/repositories";
import { can } from "@/domain/shared/permissions";
import { ZONE_KIND_LABEL } from "@/domain/telemetry/labels";
import { requireModuleAccess } from "@/services/auth/guard";
import { isWithinScope, resolveBuildingHierarchy, resolveFarmHierarchy } from "@/services/identity/scope-check";
import { endOccupationAction, startOccupationAction } from "../actions";

const when = (v: string | null) => (v ? new Date(v).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" }) : "en cours");

export default async function OccupationPage() {
  const session = await requireModuleAccess("LOTS");
  const canEdit = can(session, "EDIT", "LOTS");
  const farms = await repositories.farms.list();
  const visibleFarms: typeof farms = [];
  for (const f of farms) if (isWithinScope(session, await resolveFarmHierarchy(f.id))) visibleFarms.push(f);
  const zones = (await repositories.zones.list()).filter((z) => visibleFarms.some((f) => f.id === z.farmId));
  const occupations = await repositories.zoneOccupations.listByZones(zones.map((z) => z.id));
  const lots = (await repositories.lots.list()).filter((l) => ["PLANIFIE", "CREE", "ACTIF", "EN_TRANSFERT"].includes(l.status));
  const lotOptions: { value: string; label: string }[] = [];
  for (const l of lots) if (isWithinScope(session, await resolveBuildingHierarchy(l.buildingId))) lotOptions.push({ value: l.id, label: l.code });
  const lotCode = new Map((await repositories.lots.list()).map((l) => [l.id, l]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Télémétrie", href: "/telemetrie" }, { label: "Occupation" }]}
        title="Table d'occupation des zones"
        description="Quel lot occupait quelle zone, entre quelles dates (document 3, ch. 2). C'est elle qui rattache une mesure au bon lot quand plusieurs lots cohabitent sur un site. Une zone ne porte qu'un lot à la fois ; une occupation saisie après coup ré-attribue les mesures déjà reçues."
      />
      <TelemetryTabs active="/telemetrie/occupation" />
      {visibleFarms.map((farm) => {
        const farmZones = zones.filter((z) => z.farmId === farm.id);
        if (farmZones.length === 0) return null;
        return (
          <Card key={farm.id}>
            <CardHeader>
              <CardTitle>{farm.name}</CardTitle>
              <CardDescription>{farmZones.length} zone(s)</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Zone</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Occupations</TableHead>
                    {canEdit ? <TableHead className="text-right">Action</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {farmZones.map((z) => {
                    const list = occupations.filter((o) => o.zoneId === z.id);
                    const open = list.find((o) => o.endedAt === null);
                    return (
                      <TableRow key={z.id}>
                        <TableCell className="font-medium">
                          {z.name}
                          <span className="block text-xs text-secondary">{z.code}</span>
                        </TableCell>
                        <TableCell>{ZONE_KIND_LABEL[z.kind]}</TableCell>
                        <TableCell className="text-xs">
                          {list.length === 0 ? (
                            <span className="text-secondary">Jamais occupée</span>
                          ) : (
                            <ul className="flex flex-col gap-1">
                              {list.map((o) => {
                                const lot = lotCode.get(o.lotId);
                                return (
                                  <li key={o.id}>
                                    {lot ? (
                                      <Link href={`/lots/${lot.id}`} className="font-medium text-bio-green hover:underline">
                                        {lot.code}
                                      </Link>
                                    ) : (
                                      o.lotId
                                    )}{" "}
                                    · {when(o.startedAt)} → {when(o.endedAt)}
                                    {o.headCount ? ` · ${o.headCount.toLocaleString("fr-FR")} sujets` : ""}
                                    {o.endedAt === null ? (
                                      <>
                                        {" "}
                                        <Badge tone="success">Présent</Badge>
                                      </>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </TableCell>
                        {canEdit ? (
                          <TableCell className="text-right">
                            {open ? (
                              <FormDialog
                                title={`Fin d'occupation — ${z.name}`}
                                triggerLabel="Clore"
                                triggerVariant="ghost"
                                action={endOccupationAction}
                                fields={[
                                  { name: "occupationId", label: "Occupation", type: "select", defaultValue: open.id, options: [{ value: open.id, label: lotCode.get(open.lotId)?.code ?? open.lotId }] },
                                  { name: "endedAt", label: "Sortie de la zone", type: "datetime-local", required: true },
                                ]}
                              />
                            ) : (
                              <FormDialog
                                title={`Occupation — ${z.name}`}
                                description="Le lot entre dans la zone à cette date. Une date passée ré-attribue les mesures déjà reçues."
                                triggerLabel="Occuper"
                                triggerVariant="ghost"
                                action={startOccupationAction}
                                fields={[
                                  { name: "zoneId", label: "Zone", type: "select", defaultValue: z.id, options: [{ value: z.id, label: z.code }] },
                                  { name: "lotId", label: "Lot", type: "select", required: true, options: lotOptions },
                                  { name: "startedAt", label: "Entrée", type: "datetime-local", required: true, half: true },
                                  { name: "endedAt", label: "Sortie (si passée)", type: "datetime-local", half: true },
                                  { name: "headCount", label: "Effectif placé", type: "number" },
                                  { name: "note", label: "Note", type: "text" },
                                ]}
                              />
                            )}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
