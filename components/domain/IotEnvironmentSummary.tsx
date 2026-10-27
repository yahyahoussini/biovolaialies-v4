import { DataStatusBadge } from "@/components/domain/DataStatusBadge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import type { DataStatus } from "@/domain/shared/enums";

export interface EnvironmentReading {
  label: string;
  value: number;
  unit: string;
  dataStatus: DataStatus;
  capturedAt: string;
}

/**
 * The "Temperature 27.4°C / Humidity 64% / CO2 1020 ppm" card row (phase-4 brief §10) —
 * every value carries its data status badge, so simulated readings are never mistaken
 * for validated production data.
 */
export function IotEnvironmentSummary({ readings }: { readings: EnvironmentReading[] }) {
  if (readings.length === 0) {
    return <EmptyState title="Aucune mesure environnementale" description="Aucun capteur actif pour ce contexte." />;
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {readings.map((reading) => (
        <Card key={reading.label} className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-secondary">{reading.label}</span>
          <span className="text-2xl font-semibold text-text">
            {reading.value} <span className="text-sm font-normal text-secondary">{reading.unit}</span>
          </span>
          <div className="flex items-center justify-between">
            <DataStatusBadge status={reading.dataStatus} />
            <span className="text-micro text-secondary">{new Date(reading.capturedAt).toLocaleTimeString("fr-FR", { timeZone: "Africa/Casablanca" })}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}
