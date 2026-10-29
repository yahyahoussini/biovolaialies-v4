import Link from "next/link";
import { notFound } from "next/navigation";
import { DataStatusBadge } from "@/components/domain/DataStatusBadge";
import { LotStatusBadge } from "@/components/domain/LotStatusBadge";
import { PageHeader } from "@/components/domain/PageHeader";
import { OpenHoldDialog } from "@/app/(app)/qualite/OpenHoldDialog";
import { describeActiveHolds } from "@/services/quality/holds";
import { Stat, StatGrid } from "@/components/domain/StatGrid";
import { repositories } from "@/data/repositories";
import { canAccessModule, can } from "@/domain/shared/permissions";
import type { ProvenanceFields } from "@/domain/shared/provenance";
import { MEASUREMENT_TYPE_LABEL } from "@/lib/labels";
import { publicPassportUrl } from "@/lib/public-url";
import { generateQrDataUrl } from "@/lib/qr-image";
import { redirectIfOutOfScope, requireModuleAccess } from "@/services/auth/guard";
import { resolveLotHierarchy } from "@/services/identity/scope-check";
import { getLotPerformanceOverview } from "@/services/intelligence/performance-service";
import { listAlertsForLot } from "@/services/intelligence/queries";
import { describeProvenance, type ProvenanceContext } from "@/services/provenance/provenance-service";
import { computeLotDataQuality } from "@/services/quality/lot-quality";
import { buildLotTraceabilityChain } from "@/services/traceability/chain";
import { checkTraceabilityIntegrity } from "@/services/traceability/integrity";
import { listQrTokensForLot } from "@/services/traceability/qr-tokens";
import type { IotTabData } from "./IotTab";
import { LotEditDialog } from "@/components/domain/LazyDialogs";
import { LotStatusMenu } from "./LotStatusMenu";
import { LotFlowSection } from "./LotFlowSection";
import { LotHealthSection } from "./LotHealthSection";
import { LotLabSection } from "./LotLabSection";
import { LotHistorySection } from "./LotHistorySection";
import { LotTabs } from "./LotTabs";
import type { PassportTabData } from "./PassportTab";

async function latestProvenance(fields: ProvenanceFields | undefined, context: ProvenanceContext) {
  return fields ? describeProvenance(fields, context) : null;
}

