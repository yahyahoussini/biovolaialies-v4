import { z } from "../../lib/zod";
import { SITE_EVENT_KIND, type ReadingFlag, type SensorType } from "../shared/enums";
import type { ChannelSpec } from "./catalog";

/**
 * The gateway uplink (document 2 ch. 6, document 3 ch. 1). One message per report period in
 * normal running; after an outage the gateway resends its buffer (up to 30 days) as the same
 * messages with the same `seq`, so a message is recognised by (gateway, seq) and a reading by
 * (sensor, capturedAt). Nothing is lost, nothing is counted twice.
 */
export const MAX_READINGS_PER_MESSAGE = 5000;
export const MAX_EVENTS_PER_MESSAGE = 500;

/** The gateway buffers 30 days (document 2 ch. 6); a reading older than that, plus a margin, has a wrong clock behind it. */
export const GATEWAY_BUFFER_DAYS = 30;
/** Beyond this gap between the gateway clock and the server, the gateway's timestamps are not trusted. */
export const CLOCK_TOLERANCE_SECONDS = 300;

const isoInstant = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v)), {
    message: "Horodatage ISO 8601 avec fuseau attendu (ex. 2026-08-16T12:00:00Z).",
  });

export const gatewayMessageSchema = z.object({
  gateway: z.string().trim().min(1).max(80),
  seq: z.number().int().nonnegative(),
  sentAt: isoInstant,
  readings: z
    .array(
      z.object({
        sensor: z.string().trim().min(1).max(120),
        at: isoInstant,
        value: z.number().finite(),
      })
    )
    .max(MAX_READINGS_PER_MESSAGE)
    .default([]),
  /** Set by the gateway simulator: the readings are stored as SIMULATION, never as real data. */
  simulated: z.boolean().optional(),
  events: z
    .array(
      z.object({
        device: z.string().trim().min(1).max(80),
        kind: z.enum(SITE_EVENT_KIND).refine((k) => k !== "LIVRAISON_ALIMENT_DETECTEE", {
          message: "Événement calculé par la plateforme, une passerelle ne peut pas l'envoyer.",
        }),
        at: isoInstant,
        badge: z.string().trim().max(80).optional(),
        mediaRef: z.string().trim().max(500).optional(),
        data: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .max(MAX_EVENTS_PER_MESSAGE)
    .default([]),
});
export type GatewayMessage = z.infer<typeof gatewayMessageSchema>;

/**
 * Fastest credible change per minute for channels where a jump can only be a fault. Working
 * assumption, not a client figure. Mass, volume, pressure and light are left out on purpose:
 * a silo delivery, a door opening or a light switching on are real jumps the rules must see.
 */
const MAX_RATE_PER_MINUTE: Partial<Record<SensorType, number>> = {
  TEMPERATURE: 3,
  TEMPERATURE_EAU: 3,
  TEMPERATURE_SOL: 1,
  HUMIDITE: 15,
};

export interface ReadingCheckInput {
  channel: ChannelSpec | null;
  sensorType: SensorType;
  sensorStatus: "ONLINE" | "OFFLINE" | "FAULT";
  value: number;
  capturedAt: string;
  receivedAt: string;
  gatewayClockOffsetSeconds: number;
  installedAt: string | null;
  calibrationDueAt: string | null;
  previous: { value: number; capturedAt: string } | null;
}

/** Classifies one reading. The reading is always stored; the flag says whether rules and averages may use it. */
export function classifyReading(input: ReadingCheckInput): ReadingFlag {
  const at = Date.parse(input.capturedAt);
  const received = Date.parse(input.receivedAt);
  if (Math.abs(input.gatewayClockOffsetSeconds) > CLOCK_TOLERANCE_SECONDS) return "HORLOGE";
  if (at > received + CLOCK_TOLERANCE_SECONDS * 1000) return "HORLOGE";
  if (at < received - (GATEWAY_BUFFER_DAYS + 1) * 86_400_000) return "HORLOGE";
  if (input.installedAt && at < Date.parse(input.installedAt)) return "HORLOGE";

  if (input.sensorStatus === "FAULT") return "CAPTEUR_HORS_SERVICE";

  if (input.channel) {
    const [lo, hi] = input.channel.plausibleRange;
    if (input.value < lo || input.value > hi) return "HORS_PLAGE_PHYSIQUE";
  }

  if (input.calibrationDueAt && at > Date.parse(input.calibrationDueAt)) return "ETALONNAGE_ECHU";

  const rate = MAX_RATE_PER_MINUTE[input.sensorType];
  if (rate !== undefined && input.previous) {
    const minutes = Math.abs(at - Date.parse(input.previous.capturedAt)) / 60_000;
    if (minutes > 0 && minutes <= 30 && Math.abs(input.value - input.previous.value) / minutes > rate) return "SUSPECT";
  }
  return "OK";
}

export const READING_FLAG_LABEL: Record<ReadingFlag, string> = {
  OK: "Valide",
  SUSPECT: "Saut non physique",
  HORS_PLAGE_PHYSIQUE: "Hors plage physique",
  HORLOGE: "Horodatage non fiable",
  CAPTEUR_HORS_SERVICE: "Capteur hors service",
  ETALONNAGE_ECHU: "Étalonnage échu",
};
