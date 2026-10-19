import { ageDay, seasonOf, selectBand } from "../bands";
import { SENSOR_TYPE_LABEL, unitLabel } from "../labels";
import { latest, recentMean, round1, windowPoints, type ChannelSeries, fr } from "./series";
import { clockMinutes, inDailyWindow, localMinutesOfDay, num } from "./settings";
import type { EvalContext, RuleEvaluator, Verdict } from "./types";

const where = (s: ChannelSeries) => [s.zoneName, s.position].filter(Boolean).join(" · ") || s.sensorCode || s.sensorId;

/** Outside temperature from the site weather station, the context document 2 asks every band to carry. */
function outsideTemperature(ctx: EvalContext): number | null {
  const station = ctx.series.find((s) => s.catalogRef === "B01" && s.sensorType === "TEMPERATURE");
  return latest(station, ctx.at, 15 * 60)?.value ?? null;
}

/** A01 temperature/humidity and A02 CO₂ against the band for the lot's age, line and season. */
export const learnedBand: RuleEvaluator = {
  code: "BANDE_APPRISE",
  label: "Écart à la bande de référence",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("BANDE_APPRISE");
    const out: Verdict[] = [];
    const outside = outsideTemperature(ctx);
    for (const s of ctx.series) {
      const watched =
        (s.catalogRef === "A01" && (s.sensorType === "TEMPERATURE" || s.sensorType === "HUMIDITE")) ||
        (s.catalogRef === "A02" && s.sensorType === "CO2");
      if (!watched) continue;
      const v = recentMean(s, ctx.at, num(p, "smoothingMinutes"));
      if (v === null) continue;
      const label = `${SENSOR_TYPE_LABEL[s.sensorType]} — ${where(s)}`;
      const occupant = ctx.occupantOf(s.zoneId, ctx.at);
      if (!occupant) {
        out.push({ subjectKey: s.sensorId, subjectLabel: label, state: "NORMAL", value: round1(v), unit: s.unit, lotId: null, diagnosis: "Non jugé : aucun lot n'occupe la zone." });
        continue;
      }
      const age = ageDay(occupant.startedAt, ctx.at);
      const band = selectBand(ctx.bands, s.sensorType, occupant.productionLine, age, seasonOf(ctx.at));
      if (!band) {
        out.push({ subjectKey: s.sensorId, subjectLabel: label, state: "NORMAL", value: round1(v), unit: s.unit, lotId: occupant.lotId, diagnosis: `Non jugé : aucune bande active pour J${age}.` });
        continue;
      }
      const width = Math.max(band.high - band.low, Number.EPSILON);
      const wasOut = ctx.previousState("BANDE_APPRISE", s.sensorId) !== "NORMAL";
      // Hysteresis: once out, a value must come back clearly inside before the state returns to normal.
      const margin = wasOut ? (num(p, "hysteresisPct") / 100) * width : 0;
      const below = band.low + margin - v;
      const above = v - (band.high - margin);
      const outBy = Math.max(below, above, 0);
      const state = outBy === 0 ? "NORMAL" : Math.max(band.low - v, v - band.high) > (num(p, "criticalMarginPct") / 100) * width ? "CRITIQUE" : "ALERTE";
      const u = unitLabel(s.unit);
      const direction = v < band.low ? "en dessous de" : v > band.high ? "au-dessus de" : "dans";
      out.push({
        subjectKey: s.sensorId,
        subjectLabel: label,
        state,
        value: round1(v),
        unit: s.unit,
        low: band.low,
        high: band.high,
        reference: v < band.low ? band.low : band.high,
        referenceLabel: `Bande ${fr(band.low)}–${fr(band.high)} ${u} à J${age} (${band.source === "APPRIS" ? "apprise" : "technicien"}, version ${band.version} en vigueur à cet instant)`,
        bandId: band.id,
        lotId: occupant.lotId,
        diagnosis: `${SENSOR_TYPE_LABEL[s.sensorType]} ${fr(round1(v))} ${u} à J${age} (lot ${occupant.lotCode}), ${direction} la bande ${fr(band.low)}–${fr(band.high)} ${u} (${band.source === "APPRIS" ? "apprise" : "technicien"}, v${band.version}).`,
        context: { age, season: seasonOf(ctx.at), outsideTemperature: outside, insideOutsideGap: outside !== null && s.sensorType === "TEMPERATURE" ? round1(v - outside) : null },
      });
    }
    return out;
  },
};

