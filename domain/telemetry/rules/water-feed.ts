import { latest, meanOf, medianOf, round1, sumOf, windowPoints, windowValues, type ChannelSeries, fr } from "./series";
import { num } from "./settings";
import type { RuleEvaluator, Verdict } from "./types";

const where = (s: ChannelSeries) => [s.zoneName, s.position].filter(Boolean).join(" · ") || s.sensorCode || s.sensorId;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Whether a window holds at least 80 % of the readings the channel promises; a gap is not a drop. */
function covered(count: number, windowMs: number, intervalSeconds: number): boolean {
  return count >= 0.8 * (windowMs / (intervalSeconds * 1000));
}

/**
 * C01, with C03 and C05 as its diagnosis: consumption over the last hours against the same hours
 * of the previous days. A drop opens an investigation, never an automatic diagnosis — the
 * pressure and water temperature only say where to look.
 */
export const waterProfile: RuleEvaluator = {
  code: "EAU_PROFIL",
  label: "Profil de consommation d'eau",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("EAU_PROFIL");
    const w = num(p, "windowHours") * HOUR;
    const out: Verdict[] = [];
    const pressure = ctx.series.find((s) => s.catalogRef === "C03");
    const waterTemp = latest(ctx.series.find((s) => s.catalogRef === "C05"), ctx.at, 30 * 60)?.value ?? null;
    for (const s of ctx.series.filter((x) => x.catalogRef === "C01" && x.sensorType === "EAU")) {
      const nowVals = windowValues(s, ctx.at - w, ctx.at);
      if (!covered(nowVals.length, w, 120)) continue;
      const refs: number[] = [];
      const refPressure: number[] = [];
      for (let d = 1; d <= num(p, "historyDays"); d++) {
        const end = ctx.at - d * DAY;
        const vals = windowValues(s, end - w, end);
        if (covered(vals.length, w, 120)) refs.push(sumOf(vals));
        // Pressure answers at once, unlike consumption: it is compared over the last hour only.
        const pm = meanOf(windowValues(pressure, end - HOUR, end));
        if (pm !== null) refPressure.push(pm);
      }
      if (refs.length < 2) continue;
      const now = sumOf(nowVals);
      const ref = meanOf(refs)!;
      if (ref <= 0) continue;
      const change = (now - ref) / ref;
      const pressureNow = meanOf(windowValues(pressure, ctx.at - HOUR, ctx.at));
      const pressureRef = meanOf(refPressure);
      const pressureChange = pressureNow !== null && pressureRef ? (pressureNow - pressureRef) / pressureRef : null;
      const pct = Math.round(change * 100);
      const temp = waterTemp !== null ? ` Eau à ${fr(round1(waterTemp))} °C en bout de ligne.` : "";
      let state: Verdict["state"] = "NORMAL";
      let diagnosis = `${Math.round(now)} L sur ${fr(num(p, "windowHours"))} h, ${pct >= 0 ? "+" : ""}${pct} % par rapport aux mêmes heures des jours précédents.${temp}`;
      if (change <= -num(p, "dropPct") / 100) {
        state = "ALERTE";
        const cause =
          pressureChange === null
            ? "pression non mesurée : cause non orientée"
            : pressureChange <= -num(p, "pressureDropPct") / 100
              ? `pression aussi en baisse (${Math.round(pressureChange * 100)} %) : vérifier la pompe ou chercher une fuite en amont`
              : "pression normale : vérifier l'accès à l'eau (pipettes, hauteur des lignes) ou le comportement des animaux";
        diagnosis = `Chute de consommation de ${Math.abs(pct)} % (${Math.round(now)} L contre ${Math.round(ref)} L attendus) — ${cause}. Investigation à mener, pas de diagnostic automatique.${temp}`;
      } else if (change >= num(p, "risePct") / 100) {
        state = "ALERTE";
        diagnosis = `Hausse de consommation de ${pct} % (${Math.round(now)} L contre ${Math.round(ref)} L attendus) : fuite sur ligne, gaspillage ou chaleur.${temp}`;
      }
      out.push({
        subjectKey: s.sensorId,
        subjectLabel: `Eau — ${where(s)}`,
        state,
        value: Math.round(now),
        unit: "L",
        low: Math.round(ref * (1 - num(p, "dropPct") / 100)),
        high: Math.round(ref * (1 + num(p, "risePct") / 100)),
        reference: Math.round(ref),
        referenceLabel: `Attendu ${Math.round(ref)} L sur ${fr(num(p, "windowHours"))} h : mêmes heures des ${refs.length} jours précédents (alerte sous ${Math.round(ref * (1 - num(p, "dropPct") / 100))} L ou au-dessus de ${Math.round(ref * (1 + num(p, "risePct") / 100))} L)`,
        lotId: ctx.occupantOf(s.zoneId, ctx.at)?.lotId ?? null,
        diagnosis,
        context: { expectedLitres: Math.round(ref), pressureChangePct: pressureChange === null ? null : Math.round(pressureChange * 100), waterTemperature: waterTemp },
      });
    }
    return out;
  },
};

