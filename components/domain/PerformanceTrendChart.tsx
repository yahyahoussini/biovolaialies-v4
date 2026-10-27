"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendPoint } from "@/services/dashboard/types";
import { AXIS_TICK, CHART, TOOLTIP_STYLE } from "./chart-theme";

/**
 * Daily-bucket trend for the dashboard's "Performance overview" (phase-5 brief §5) — deliberately
 * a single series, no secondary axes/annotations, matching the minimal-chart precedent set by
 * components/domain/MeasurementChart.tsx.
 */
export function PerformanceTrendChart({ points, unit, label }: { points: TrendPoint[]; unit: string; label: string }) {
  const hasData = points.some((point) => point.value > 0);
  if (!hasData) {
    return (
      <p className="rounded-md border border-dashed border-border py-8 text-center text-caption text-secondary">
        Aucune donnée d&apos;alimentation enregistrée sur cette période.
      </p>
    );
  }

  const data = points.map((point) => ({
    day: new Date(point.date).toLocaleDateString("fr-FR", { timeZone: "Africa/Casablanca", day: "2-digit", month: "2-digit" }),
    value: point.value,
  }));

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0]);

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="sr-only">
        {label} par jour en {unit}. Total {total.toLocaleString("fr-FR")} {unit} sur {data.length} jours, maximum{" "}
        {peak.value.toLocaleString("fr-FR")} {unit} le {peak.day}.
      </figcaption>

      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: CHART.grid }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} unit={` ${unit}`} />
            <Tooltip formatter={(value) => [`${Number(value).toLocaleString("fr-FR")} ${unit}`, label]} {...TOOLTIP_STYLE} />
            <Bar dataKey="value" fill={CHART.series} radius={[3, 3, 0, 0]} maxBarSize={44} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-caption text-secondary">
        Total {total.toLocaleString("fr-FR")} {unit} · pic {peak.value.toLocaleString("fr-FR")} {unit} le {peak.day}
      </p>
    </figure>
  );
}