/** A01: the spread between zones of one building, which a single average hides. */
export const zoneDrift: RuleEvaluator = {
  code: "DERIVE_ENTRE_ZONES",
  label: "Dérive entre zones",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("DERIVE_ENTRE_ZONES");
    const probes = ctx.series
      .filter((s) => s.catalogRef === "A01" && s.sensorType === "TEMPERATURE")
      .map((s) => ({ s, v: recentMean(s, ctx.at, num(p, "smoothingMinutes")) }))
      .filter((x): x is { s: ChannelSeries; v: number } => x.v !== null);
    if (probes.length < 2) return [];
    probes.sort((a, b) => a.v - b.v);
    const cold = probes[0];
    const hot = probes[probes.length - 1];
    const spread = hot.v - cold.v;
    const max = num(p, "maxSpreadC");
    const state = spread > 2 * max ? "CRITIQUE" : spread > max ? "ALERTE" : "NORMAL";
    const occupant = ctx.occupantOf(hot.s.zoneId, ctx.at);
    return [
      {
        subjectKey: `building:${ctx.buildingId}`,
        subjectLabel: `Écart entre zones — ${ctx.buildingName}`,
        state,
        value: round1(spread),
        unit: "C",
        high: max,
        lotId: occupant?.lotId ?? null,
        diagnosis: `Écart de ${fr(round1(spread))} °C entre ${where(hot.s)} (${fr(round1(hot.v))} °C) et ${where(cold.s)} (${fr(round1(cold.v))} °C) ; seuil ${fr(max)} °C.`,
        context: { probes: probes.map((x) => ({ where: where(x.s), value: round1(x.v) })) },
      },
    ];
  },
};

/** A02 × controller: high CO₂ with fans stopped is a breakdown, with fans flat out an undersized ventilation. */
export const co2Ventilation: RuleEvaluator = {
  code: "CO2_VENTILATION",
  label: "CO₂ croisé avec la ventilation",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("CO2_VENTILATION");
    const fans = ctx.series.find((s) => s.sensorType === "VENTILATION");
    const fan = latest(fans, ctx.at, 10 * 60)?.value ?? null;
    const out: Verdict[] = [];
    for (const s of ctx.series.filter((x) => x.catalogRef === "A02" && x.sensorType === "CO2")) {
      const v = recentMean(s, ctx.at, 10);
      if (v === null) continue;
      const high = num(p, "highPpm");
      const occupant = ctx.occupantOf(s.zoneId, ctx.at);
      let state: Verdict["state"] = "NORMAL";
      let diagnosis = `CO₂ ${Math.round(v)} ppm, sous le seuil de ${fr(high)} ppm.`;
      if (v > high) {
        if (fan === null) {
          state = "ALERTE";
          diagnosis = `CO₂ ${Math.round(v)} ppm au-dessus de ${fr(high)} ppm ; état de la ventilation inconnu (automate non lu).`;
        } else if (fan <= num(p, "fansStoppedPct")) {
          state = "CRITIQUE";
          diagnosis = `CO₂ ${Math.round(v)} ppm avec ventilation à ${Math.round(fan)} % : panne technique probable (ventilateurs à l'arrêt).`;
        } else if (fan >= num(p, "fansFullPct")) {
          state = "ALERTE";
          diagnosis = `CO₂ ${Math.round(v)} ppm avec ventilation à ${Math.round(fan)} % : sous-dimensionnement probable de la ventilation.`;
        } else {
          state = "ALERTE";
          diagnosis = `CO₂ ${Math.round(v)} ppm avec ventilation à ${Math.round(fan)} % : la consigne de ventilation ne suffit pas.`;
        }
      }
      out.push({ subjectKey: s.sensorId, subjectLabel: `CO₂ — ${where(s)}`, state, value: Math.round(v), unit: "PPM", high, lotId: occupant?.lotId ?? null, diagnosis, context: { ventilationPct: fan } });
    }
    return out;
  },
};