/** C02: one line drinking much less than the others while the total holds steady. */
export const lineImbalance: RuleEvaluator = {
  code: "EAU_DESEQUILIBRE_LIGNES",
  label: "Déséquilibre entre lignes d'eau",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("EAU_DESEQUILIBRE_LIGNES");
    const w = num(p, "windowMinutes") * 60_000;
    const lines = ctx.series
      .filter((s) => s.catalogRef === "C02")
      .map((s) => ({ s, now: meanOf(windowValues(s, ctx.at - w, ctx.at)), before: meanOf(windowValues(s, ctx.at - 2 * w, ctx.at - w)) }))
      .filter((l): l is { s: ChannelSeries; now: number; before: number | null } => l.now !== null);
    if (lines.length < 2) return [];
    const totalNow = sumOf(lines.map((l) => l.now));
    const totalBefore = lines.every((l) => l.before !== null) ? sumOf(lines.map((l) => l.before as number)) : null;
    // "À consommation totale constante": when the total itself moves, a gap between lines proves nothing.
    if (totalBefore === null || totalBefore <= 0 || Math.abs(totalNow - totalBefore) / totalBefore > num(p, "totalStabilityPct") / 100) return [];
    const avg = totalNow / lines.length;
    if (avg <= 0) return [];
    lines.sort((a, b) => a.now - b.now);
    const low = lines[0];
    const high = lines[lines.length - 1];
    const imbalance = (high.now - low.now) / avg;
    const state = imbalance > num(p, "imbalancePct") / 100 ? "ALERTE" : "NORMAL";
    return [
      {
        subjectKey: `building:${ctx.buildingId}`,
        subjectLabel: `Lignes d'eau — ${ctx.buildingName}`,
        state,
        value: Math.round(imbalance * 100),
        unit: "%",
        high: num(p, "imbalancePct"),
        lotId: ctx.occupantOf(low.s.zoneId, ctx.at)?.lotId ?? null,
        diagnosis:
          state === "ALERTE"
            ? `${where(low.s)} débite ${fr(round1(low.now))} L/min contre ${fr(round1(high.now))} L/min sur ${where(high.s)} (écart ${Math.round(imbalance * 100)} %), total stable : vérifier ce côté du bâtiment.`
            : `Lignes équilibrées (écart ${Math.round(imbalance * 100)} %).`,
        context: { lines: lines.map((l) => ({ where: where(l.s), litresPerMinute: round1(l.now) })) },
      },
    ];
  },
};

/** C04: low level, said as the hours left at the last 24 hours' drawdown. Refills are not counted as consumption. */
export const tankAutonomy: RuleEvaluator = {
  code: "CUVE_AUTONOMIE",
  label: "Autonomie de la cuve",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("CUVE_AUTONOMIE");
    const out: Verdict[] = [];
    for (const s of ctx.series.filter((x) => x.sensorType === "NIVEAU_CUVE" && !x.contextOnly)) {
      const pts = windowPoints(s, ctx.at - DAY, ctx.at);
      if (pts.length < 2) continue;
      let drawn = 0;
      for (let i = 1; i < pts.length; i++) drawn += Math.max(0, pts[i - 1].v - pts[i].v);
      const hours = (pts[pts.length - 1].t - pts[0].t) / HOUR;
      const level = pts[pts.length - 1].v;
      const perHour = hours > 0 ? drawn / hours : 0;
      const remaining = perHour > 0 ? level / perHour : null;
      const state = remaining === null ? "NORMAL" : remaining < num(p, "criticalHours") ? "CRITIQUE" : remaining < num(p, "warnHours") ? "ALERTE" : "NORMAL";
      out.push({
        subjectKey: s.sensorId,
        subjectLabel: `Cuve — ${where(s)}`,
        state,
        value: remaining === null ? null : round1(remaining),
        unit: "H",
        low: num(p, "warnHours"),
        lotId: null,
        diagnosis:
          remaining === null
            ? `${Math.round(level)} L ; aucune consommation sur 24 h.`
            : `${Math.round(level)} L, consommation ${Math.round(perHour)} L/h sur 24 h : rupture dans ${fr(round1(remaining))} h.`,
        context: { levelLitres: Math.round(level), litresPerHour: Math.round(perHour) },
      });
    }
    return out;
  },
};

/**
 * D01: wind makes load cells bounce, so the mass is the median of three readings. A jump up of
 * a delivery's size is recorded as a delivery; the stock is said in days at the last day's draw.
 */
