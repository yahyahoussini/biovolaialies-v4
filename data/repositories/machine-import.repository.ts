import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { MachineImport } from "../../domain/telemetry/types";
import { db } from "../db/client";
import { machineImports, measurements } from "../db/schema";

export class DrizzleMachineImportRepository {
  async create(input: MachineImport): Promise<MachineImport> {
    const [row] = await db.insert(machineImports).values(input).returning();
    return row;
  }

  async findById(id: string): Promise<MachineImport | null> {
    return (await db.query.machineImports.findFirst({ where: eq(machineImports.id, id) })) ?? null;
  }

  async findByZoneAndSha(zoneId: string, sha256: string): Promise<MachineImport | null> {
    return (await db.query.machineImports.findFirst({ where: and(eq(machineImports.zoneId, zoneId), eq(machineImports.sha256, sha256)) })) ?? null;
  }

  async list(limit: number, zoneIds?: string[]): Promise<MachineImport[]> {
    if (zoneIds && zoneIds.length === 0) return [];
    return db.query.machineImports.findMany({ where: zoneIds ? inArray(machineImports.zoneId, zoneIds) : undefined, orderBy: (t) => desc(t.importedAt), limit });
  }

  /**
   * The readings an import stored, found through the (sensor, capturedAt) index over the period the
   * import covered rather than by scanning every reading for its source.
   */
  async storedReadings(importId: string, sensorIds: string[], from: string, to: string) {
    if (sensorIds.length === 0) return [];
    return db
      .select({ sensorId: measurements.sensorId, capturedAt: measurements.capturedAt, value: measurements.value })
      .from(measurements)
      .where(and(inArray(measurements.sensorId, sensorIds), gte(measurements.capturedAt, from), lte(measurements.capturedAt, to), eq(measurements.sourceId, importId)));
  }
}
