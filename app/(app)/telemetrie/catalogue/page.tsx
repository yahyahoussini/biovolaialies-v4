import { PageHeader } from "@/components/domain/PageHeader";
import { TelemetryTabs } from "@/components/domain/TelemetryTabs";
import { Badge } from "@/components/ui/Badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { SENSOR_CATALOG } from "@/domain/telemetry/catalog";
import { SENSOR_TYPE_LABEL, ZONE_KIND_LABEL, unitLabel } from "@/domain/telemetry/labels";
import { RULE_LABEL } from "@/domain/telemetry/rules/index";
import { requireModuleAccess } from "@/services/auth/guard";

export default async function SensorCataloguePage() {
  await requireModuleAccess("IOT");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Télémétrie", href: "/telemetrie" }, { label: "Catalogue capteurs" }]}
        title="Les capteurs du document 2"
        description="Où chaque capteur se pose, l'erreur classique qui le rend inutile, sa fréquence et la décision qu'il alimente. « Un capteur qui n'alimente aucune décision est à retirer du projet. » Les plages physiques servant à rejeter une valeur impossible sont une hypothèse, à remplacer par la fiche du modèle acheté."
      />
      <TelemetryTabs active="/telemetrie/catalogue" />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Réf.</TableHead>
            <TableHead>Capteur</TableHead>
            <TableHead>Où exactement</TableHead>
            <TableHead>L&apos;erreur classique</TableHead>
            <TableHead>Fréquence</TableHead>
            <TableHead>Décision déclenchée</TableHead>
            <TableHead>Règle(s)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SENSOR_CATALOG.map((s) => (
            <TableRow key={s.ref}>
              <TableCell className="font-medium">{s.ref}</TableCell>
              <TableCell>
                {s.label}
                <span className="block text-xs text-secondary">
                  {ZONE_KIND_LABEL[s.zoneKind]}
                  {s.channels.length ? ` · ${s.channels.map((c) => `${SENSOR_TYPE_LABEL[c.type]} (${unitLabel(c.unit)})`).join(", ")}` : ""}
                </span>
              </TableCell>
              <TableCell className="max-w-xs text-xs">{s.placement}</TableCell>
              <TableCell className="max-w-xs text-xs">{s.classicError}</TableCell>
              <TableCell className="max-w-40 text-xs">{s.frequency}</TableCell>
              <TableCell className="max-w-xs text-xs">{s.decision}</TableCell>
              <TableCell>
                {s.rules.length ? (
                  <div className="flex flex-col gap-1">
                    {s.rules.map((r) => (
                      <Badge key={r} tone="info">
                        {RULE_LABEL[r]}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <Badge tone="neutral">{s.kind === "EVENEMENT" ? "Journal seulement" : s.kind === "VIDEO" ? "Vidéo locale" : "Contexte"}</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
