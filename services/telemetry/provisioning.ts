import { repositories } from "../../data/repositories";
import { CONTROLLER_CHANNELS, sensorSpec, type SensorSpec } from "../../domain/telemetry/catalog";
import type { Zone } from "../../domain/telemetry/types";
import type { DeviceType, SensorType, ZoneKind } from "../../domain/shared/enums";
import { AuthorizationError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveBuildingHierarchy } from "../identity/scope-check";

/**
 * Equips a building as document 2's reference case lays it out: three rearing zones along the
 * 50 m building, the sensors at their placement, the climate controller read-only, one gateway.
 * Quantities are the reference case's formulas ("à recalculer après relevé"); the screen can
 * change the number of drinking and feeding lines.
 */
export interface ProvisionOptions {
  drinkingLines?: number;
  feedLines?: number;
  incubators?: string[];
  installedAt?: string;
}

interface Planned {
  ref: string;
  n: number;
  zone: string;
  position: string;
  height: number | null;
  deviceType: DeviceType;
  channels?: SensorType[];
}

const SHORT: Partial<Record<SensorType, string>> = {
  TEMPERATURE: "T",
  HUMIDITE: "RH",
  PLUIE: "PL",
  VENT: "VT",
  HUMIDITE_SOL: "HS",
  TEMPERATURE_SOL: "TS",
  VENTILATION: "VENT",
  VOLETS: "VOL",
  COMMANDE_VIS: "CMD",
  TEMPERATURE_MACHINE: "TM",
};

function rearingPlan(opts: ProvisionOptions): Planned[] {
  const lines = opts.drinkingLines ?? 4;
  const feeds = opts.feedLines ?? 2;
  const p: Planned[] = [
    { ref: "A01", n: 1, zone: "Z1", position: "8,5 m", height: 0.3, deviceType: "CAPTEUR" },
    { ref: "A01", n: 2, zone: "Z2", position: "25 m", height: 0.3, deviceType: "CAPTEUR" },
    { ref: "A01", n: 3, zone: "Z3", position: "41,5 m", height: 0.3, deviceType: "CAPTEUR" },
    { ref: "A02", n: 1, zone: "Z1", position: "12 m", height: 0.3, deviceType: "CAPTEUR" },
    { ref: "A02", n: 2, zone: "Z3", position: "38 m", height: 0.3, deviceType: "CAPTEUR" },
    { ref: "A03", n: 1, zone: "Z1", position: "12 m côté paroi", height: 0.3, deviceType: "CAPTEUR" },
    { ref: "A03", n: 2, zone: "Z3", position: "38 m côté paroi", height: 0.3, deviceType: "CAPTEUR" },
    { ref: "A04", n: 1, zone: "Z2", position: "25 m côté litière", height: 0.3, deviceType: "CAPTEUR" },
    { ref: "A05", n: 1, zone: "Z2", position: "Centre, hors flux", height: 1.6, deviceType: "CAPTEUR" },
    { ref: "A06", n: 1, zone: "Z1", position: "12 m mangeoires", height: 1.0, deviceType: "CAPTEUR" },
    { ref: "A06", n: 2, zone: "Z3", position: "38 m mangeoires", height: 1.0, deviceType: "CAPTEUR" },
    { ref: "C01", n: 1, zone: "Z1", position: "Arrivée d'eau après régulateur", height: null, deviceType: "CAPTEUR" },
    { ref: "C03", n: 1, zone: "Z3", position: "Bout de ligne, 47,6 m", height: null, deviceType: "CAPTEUR" },
    { ref: "C05", n: 1, zone: "Z3", position: "Bout de ligne, 47,6 m", height: null, deviceType: "CAPTEUR" },
    { ref: "D01", n: 1, zone: "Z1", position: "Silo 1, 4 cellules", height: null, deviceType: "CAPTEUR" },
    { ref: "E01", n: 1, zone: "Z2", position: "Tiers central, côté gauche", height: null, deviceType: "CAPTEUR" },
    { ref: "E01", n: 2, zone: "Z2", position: "Tiers central, côté droit", height: null, deviceType: "CAPTEUR" },
    { ref: "E02", n: 1, zone: "Z2", position: "Balance mobile (protocole)", height: null, deviceType: "CAPTEUR" },
    { ref: "F02", n: 1, zone: "Z1", position: "5 m", height: 2.8, deviceType: "CAMERA" },
    { ref: "F02", n: 2, zone: "Z2", position: "25 m", height: 2.8, deviceType: "CAMERA" },
    { ref: "F02", n: 3, zone: "Z3", position: "45 m", height: 2.8, deviceType: "CAMERA" },
    { ref: "L01", n: 1, zone: "ARM", position: "Armoire, alimentation séparée", height: null, deviceType: "ALARME_GSM" },
    { ref: "L03", n: 1, zone: "Z1", position: "Position représentative", height: null, deviceType: "CAPTEUR" },
    { ref: "L03", n: 2, zone: "Z3", position: "Position représentative", height: null, deviceType: "CAPTEUR" },
    { ref: "O01", n: 1, zone: "Z1", position: "Porte du bâtiment", height: 1.6, deviceType: "CONTROLE_ACCES" },
    { ref: "PLC", n: 1, zone: "ARM", position: "Automate de régulation", height: null, deviceType: "AUTOMATE", channels: ["VENTILATION", "VOLETS", ...Array.from({ length: feeds }, () => "COMMANDE_VIS" as const)] },
  ];
  for (let i = 1; i <= lines; i++) p.push({ ref: "C02", n: i, zone: i <= lines / 2 ? "Z1" : "Z3", position: `Ligne ${i}`, height: null, deviceType: "CAPTEUR" });
  for (let i = 1; i <= feeds; i++) p.push({ ref: "D04", n: i, zone: "Z3", position: `Ligne ${i}`, height: null, deviceType: "CAPTEUR" });
  return p;
}

