import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { TelemetryTabs } from "@/components/domain/TelemetryTabs";
import { Badge } from "@/components/ui/Badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { can } from "@/domain/shared/permissions";
import { requireModuleAccess } from "@/services/auth/guard";
import { calibrationRegister, DUE_SOON_DAYS } from "@/services/telemetry/calibration";
import { recordCalibrationAction } from "../actions";

const STATUS = {
  A_JOUR: { label: "À jour", tone: "success" },
  A_ECHEANCE: { label: `Échéance < ${DUE_SOON_DAYS} j`, tone: "warning" },
  ECHU: { label: "Échu", tone: "critical" },
  JAMAIS: { label: "Jamais étalonné", tone: "neutral" },
  NON_CONFORME: { label: "Non conforme — hors service", tone: "critical" },
} as const;

export default async function CalibrationPage() {
  const session = await requireModuleAccess("IOT");
  const rows = await calibrationRegister(session);
  const canEdit = can(session, "EDIT", "IOT");
  const count = (s: keyof typeof STATUS) => rows.filter((r) => r.status === s).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Télémétrie", href: "/telemetrie" }, { label: "Étalonnage" }]}
        title="Registre d'étalonnage"
        description="Date, méthode, instrument de référence, écart, résultat et preuve, capteur par capteur (document 3, lot 6). Le résultat est calculé contre la tolérance, pas déclaré. Un étalonnage non conforme met le capteur hors service ; un étalonnage échu marque ses mesures, qui sortent alors des moyennes et des règles."
      />
      <TelemetryTabs active="/telemetrie/etalonnage" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Voies suivies" value={rows.length} />
        <StatCard label="À jour" value={count("A_JOUR")} tone="success" />
        <StatCard label="À échéance" value={count("A_ECHEANCE")} tone={count("A_ECHEANCE") ? "warning" : "default"} />
        <StatCard label="Échus / non conformes" value={count("ECHU") + count("NON_CONFORME")} tone={count("ECHU") + count("NON_CONFORME") ? "critical" : "default"} />
        <StatCard label="Dérive détectée" value={rows.filter((r) => r.drifting).length} tone={rows.some((r) => r.drifting) ? "warning" : "default"} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Voie</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Dernier étalonnage</TableHead>
            <TableHead>Prochaine échéance</TableHead>
            <TableHead>Écarts successifs</TableHead>
            {canEdit ? <TableHead className="text-right">Action</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.sensorId}>
              <TableCell>
                <span className="font-medium">{r.code}</span>
                <span className="block text-xs text-secondary">
                  {r.ref} · {r.label}
                </span>
              </TableCell>
              <TableCell>
                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                {r.drifting ? (
                  <>
                    {" "}
                    <Badge tone="warning">Dérive</Badge>
                  </>
                ) : null}
              </TableCell>
              <TableCell className="text-xs">
                {r.last ? (
                  <>
                    {new Date(r.last.calibratedAt).toLocaleDateString("fr-FR", { timeZone: "Africa/Casablanca" })} · {r.last.method}
                    <span className="block text-secondary">
                      Réf. {r.last.referenceValue} / lu {r.last.measuredValue} (± {r.last.tolerance}) · {r.last.referenceInstrument} · preuve {r.last.evidenceRef}
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-xs">{r.last ? new Date(r.last.nextDueAt).toLocaleDateString("fr-FR", { timeZone: "Africa/Casablanca" }) : "—"}</TableCell>
              <TableCell className="text-xs">{r.errors.length ? r.errors.map((e) => (e > 0 ? `+${e}` : String(e))).join(" → ") : "—"}</TableCell>
              {canEdit ? (
                <TableCell className="text-right">
                  <FormDialog
                    title={`Étalonnage — ${r.code}`}
                    description="Comparer la voie à un instrument de référence certifié, au même point et au même instant."
                    triggerLabel="Enregistrer"
                    triggerVariant="ghost"
                    action={recordCalibrationAction}
                    fields={[
                      { name: "sensorId", label: "Voie", type: "select", defaultValue: r.sensorId, options: [{ value: r.sensorId, label: r.code }] },
                      { name: "calibratedAt", label: "Date", type: "datetime-local", required: true, half: true },
                      { name: "intervalDays", label: "Périodicité (jours)", type: "number", defaultValue: "180", required: true, half: true },
                      { name: "method", label: "Méthode", type: "text", required: true, placeholder: "Comparaison in situ, 3 points" },
                      { name: "referenceInstrument", label: "Instrument de référence (et certificat)", type: "text", required: true },
                      { name: "referenceValue", label: "Valeur de référence", type: "text", required: true, half: true },
                      { name: "measuredValue", label: "Valeur lue par la voie", type: "text", required: true, half: true },
                      { name: "tolerance", label: "Tolérance (±)", type: "text", required: true, half: true },
                      { name: "offsetApplied", label: "Correction appliquée", type: "text", half: true },
                      { name: "evidenceRef", label: "Preuve (PV, photo, certificat)", type: "text", required: true },
                    ]}
                  />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
