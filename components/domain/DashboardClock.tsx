"use client";

import { useEffect, useState } from "react";

/**
 * Ticking date/time display for the dashboard header (phase-5 brief §3). Renders the
 * server-provided timestamp on first paint (so SSR and hydration match exactly), then
 * ticks client-side — the only "live" behavior on this page; no data polling here.
 */
export function DashboardClock({ initialIso }: { initialIso: string }) {
  const [now, setNow] = useState(() => new Date(initialIso));

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="text-xs text-secondary" suppressHydrationWarning>
      {now.toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}
