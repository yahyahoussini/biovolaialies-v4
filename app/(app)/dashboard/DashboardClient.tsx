"use client";

import { Bell, Bird, Radio, ShieldCheck, Users, Wheat } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ActivityFeed } from "@/components/domain/ActivityFeed";
import { DashboardClock } from "@/components/domain/DashboardClock";
import { DataStatusBadge } from "@/components/domain/DataStatusBadge";
import { IotEnvironmentSummary } from "@/components/domain/IotEnvironmentSummary";
import { NeedsAttentionList } from "@/components/domain/NeedsAttentionList";
import { PageHeader } from "@/components/domain/PageHeader";
import { PerformanceTrendChart } from "@/components/domain/LazyCharts";
import { ScopeDataQualityCard } from "@/components/domain/ScopeDataQualityCard";
import { StatCard } from "@/components/domain/StatCard";
import { TrendBadge } from "@/components/domain/TrendBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Select";
import type { Role } from "@/domain/shared/enums";
import { MEASUREMENT_TYPE_LABEL } from "@/lib/labels";
import {
  aggregateScopeQuality,
  buildNeedsAttentionItems,
  computeEnvironmentAverages,
  computeFeedTrend,
  computeKpis,
  filterAlerts,
  filterDevices,
  filterEvents,
  filterLots,
  mapAlertsToAttentionItems,
} from "@/services/dashboard/selectors";
import { DEFAULT_DASHBOARD_FILTERS, type DashboardFilters, type DashboardOverview, type PeriodDays } from "@/services/dashboard/types";

const PERIOD_OPTIONS: PeriodDays[] = [7, 14, 30];
const RECENT_ACTIVITY_LIMIT = 12;

type SectionKey = "alerts" | "chart" | "performance" | "iot" | "attention" | "quality" | "activity";

/** Same architecture for every role — only the section order and the caller's own scope change (phase-5 brief §2). */
const SECTION_ORDER: Record<Role, SectionKey[]> = {
  SUPER_ADMIN: ["alerts", "chart", "performance", "iot", "attention", "quality", "activity"],
  COOP_MANAGER: ["alerts", "chart", "performance", "iot", "attention", "quality", "activity"],
  PRODUCER: ["alerts", "chart", "performance", "iot", "attention", "quality", "activity"],
  FARM_MANAGER: ["alerts", "chart", "performance", "iot", "attention", "quality", "activity"],
  TECHNICIAN: ["alerts", "iot", "performance", "attention", "chart", "quality", "activity"],
  AUDITOR: ["alerts", "quality", "attention", "chart", "performance", "iot", "activity"],
  QUALITY_MANAGER: ["alerts", "quality", "attention", "chart", "performance", "iot", "activity"],
};

