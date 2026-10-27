"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_TICK, CHART, TOOLTIP_STYLE } from "./chart-theme";

export interface ChartPoint {
  capturedAt: string;
  value: number;
}

/** Deliberately minimal — a single time-series line, no advanced analytics (phase-4 brief §9). Shared by the device detail page and the Lot IoT tab. */
export function MeasurementChart({ points, unit, label = "Valeur" }: { points: ChartPoint[]; unit: string; label?: string }) {
  const data = points
    .slice()
    .reverse()
    .map((point) => ({
      time: new Date(point.capturedAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
      value: point.value,
    }));

  if (data.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border py-8 text-center text-caption text-secondary">
        Aucun historique disponible pour cette période.
      </p>
    );
  }

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  return (
    <figure className="flex flex-col gap-2">
      {/*
       * A chart is invisible to a screen reader. The summary below carries the same
       * information in text (§18), and doubles as a quick read for sighted users.
       */}
      <figcaption className="sr-only">
        {label} : {data.length} mesures, de {min.toLocaleString("fr-FR")} à {max.toLocaleString("fr-FR")} {unit}, entre{" "}
        {data[0].time} et {data[data.length - 1].time}.
      </figcaption>

      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="time"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: CHART.grid }}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={46} unit={` ${unit}`} />
            <Tooltip formatter={(value) => [`${Number(value).toLocaleString("fr-FR")} ${unit}`, label]} {...TOOLTIP_STYLE} />
            <Line
              type="monotone"
              dataKey="value"
              stroke={CHART.series}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: CHART.series, stroke: CHART.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-caption text-secondary">
        {data.length} mesures · min {min.toLocaleString("fr-FR")} {unit} · max {max.toLocaleString("fr-FR")} {unit}
      </p>
    </figure>
  );
}