/** A lot's age today, or at its end once it has ended: a closed lot stops ageing. */
function formatAge(startedAt: string | null, endedAt: string | null): string | null {
  if (!startedAt) return null;
  const until = endedAt ? Math.min(Date.parse(endedAt), Date.now()) : Date.now();
  const days = Math.floor((until - new Date(startedAt).getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return null;
  return `${days} jour${days > 1 ? "s" : ""}`;
}

export default async function LotDetailPage({ params }: PageProps<"/lots/[lotId]">) {
  const session = await requireModuleAccess("LOTS");
  const { lotId } = await params;

  const lot = await repositories.lots.findById(lotId);
  if (!lot) notFound();

  const path = await resolveLotHierarchy(lotId);
  redirectIfOutOfScope(session, path);

  const [building, events, feed, water, weight, mortality, environment, quality] = await Promise.all([
    repositories.buildings.findById(lot.buildingId),
    repositories.lotEvents.listByLot(lotId),
    repositories.feedUsage.listByLot(lotId),
    repositories.waterUsage.listByLot(lotId),
    repositories.weightMeasurements.listByLot(lotId),
    repositories.mortalityRecords.listByLot(lotId),
    repositories.environmentMeasurements.listByLot(lotId),
    computeLotDataQuality(lotId),
  ]);
  const farm = building ? await repositories.farms.findById(building.farmId) : null;

  const [feedProvenance, waterProvenance, weightProvenance, mortalityProvenance, environmentProvenance] = await Promise.all([
    latestProvenance(feed[0], { occurredAt: feed[0]?.occurredAt ?? "", lotId }),
    latestProvenance(water[0], { occurredAt: water[0]?.occurredAt ?? "", lotId: water[0]?.lotId, buildingId: water[0]?.buildingId }),
    latestProvenance(weight[0], { occurredAt: weight[0]?.occurredAt ?? "", lotId }),
    latestProvenance(mortality[0], { occurredAt: mortality[0]?.occurredAt ?? "", lotId }),
    latestProvenance(environment[0], {
      occurredAt: environment[0]?.occurredAt ?? "",
      lotId: environment[0]?.lotId,
      buildingId: environment[0]?.buildingId,
    }),
  ]);

  const activeHolds = await describeActiveHolds("LOT", lot.id);
  const canOpenHold = can(session, "CREATE", "QUALITY");
  const canEdit = can(session, "EDIT", "LOTS");
  const canCreateEvent = can(session, "CREATE", "EVENTS");
  const canRunDetection = can(session, "VALIDATE", "ANOMALIES");
  const age = formatAge(lot.startedAt, lot.endedAt);
  const lost = lot.initialPopulation - lot.currentPopulation;
  const mortalityHint =
    lot.initialPopulation > 0 && lost > 0
      ? `-${lost.toLocaleString("fr-FR")} sujets (${((lost / lot.initialPopulation) * 100).toFixed(1)} %)`
      : "Aucune perte enregistrée";

  const [kpis, alerts] = await Promise.all([getLotPerformanceOverview(lotId), listAlertsForLot(lotId)]);

  let traceability: { chain: Awaited<ReturnType<typeof buildLotTraceabilityChain>>; issues: Awaited<ReturnType<typeof checkTraceabilityIntegrity>> } | null = null;
  let passport: PassportTabData | null = null;
  if (canAccessModule(session, "TRACEABILITY")) {
    const chain = await buildLotTraceabilityChain(lotId, session);
    const issues = await checkTraceabilityIntegrity(chain, lot);
    traceability = { chain, issues };

    const productNodes = chain.nodes.filter((n) => n.type === "PRODUCT");
    const productRecords = await Promise.all(productNodes.map((n) => repositories.products.findById(n.id)));
    const tokens = await listQrTokensForLot(lotId, session);
    const productNameById = new Map(
      productRecords.filter((p) => p !== null).map((p) => [p.id, `${p.code} — ${p.name}`])
    );

    passport = {
      canManage: can(session, "CREATE", "TRACEABILITY"),
      products: productRecords.filter((p) => p !== null).map((p) => ({ id: p.id, code: p.code, name: p.name })),
      tokens: await Promise.all(
        tokens.map(async (token) => {
          const url = publicPassportUrl(token.token);
          return {
            id: token.id,
            scope: token.scope,
            label:
              token.scope === "PRODUCT" && token.productId
                ? (productNameById.get(token.productId) ?? "Produit")
                : `Lot ${lot.code}`,
            publicUrl: url,
            qrDataUrl: await generateQrDataUrl(url),
            active: token.active,
            createdAt: token.createdAt,
            expiresAt: token.expiresAt,
          };
        })
      ),
    };
  }

  let iot: IotTabData | null = null;
  if (canAccessModule(session, "IOT")) {
    const [devices, latestMeasurements, lotHistory] = await Promise.all([
      repositories.devices.listByBuilding(lot.buildingId),
      repositories.measurements.latestByBuilding(lot.buildingId),
      repositories.measurements.listByLot(lotId),
    ]);
    const sensorLists = await Promise.all(devices.map((d) => repositories.sensors.listByDevice(d.id)));
    const sensors = sensorLists.flat();
    const sensorById = new Map(sensors.map((s) => [s.id, s]));
    const environmentReadings = latestMeasurements
      .filter((m) => ["TEMPERATURE", "HUMIDITE", "CO2", "LUMIERE"].includes(sensorById.get(m.sensorId)?.sensorType ?? ""))
      .map((m) => ({
        label: MEASUREMENT_TYPE_LABEL[sensorById.get(m.sensorId)!.sensorType],
        value: m.value,
        unit: m.unit,
        dataStatus: m.dataStatus,
        capturedAt: m.capturedAt,
      }));
    iot = {
      devices,
      sensors,
      environmentReadings,
      // Narrowed to the fields IotTab actually renders — see LotMeasurementPoint.
      history: lotHistory.map((m) => ({
        sensorId: m.sensorId,
        capturedAt: m.capturedAt,
        value: m.value,
        dataStatus: m.dataStatus,
      })),
    };
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Lots", href: "/lots" }, { label: lot.code }]}
        title={lot.code}
        meta={
          <>
            <LotStatusBadge status={lot.status} />
            <DataStatusBadge status={lot.dataStatus} />
          </>
        }
        description={`${farm?.name ?? "—"} · ${building ? `${building.code} — ${building.name}` : "—"} · ${lot.species} (${lot.breed})`}
        actions={
          canEdit || canOpenHold ? (
            <div className="flex flex-wrap gap-2">
              {canOpenHold && activeHolds.length === 0 ? <OpenHoldDialog defaultType="LOT" defaultCode={lot.code} triggerLabel="Bloquer" /> : null}
              {canEdit ? <LotEditDialog lot={lot} /> : null}
            </div>
          ) : null
        }
      />

      {activeHolds.length > 0 ? (
        <p role="alert" className="rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm text-critical-strong">
          Lot sous blocage qualité :{" "}
          {activeHolds.map((h, i) => (
            <span key={h.caseId}>
              {i > 0 ? ", " : null}
              <Link href={`/qualite/${h.caseId}`} className="font-semibold underline">
                {h.code}
              </Link>
            </span>
          ))}
          . Aucune collecte, abattage ou transformation ne peut en être tirée avant décision qualité.
        </p>
      ) : null}

      <StatGrid>
        <Stat
          label="Population initiale"
          value={lot.initialPopulation.toLocaleString("fr-FR")}
          hint={`${lot.species} · ${lot.breed}`}
        />
        <Stat
          label="Population actuelle"
          value={lot.currentPopulation.toLocaleString("fr-FR")}
          hint={mortalityHint}
          tone={lot.currentPopulation < lot.initialPopulation ? "warning" : "default"}
        />
        <Stat
          label="Date de démarrage"
          value={lot.startedAt ? new Date(lot.startedAt).toLocaleDateString("fr-FR") : lot.plannedStartAt ? "Prévue" : "—"}
          hint={!lot.startedAt && lot.plannedStartAt ? lot.plannedStartAt : undefined}
        />
        <Stat label={lot.endedAt ? "Âge à la clôture" : "Âge du lot"} value={age ?? "—"} hint={building?.code ? `Bâtiment ${building.code}` : undefined} />
      </StatGrid>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-5 py-4">
          <p className="text-overline">Changer le statut du lot</p>
          <LotStatusMenu lotId={lot.id} currentStatus={lot.status} />
        </div>
      ) : null}

      <LotFlowSection lot={lot} session={session} />
      <LotHealthSection lot={lot} session={session} />
      <LotLabSection lotId={lot.id} session={session} />
      <LotHistorySection lotId={lot.id} session={session} />

      <LotTabs
        lot={lot}
        events={events}
        canCreateEvent={canCreateEvent}
        iot={iot}
        kpis={kpis}
        alerts={alerts}
        canRunDetection={canRunDetection}
        traceability={traceability}
        passport={passport}
        data={{
          feed,
          water,
          weight,
          mortality,
          environment,
          quality,
          latestProvenance: {
            feed: feedProvenance,
            water: waterProvenance,
            weight: weightProvenance,
            mortality: mortalityProvenance,
            environment: environmentProvenance,
          },
        }}
      />
    </div>
  );
}