export const siloStock: RuleEvaluator = {
  code: "SILO_STOCK",
  label: "Stock d'aliment en silo",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("SILO_STOCK");
    const out: Verdict[] = [];
    for (const s of ctx.series.filter((x) => x.sensorType === "MASSE_SILO")) {
      const raw = windowPoints(s, ctx.at - 2 * DAY, ctx.at);
      if (raw.length < 3) continue;
      const filtered = raw.slice(2).map((pt, i) => ({ t: pt.t, v: medianOf([raw[i].v, raw[i + 1].v, pt.v]) as number }));
      const memory = ctx.memory("SILO_STOCK", s.sensorId);
      const lastDelivery = typeof memory?.lastDeliveryAt === "number" ? memory.lastDeliveryAt : 0;
      const derivedEvents: NonNullable<Verdict["derivedEvents"]> = [];
      let newestDelivery = lastDelivery;
      let drawnDay = 0;
      for (let i = 1; i < filtered.length; i++) {
        const delta = filtered[i].v - filtered[i - 1].v;
        if (delta >= num(p, "deliveryMinKg") && filtered[i].t > lastDelivery) {
          derivedEvents.push({ kind: "LIVRAISON_ALIMENT_DETECTEE", at: filtered[i].t, sensorId: s.sensorId, payload: { deliveredKg: Math.round(delta), massAfterKg: Math.round(filtered[i].v) } });
          newestDelivery = Math.max(newestDelivery, filtered[i].t);
        }
        if (filtered[i].t > ctx.at - DAY && delta < 0) drawnDay += -delta;
      }
      const mass = filtered[filtered.length - 1].v;
      const days = drawnDay > 0 ? mass / drawnDay : null;
      const state = days === null ? "NORMAL" : days < num(p, "criticalDays") ? "CRITIQUE" : days < num(p, "warnDays") ? "ALERTE" : "NORMAL";
      out.push({
        subjectKey: s.sensorId,
        subjectLabel: `Silo — ${where(s)}`,
        state,
        value: days === null ? null : round1(days),
        unit: "J",
        low: num(p, "warnDays"),
        lotId: ctx.occupantOf(s.zoneId, ctx.at)?.lotId ?? null,
        diagnosis:
          days === null
            ? `${Math.round(mass)} kg en silo ; pas de consommation mesurée sur 24 h.`
            : `${Math.round(mass)} kg en silo, ${Math.round(drawnDay)} kg consommés sur 24 h : ${fr(round1(days))} jour(s) de stock.`,
        context: { massKg: Math.round(mass), consumedLast24hKg: Math.round(drawnDay) },
        memory: { lastDeliveryAt: newestDelivery },
        derivedEvents,
      });
    }
    return out;
  },
};

/** D04 × controller: the motor is commanded, yet the end of the line does not turn. */
export const screwNoRotation: RuleEvaluator = {
  code: "VIS_SANS_ROTATION",
  label: "Vis commandée sans rotation",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("VIS_SANS_ROTATION");
    const delay = num(p, "delayMinutes") * 60_000;
    const commands = ctx.series.filter((s) => s.sensorType === "COMMANDE_VIS");
    const out: Verdict[] = [];
    for (const r of ctx.series.filter((s) => s.sensorType === "ROTATION_VIS")) {
      const cmd = commands.find((c) => c.position && c.position === r.position) ?? (commands.length === 1 ? commands[0] : undefined);
      if (!cmd) continue;
      const before = latest(cmd, ctx.at - delay, 10 * 60);
      const cmdWindow = windowValues(cmd, ctx.at - delay, ctx.at);
      const rot = windowValues(r, ctx.at - delay, ctx.at);
      if (!before || rot.length === 0) continue;
      const commanded = before.value >= 0.5 && cmdWindow.every((v) => v >= 0.5);
      const stalled = rot.every((v) => v < num(p, "minRpm"));
      const state = commanded && stalled ? "CRITIQUE" : "NORMAL";
      out.push({
        subjectKey: r.sensorId,
        subjectLabel: `Vis d'alimentation — ${where(r)}`,
        state,
        value: round1(Math.max(...rot)),
        unit: "TR/MIN",
        lotId: ctx.occupantOf(r.zoneId, ctx.at)?.lotId ?? null,
        diagnosis:
          state === "CRITIQUE"
            ? `Moteur commandé depuis plus de ${fr(num(p, "delayMinutes"))} min sans aucune rotation en bout de ligne : vis bloquée ou cassée, les animaux ne sont plus alimentés.`
            : commanded
              ? "Moteur commandé, rotation détectée."
              : "Moteur à l'arrêt.",
      });
    }
    return out;
  },
};