function sitePlan(): Planned[] {
  return [
    { ref: "B01", n: 1, zone: "SITE", position: "2 m, à 10 m des bâtiments", height: 2, deviceType: "STATION_METEO" },
    { ref: "B02", n: 1, zone: "PARCOURS", position: "Près de la sortie", height: null, deviceType: "CAPTEUR" },
    { ref: "B02", n: 2, zone: "PARCOURS", position: "Zone éloignée", height: null, deviceType: "CAPTEUR" },
    { ref: "C04", n: 1, zone: "SITE", position: "Réservoir tampon", height: null, deviceType: "CAPTEUR" },
  ];
}

function hatcheryPlan(opts: ProvisionOptions): Planned[] {
  const p: Planned[] = [];
  for (const inc of opts.incubators ?? ["INC-1"]) {
    for (const [i, pos] of ["HAUT", "MILIEU", "BAS", "REPRISE"].entries()) {
      p.push({ ref: "H06", n: i + 1, zone: inc, position: pos, height: null, deviceType: "CAPTEUR" });
    }
    p.push({ ref: "PLC", n: 1, zone: inc, position: "Sortie de communication de la machine", height: null, deviceType: "AUTOMATE", channels: ["TEMPERATURE_MACHINE"] });
  }
  p.push({ ref: "H06b", n: 1, zone: "OEUFS", position: "PORTE", height: null, deviceType: "CAPTEUR" });
  p.push({ ref: "H06b", n: 2, zone: "OEUFS", position: "FOND", height: null, deviceType: "CAPTEUR" });
  p.push({ ref: "H03", n: 1, zone: "OEUFS", position: "Plateau, centre du chariot", height: null, deviceType: "ENREGISTREUR" });
  p.push({ ref: "O01", n: 1, zone: "OEUFS", position: "Accès couvoir", height: 1.6, deviceType: "CONTROLE_ACCES" });
  p.push({ ref: "L01", n: 1, zone: "ARM", position: "Armoire, alimentation séparée", height: null, deviceType: "ALARME_GSM" });
  return p;
}

const ZONE_NAMES: Record<string, [string, ZoneKind]> = {
  Z1: ["Zone avant (0–17 m)", "ELEVAGE"],
  Z2: ["Zone centrale (17–33 m)", "ELEVAGE"],
  Z3: ["Zone arrière (33–50 m)", "ELEVAGE"],
  ARM: ["Armoire", "ARMOIRE"],
  SITE: ["Site", "SITE"],
  PARCOURS: ["Parcours extérieur", "PARCOURS"],
  OEUFS: ["Salle des œufs", "SALLE_OEUFS"],
};

export interface ProvisionResult {
  gatewayCode: string;
  zones: Zone[];
  devices: number;
  sensors: number;
}