/**
 * A03: the threshold, and above all the time spent above it over the last 24 hours —
 * "c'est l'exposition qui compte, pas le pic instantané". Each reading counts for the time
 * until the next one, capped at twice the nominal interval so a gap is not counted as exposure.
 */
export const nh3Exposure: RuleEvaluator = {
  code: "NH3_EXPOSITION",
  label: "Exposition cumulée à l'ammoniac",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("NH3_EXPOSITION");
    const threshold = num(p, "thresholdPpm");
    const maxMinutes = num(p, "maxCumulativeMinutes");
    const out: Verdict[] = [];
    for (const s of ctx.series.filter((x) => x.sensorType === "NH3")) {
      const pts = windowPoints(s, ctx.at - 86_400_000, ctx.at);
      if (pts.length === 0) continue;
      const cap = 2 * 120_000;
      let exposedMs = 0;
      for (let i = 0; i < pts.length; i++) {
        if (pts[i].v <= threshold) continue;
        const next = i + 1 < pts.length ? pts[i + 1].t : ctx.at;
        exposedMs += Math.min(next - pts[i].t, cap);
      }
      const minutes = Math.round(exposedMs / 60_000);
      const now = pts[pts.length - 1].v;
      const occupant = ctx.occupantOf(s.zoneId, ctx.at);
      const state = minutes >= maxMinutes ? "CRITIQUE" : now > threshold ? "ALERTE" : "NORMAL";
      out.push({
        subjectKey: s.sensorId,
        subjectLabel: `Ammoniac — ${where(s)}`,
        state,
        value: minutes,
        unit: "MIN",
        high: maxMinutes,
        lotId: occupant?.lotId ?? null,
        diagnosis:
          state === "CRITIQUE"
            ? `${minutes} min cumulées au-dessus de ${fr(threshold)} ppm sur 24 h (toléré : ${fr(maxMinutes)} min). Dernière valeur ${fr(round1(now))} ppm.`
            : state === "ALERTE"
              ? `${fr(round1(now))} ppm, au-dessus du seuil de ${fr(threshold)} ppm ; ${minutes} min cumulées sur 24 h.`
              : `${fr(round1(now))} ppm ; ${minutes} min cumulées au-dessus de ${fr(threshold)} ppm sur 24 h.`,
        context: { lastPpm: round1(now), thresholdPpm: threshold },
      });
    }
    return out;
  },
};

/** A04: any significant value means inspecting the litter, not touching the ventilation. */
export const h2sPresence: RuleEvaluator = {
  code: "H2S_PRESENCE",
  label: "Présence d'hydrogène sulfuré",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("H2S_PRESENCE");
    const out: Verdict[] = [];
    for (const s of ctx.series.filter((x) => x.sensorType === "H2S")) {
      const pts = windowPoints(s, ctx.at - 10 * 60_000, ctx.at);
      if (!pts.length) continue;
      const peak = Math.max(...pts.map((x) => x.v));
      const present = peak >= num(p, "presencePpm");
      out.push({
        subjectKey: s.sensorId,
        subjectLabel: `H₂S — ${where(s)}`,
        state: present ? "ALERTE" : "NORMAL",
        value: round1(peak),
        unit: "PPM",
        high: num(p, "presencePpm"),
        lotId: ctx.occupantOf(s.zoneId, ctx.at)?.lotId ?? null,
        diagnosis: present
          ? `H₂S détecté (${fr(round1(peak))} ppm) : inspecter la litière. Ne pas corriger par un réglage de ventilation.`
          : `Pas d'H₂S significatif (max ${fr(round1(peak))} ppm sur 10 min).`,
      });
    }
    return out;
  },
};

