import type { EventType } from "@/domain/shared/enums";

/** Shared by the Lot events timeline and the dashboard activity feed — one label set per event type. */
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  CREATION_LOT: "Création du lot",
  MISE_EN_PLACE: "Mise en place",
  MORTALITE: "Mortalité",
  PESEE: "Pesée",
  ALIMENTATION: "Alimentation",
  TRANSFERT: "Transfert",
  VACCINATION: "Vaccination",
  TRAITEMENT: "Traitement",
  OBSERVATION_SANITAIRE: "Observation sanitaire",
  ABATTAGE: "Abattage",
  DEVICE_CONNECTED: "Appareil connecté",
  DEVICE_OFFLINE: "Appareil hors ligne",
  SENSOR_FAULT: "Capteur en défaut",
  ALERT_ACTION: "Action sur alerte",
  AUTRE: "Autre",
  CHANGEMENT_PHASE: "Changement de phase",
  RECEPTION: "Réception",
};

/** Short human summary of an event's JSON payload, for timelines/activity feeds. */
export function summarizeEventPayload(eventType: EventType, payload: Record<string, unknown>): string | null {
  switch (eventType) {
    case "CREATION_LOT":
      return `Population initiale : ${payload.initialPopulation ?? "—"}`;
    case "MORTALITE":
      return `${payload.quantity ?? "—"} sujet(s)${payload.cause ? ` — ${payload.cause}` : ""}`;
    case "PESEE":
      return `${payload.averageWeightKg ?? "—"} kg en moyenne${payload.sampleSize ? ` (échantillon ${payload.sampleSize})` : ""}`;
    case "ALIMENTATION":
      return `${payload.quantityKg ?? "—"} kg${payload.feedType ? ` — ${payload.feedType}` : ""}`;
    case "TRANSFERT":
      return `${payload.quantity ?? "—"} sujet(s)${payload.destination ? ` → ${payload.destination}` : ""}`;
    case "MISE_EN_PLACE":
      return typeof payload.notes === "string" ? payload.notes : null;
    case "ALERT_ACTION":
      return typeof payload.description === "string" ? payload.description : null;
    case "AUTRE":
      return typeof payload.description === "string" ? payload.description : null;
    case "CHANGEMENT_PHASE":
      return typeof payload.label === "string" ? payload.label : null;
    case "RECEPTION":
      return `${payload.received ?? "—"} reçu(s) vivant(s)${payload.deadOnArrival ? `, ${payload.deadOnArrival} mort(s) à l'arrivée` : ""}${payload.transferCode ? ` — ${payload.transferCode}` : ""}`;
    case "VACCINATION":
      return `${payload.vaccine ?? "—"} — ${payload.disease ?? "—"}`;
    case "TRAITEMENT":
      return `${payload.product ?? "—"} — ${payload.indication ?? "—"}${payload.durationDays ? `, ${payload.durationDays} j` : ""}`;
    case "OBSERVATION_SANITAIRE":
      return typeof payload.signs === "string" ? payload.signs : null;
    default:
      return null;
  }
}