/** Same as provisionBuilding, without the permission check — for the seed and tests. */
export async function provisionBuildingUnchecked(buildingId: string, opts: ProvisionOptions = {}): Promise<ProvisionResult> {
  const building = await repositories.buildings.findById(buildingId);
  if (!building) throw new NotFoundError("Building", buildingId);
  if ((await repositories.devices.listByBuilding(buildingId)).some((d) => d.type === "PASSERELLE")) {
    throw new ValidationError("Ce bâtiment est déjà équipé d'une passerelle.");
  }
  const installedAt = opts.installedAt ?? new Date().toISOString();
  const isHatchery = building.zoneType === "COUVOIR";
  const prefix = building.code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const farmZones = await repositories.zones.listByFarm(building.farmId);
  const needsSite = !isHatchery && !farmZones.some((z) => z.kind === "SITE");
  const plan = isHatchery ? hatcheryPlan(opts) : [...rearingPlan(opts), ...(needsSite ? sitePlan() : [])];

  const zones = new Map<string, Zone>();
  for (const key of Array.from(new Set(plan.map((p) => p.zone)))) {
    const [name, kind] = ZONE_NAMES[key] ?? [`Incubateur ${key}`, "INCUBATEUR"];
    const siteLevel = kind === "SITE" || kind === "PARCOURS";
    const code = siteLevel ? key : `${prefix}-${key}`;
    const existing = farmZones.find((z) => z.code === code);
    zones.set(key, existing ?? (await repositories.zones.create({ farmId: building.farmId, buildingId: siteLevel ? null : building.id, code, name: siteLevel ? name : `${name} — ${building.code}`, kind })));
  }

  const gateway = await repositories.devices.create({
    buildingId,
    code: `GW-${prefix}`,
    type: "PASSERELLE",
    status: "OFFLINE",
    installedAt,
    lastCommunicationAt: null,
    batteryLevel: null,
    signalQuality: null,
  });

  let deviceCount = 1;
  let sensorCount = 0;
  for (const item of plan) {
    const spec: SensorSpec = item.ref === "PLC" ? CONTROLLER_CHANNELS : sensorSpec(item.ref)!;
    const zone = zones.get(item.zone)!;
    // Incubator equipment repeats per machine, so the machine is part of its code.
    const deviceCode =
      zone.kind === "INCUBATEUR"
        ? `${prefix}-${item.zone}-${item.ref}${item.ref === "PLC" ? "" : `-${item.n}`}`
        : `${prefix}-${item.ref}-${item.ref === "PLC" ? zone.code.replace(`${prefix}-`, "") : item.n}`;
    const device = await repositories.devices.create({
      buildingId,
      code: deviceCode,
      type: item.deviceType,
      status: "OFFLINE",
      installedAt,
      lastCommunicationAt: null,
      batteryLevel: null,
      signalQuality: null,
    });
    await repositories.devices.attach(device.id, { catalogRef: spec.ref, gatewayId: gateway.id });
    deviceCount++;
    const channels = item.channels ?? spec.channels.map((c) => c.type);
    const seen = new Map<SensorType, number>();
    for (const type of channels) {
      const channel = spec.channels.find((c) => c.type === type)!;
      const k = (seen.get(type) ?? 0) + 1;
      seen.set(type, k);
      const short = SHORT[type] ?? type;
      await repositories.sensors.create({
        deviceId: device.id,
        sensorType: type,
        unit: channel.unit,
        status: "OFFLINE",
        configuration: null,
        code: `${deviceCode}-${short}${channels.filter((c) => c === type).length > 1 ? k : ""}`,
        catalogRef: spec.ref,
        zoneId: zone.id,
        // Feed-screw commands are paired with their rotation sensor by line.
        position: type === "COMMANDE_VIS" ? `Ligne ${k}` : item.position,
        mountingHeightM: item.height,
      });
      sensorCount++;
    }
  }
  return { gatewayCode: gateway.code, zones: Array.from(zones.values()), devices: deviceCount, sensors: sensorCount };
}

export async function provisionBuilding(buildingId: string, opts: ProvisionOptions, session: Session): Promise<ProvisionResult> {
  if (!can(session, "EDIT", "IOT") || !can(session, "VIEW", "EQUIPMENT")) throw new AuthorizationError();
  assertInScope(session, await resolveBuildingHierarchy(buildingId));
  const result = await provisionBuildingUnchecked(buildingId, opts);
  await recordAudit({
    actorId: session.userId,
    entityType: "building",
    entityId: buildingId,
    field: "telemetry",
    oldValue: null,
    newValue: `${result.gatewayCode} : ${result.devices} équipements, ${result.sensors} voies`,
    reason: "Équipement du bâtiment selon le cas de référence du document 2",
    relatedLotId: null,
    relatedEventId: null,
  });
  return result;
}
