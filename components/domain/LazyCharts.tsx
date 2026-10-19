"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/Loading";

/**
 * Recharts is by far the heaviest client dependency in the app, and it was being pulled into
 * the *initial* bundle of every page that mentions a chart — including the Lot page, whose
 * charts all live inside tabs the user has not opened yet ("Aperçu" is the default). Measured
 * against the production server: /lots/[lotId] shipped 1.45 MB of JS, /dashboard 1.11 MB,
 * against a 677 kB baseline for chartless routes.
 *
 * Loading them on demand moves that cost to the moment a chart is actually rendered. The
 * placeholder reserves the exact chart height, so opening a tab does not shift layout.
 *
 * `ssr: false` is correct here rather than merely convenient: Recharts' ResponsiveContainer
 * measures its parent before drawing, so a server-rendered chart is an empty box either way.
 */
const CHART_HEIGHT = "h-[220px]";

function ChartFallback() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className={CHART_HEIGHT} />
      <Skeleton className="h-3 w-56" />
    </div>
  );
}

export const MeasurementChart = dynamic(
  () => import("./MeasurementChart").then((m) => m.MeasurementChart),
  { ssr: false, loading: ChartFallback }
);

export const PerformanceTrendChart = dynamic(
  () => import("./PerformanceTrendChart").then((m) => m.PerformanceTrendChart),
  { ssr: false, loading: ChartFallback }
);

export const MultiLineChart = dynamic(
  () => import("./MultiLineChart").then((m) => m.MultiLineChart),
  { ssr: false, loading: ChartFallback }
);
