"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_TICK, CHART, TOOLTIP_STYLE } from "./chart-theme";

const PALETTE = [CHART.series, "#b7791f", "#2b6cb0", "#9b2c2c", "#6b46c1"];

export interface Series {
  label: string;
  points: { capturedAt: string; value: number }[];
}

/** Several aligned series on one time axis — used to show the spread between rearing zones. */
export function MultiLineChart({ series, unit }: { series: Series[]; unit: string }) {
  const times = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.capturedAt)))).sort();
  if (times.length === 0) {
    return <p className="rounded-md border border-dashed border-border py-8 text-center text-caption text-secondary">Aucun historique agrégé pour cette période.</p>;
  }
  const index = series.map((s) => new Map(s.points.map((p) => [p.capturedAt, p.value])));
  const data = times.map((t) => ({
    time: new Date(t).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", day: "2-digit", month: "2-digit", hour: "2-digit" }),
    ...Object.fromEntries(series.map((s, i) => [s.label, index[i].get(t) ?? null])),
  }));
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="sr-only">
        {series.map((s) => `${s.label} : ${s.points.length} moyennes horaires`).join(" ; ")} ({unit}).
      </figcaption>
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART.grid }} interval="preserveStartEnd" minTickGap={40} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={46} unit={` ${unit}`} domain={["auto", "auto"]} />
            <Tooltip formatter={(value) => `${Number(value).toLocaleString("fr-FR")} ${unit}`} {...TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((s, i) => (
              <Line key={s.label} type="monotone" dataKey={s.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