/** A05 × controller: a pressure that does not follow the fans points at a door, a flap or a filter. */
export const depressionCommand: RuleEvaluator = {
  code: "DEPRESSION_COMMANDE",
  label: "Dépression croisée avec la commande",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("DEPRESSION_COMMANDE");
    const dp = ctx.series.find((s) => s.sensorType === "PRESSION_DIFFERENTIELLE");
    const pressure = recentMean(dp, ctx.at, 6);
    if (!dp || pressure === null) return [];
    const fan = latest(ctx.series.find((s) => s.sensorType === "VENTILATION"), ctx.at, 10 * 60)?.value ?? null;
    const flaps = latest(ctx.series.find((s) => s.sensorType === "VOLETS"), ctx.at, 10 * 60)?.value ?? null;
    const magnitude = Math.abs(pressure);
    let state: Verdict["state"] = "NORMAL";
    let diagnosis = `Dépression ${fr(round1(magnitude))} Pa, cohérente avec la commande.`;
    if (magnitude > num(p, "maxPa")) {
      state = "ALERTE";
      diagnosis = `Dépression ${fr(round1(magnitude))} Pa au-delà de ${fr(num(p, "maxPa"))} Pa${flaps !== null ? ` avec volets à ${Math.round(flaps)} %` : ""} : volet bloqué fermé ou filtre encrassé.`;
    } else if (fan !== null && fan >= num(p, "fansOnPct") && magnitude < num(p, "minPa")) {
      state = "ALERTE";
      diagnosis = `Ventilation à ${Math.round(fan)} % mais dépression de ${fr(round1(magnitude))} Pa seulement : porte restée ouverte ou volet bloqué ouvert.`;
    }
    return [
      {
        subjectKey: `building:${ctx.buildingId}`,
        subjectLabel: `Dépression — ${ctx.buildingName}`,
        state,
        value: round1(magnitude),
        unit: "PA",
        low: num(p, "minPa"),
        high: num(p, "maxPa"),
        lotId: ctx.occupantOf(dp.zoneId, ctx.at)?.lotId ?? null,
        diagnosis,
        context: { ventilationPct: fan, flapsPct: flaps },
      },
    ];
  },
};

/** A06: the programme against the light the birds actually receive — intensity, and switching times. */
export const lightProgramme: RuleEvaluator = {
  code: "LUMIERE_PROGRAMME",
  label: "Programme lumineux",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("LUMIERE_PROGRAMME");
    const on = clockMinutes(String(p.onTime));
    const off = clockMinutes(String(p.offTime));
    const minute = localMinutesOfDay(ctx.at, num(p, "utcOffsetMinutes"));
    const tol = num(p, "shiftToleranceMinutes");
    const nearSwitch = Math.min(Math.abs(minute - on), Math.abs(minute - off), 1440 - Math.abs(minute - on), 1440 - Math.abs(minute - off)) < tol;
    const out: Verdict[] = [];
    for (const s of ctx.series.filter((x) => x.sensorType === "LUMIERE" && x.catalogRef === "A06")) {
      const lux = recentMean(s, ctx.at, 6);
      if (lux === null) continue;
      const shouldBeLit = inDailyWindow(minute, on, off);
      const isLit = lux >= num(p, "litLux");
      const target = num(p, "targetLux");
      let state: Verdict["state"] = "NORMAL";
      let diagnosis = `${fr(round1(lux))} lux, conforme au programme ${p.onTime}–${p.offTime}.`;
      if (!nearSwitch && shouldBeLit && !isLit) {
        state = "ALERTE";
        diagnosis = `Obscurité (${fr(round1(lux))} lux) pendant la plage d'éclairage ${p.onTime}–${p.offTime} : allumage absent ou décalé.`;
      } else if (!nearSwitch && !shouldBeLit && isLit) {
        state = "ALERTE";
        diagnosis = `Éclairé (${fr(round1(lux))} lux) hors de la plage ${p.onTime}–${p.offTime} : extinction absente ou décalée.`;
      } else if (!nearSwitch && shouldBeLit && isLit && Math.abs(lux - target) / target > num(p, "tolerancePct") / 100) {
        state = "ALERTE";
        diagnosis = `${fr(round1(lux))} lux mesurés pour ${fr(target)} lux visés : écart d'intensité de ${Math.round((Math.abs(lux - target) / target) * 100)} %.`;
      }
      out.push({ subjectKey: s.sensorId, subjectLabel: `Lumière — ${where(s)}`, state, value: round1(lux), unit: "LUX", lotId: ctx.occupantOf(s.zoneId, ctx.at)?.lotId ?? null, diagnosis });
    }
    return out;
  },
};