export function DashboardClient({ overview }: { overview: DashboardOverview }) {
  const now = useMemo(() => new Date(overview.generatedAt), [overview.generatedAt]);
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_DASHBOARD_FILTERS);

  const buildingOptions = useMemo(
    () => (filters.farmId === "ALL" ? overview.buildings : overview.buildings.filter((b) => b.farmId === filters.farmId)),
    [overview.buildings, filters.farmId]
  );

  const lots = useMemo(() => filterLots(overview.lots, filters), [overview.lots, filters]);
  const devices = useMemo(() => filterDevices(overview.devices, filters), [overview.devices, filters]);
  const events = useMemo(
    () => filterEvents(overview.events, filters, now).slice(0, RECENT_ACTIVITY_LIMIT),
    [overview.events, filters, now]
  );
  const alerts = useMemo(() => filterAlerts(overview.activeAlerts, filters), [overview.activeAlerts, filters]);
  const kpis = useMemo(() => computeKpis(lots, devices, alerts, filters, now), [lots, devices, alerts, filters, now]);
  const trend = useMemo(() => computeFeedTrend(lots, filters, now), [lots, filters, now]);
  const quality = useMemo(() => aggregateScopeQuality(lots), [lots]);
  const needsAttention = useMemo(() => buildNeedsAttentionItems(lots, devices, now), [lots, devices, now]);
  const alertItems = useMemo(() => mapAlertsToAttentionItems(alerts), [alerts]);
  const environment = useMemo(() => computeEnvironmentAverages(devices), [devices]);
  const lowConfidenceAlertCount = useMemo(
    () => alerts.filter((entry) => entry.anomaly.confidence !== "HIGH").length,
    [alerts]
  );
  const trendableLots = useMemo(() => lots.filter((lot) => lot.weightTrend !== null), [lots]);

  const scopeIsEmpty = overview.farms.length === 0 && overview.lots.length === 0 && overview.devices.length === 0;

  const [primarySection, ...secondarySections] = SECTION_ORDER[overview.role];

  function handleFarmChange(farmId: string) {
    setFilters((current) => ({ ...current, farmId, buildingId: "ALL" }));
  }

  const sections: Record<SectionKey, ReactNode> = {
    alerts: (
      <Card key="alerts">
        <CardHeader>
          <CardTitle>Alertes actives</CardTitle>
          <CardDescription>
            {alerts.length} alerte(s) ouverte(s) ou prise(s) en compte dans ce périmètre
            {lowConfidenceAlertCount > 0 ? `, dont ${lowConfidenceAlertCount} à confiance réduite en raison de la qualité des données` : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NeedsAttentionList items={alertItems} />
        </CardContent>
      </Card>
    ),
    performance: (
      <Card key="performance">
        <CardHeader>
          <CardTitle>Tendances de performance</CardTitle>
          <CardDescription>Évolution du poids moyen (7 derniers jours vs 7 jours précédents) pour les lots actifs.</CardDescription>
        </CardHeader>
        <CardContent>
          {trendableLots.length === 0 ? (
            <EmptyState title="Aucune tendance disponible" description="Aucun lot actif avec assez d'historique de pesée dans ce périmètre." />
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {trendableLots.map((lot) => (
                <Link
                  key={lot.id}
                  href={`/lots/${lot.id}`}
                  className="focus-ring flex items-center justify-between gap-3 py-2 text-sm transition-colors hover:bg-background"
                >
                  <span className="font-medium text-text">{lot.code}</span>
                  <span className="text-xs text-secondary">{lot.farmName} · {lot.buildingCode}</span>
                  {lot.weightTrend ? <TrendBadge trend={lot.weightTrend} /> : null}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    ),
    chart: (
      <Card key="chart">
        <CardHeader>
          <CardTitle>Performance — alimentation</CardTitle>
          <CardDescription>Quantité distribuée par jour (kg), {filters.periodDays} derniers jours.</CardDescription>
        </CardHeader>
        <CardContent>
          <PerformanceTrendChart points={trend} unit="kg" label="Alimentation" />
        </CardContent>
      </Card>
    ),
    iot: (
      <Card key="iot">
        <CardHeader>
          <CardTitle>Vue IoT</CardTitle>
          <CardDescription>Santé des appareils et aperçu environnemental du périmètre sélectionné.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {devices.length === 0 ? (
            <EmptyState icon={Radio} title="Aucun appareil" description="Aucun appareil IoT dans ce périmètre." />
          ) : (
            <>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <MiniStat label="Appareils" value={devices.length} />
                <MiniStat label="En ligne" value={devices.filter((d) => d.status === "ONLINE").length} tone="text-success-strong" />
                <MiniStat label="Hors ligne" value={devices.filter((d) => d.status === "OFFLINE").length} tone="text-warning-strong" />
                <MiniStat label="En défaut" value={devices.filter((d) => d.status === "FAULT").length} tone="text-critical-strong" />
              </div>
              <IotEnvironmentSummary
                readings={environment.map((reading) => ({
                  label: MEASUREMENT_TYPE_LABEL[reading.sensorType],
                  value: reading.value,
                  unit: reading.unit,
                  dataStatus: reading.dataStatus,
                  capturedAt: reading.capturedAt,
                }))}
              />
            </>
          )}
        </CardContent>
      </Card>
    ),
    attention: (
      <Card key="attention">
        <CardHeader>
          <CardTitle>À surveiller</CardTitle>
          <CardDescription>Anomalies de données, appareils hors ligne et lots nécessitant une revue.</CardDescription>
        </CardHeader>
        <CardContent>
          <NeedsAttentionList items={needsAttention} />
        </CardContent>
      </Card>
    ),
    quality: (
      <Card key="quality">
        <CardHeader>
          <CardTitle>Qualité des données</CardTitle>
          <CardDescription>Calculée à partir de {quality.totalRecords} enregistrement(s) structuré(s) dans ce périmètre.</CardDescription>
        </CardHeader>
        <CardContent>
          <ScopeDataQualityCard summary={quality} />
        </CardContent>
      </Card>
    ),
    activity: (
      <Card key="activity">
        <CardHeader>
          <CardTitle>Activité récente</CardTitle>
          <CardDescription>Derniers événements enregistrés dans ce périmètre.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityFeed events={events} />
        </CardContent>
      </Card>
    ),
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tableau de bord opérationnel"
        description={overview.scopeLabel}
        meta={<DataStatusBadge status="SIMULATION" />}
        actions={<DashboardClock initialIso={overview.generatedAt} />}
      />

      <div className="flex flex-wrap items-center gap-2 sm:gap-3" role="group" aria-label="Filtres du tableau de bord">
        {overview.farms.length > 1 ? (
          <Select
            value={filters.farmId}
            onChange={(event) => handleFarmChange(event.target.value)}
            className="w-full sm:w-56"
            aria-label="Filtrer par ferme"
          >
            <option value="ALL">Toutes les fermes</option>
            {overview.farms.map((farm) => (
              <option key={farm.id} value={farm.id}>
                {farm.name}
              </option>
            ))}
          </Select>
        ) : overview.farms.length === 1 ? (
          <span className="text-xs font-medium text-secondary">Ferme : {overview.farms[0].name}</span>
        ) : null}

        {overview.buildings.length > 1 ? (
          <Select
            value={filters.buildingId}
            onChange={(event) => setFilters((current) => ({ ...current, buildingId: event.target.value }))}
            className="w-full sm:w-56"
            aria-label="Filtrer par bâtiment"
          >
            <option value="ALL">Tous les bâtiments</option>
            {buildingOptions.map((building) => (
              <option key={building.id} value={building.id}>
                {building.code} — {building.name}
              </option>
            ))}
          </Select>
        ) : null}

        <Select
          value={String(filters.periodDays)}
          onChange={(event) => setFilters((current) => ({ ...current, periodDays: Number(event.target.value) as PeriodDays }))}
          className="w-full sm:w-44"
          aria-label="Période"
        >
          {PERIOD_OPTIONS.map((days) => (
            <option key={days} value={days}>
              {days} derniers jours
            </option>
          ))}
        </Select>
      </div>

      {scopeIsEmpty ? (
        <EmptyState title="Aucune donnée" description="Aucune ferme, aucun lot et aucun appareil dans votre périmètre pour le moment." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Lots actifs" value={kpis.activeLots} hint={`${kpis.totalLots} au total`} icon={Bird} />
            <StatCard label="Population" value={kpis.population.toLocaleString("fr-FR")} hint="sujets en périmètre" icon={Users} />
            <StatCard
              tone={kpis.activeAlerts > 0 ? "critical" : "success"}
              label="Alertes actives"
              value={kpis.activeAlerts}
              hint={lowConfidenceAlertCount > 0 ? `${lowConfidenceAlertCount} à confiance réduite` : "aucune à confiance réduite"}
              icon={Bell}
            />
            <StatCard
              label={`Alimentation (${filters.periodDays}j)`}
              value={kpis.feedQuantityKg.toLocaleString("fr-FR")}
              hint="kg distribués"
              icon={Wheat}
            />
            <StatCard
              tone={kpis.devicesFault > 0 ? "critical" : kpis.devicesOffline > 0 ? "warning" : "success"}
              label="IoT"
              value={`${kpis.devicesOnline}/${kpis.devicesTotal}`}
              hint={
                kpis.devicesFault > 0
                  ? `${kpis.devicesFault} en défaut`
                  : kpis.devicesOffline > 0
                    ? `${kpis.devicesOffline} hors ligne`
                    : "tous en ligne"
              }
              icon={Radio}
            />
            <StatCard
              tone={quality.scorePercent >= 90 ? "success" : quality.scorePercent >= 70 ? "warning" : "critical"}
              label="Qualité des données"
              value={`${quality.scorePercent} %`}
              hint={`${quality.errorCount} erreur(s)`}
              icon={ShieldCheck}
            />
          </div>

          {/*
            * The role's top-priority section keeps the full width so it lands in the first
            * viewport; the rest pair up on wide screens. Previously all seven were full-width
            * stacked cards, which pushed everything after the second one below the fold and
            * left ~50% of a 1440px screen empty (§7).
            */}
          {primarySection ? sections[primarySection] : null}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {secondarySections.map((key) => sections[key])}
          </div>
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <span className="text-secondary">
      <strong className={tone ?? "text-text"}>{value}</strong> {label}
    </span>
  );
}
