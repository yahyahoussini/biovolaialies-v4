import { eq } from "drizzle-orm";
import type { DeviceRepository } from "../../domain/iot/repositories";
import type { Device, NewDevice } from "../../domain/iot/types";
import { NotFoundError } from "../../domain/shared/errors";
import { db } from "../db/client";
import { devices } from "../db/schema";

export class DrizzleDeviceRepository implements DeviceRepository {
  async findById(id: string): Promise<Device | null> {
    const row = await db.query.devices.findFirst({ where: eq(devices.id, id) });
    return row ?? null;
  }

  async findByCode(code: string): Promise<Device | null> {
    const row = await db.query.devices.findFirst({ where: eq(devices.code, code) });
    return row ?? null;
  }

  async listByBuilding(buildingId: string): Promise<Device[]> {
    return db.query.devices.findMany({
      where: eq(devices.buildingId, buildingId),
      orderBy: (t, { asc }) => asc(t.code),
    });
  }

  async list(): Promise<Device[]> {
    return db.query.devices.findMany({ orderBy: (t, { asc }) => asc(t.code) });
  }

  async create(input: NewDevice): Promise<Device> {
    const [row] = await db.insert(devices).values(input).returning();
    return row;
  }

  async attach(id: string, patch: { catalogRef: string | null; gatewayId: string | null }): Promise<void> {
    await db.update(devices).set(patch).where(eq(devices.id, id));
  }

  async setClock(id: string, clockOffsetSeconds: number, at: string): Promise<void> {
    await db.update(devices).set({ clockOffsetSeconds, lastClockSyncAt: at }).where(eq(devices.id, id));
  }

  async update(
    id: string,
    patch: Partial<Pick<Device, "status" | "lastCommunicationAt" | "batteryLevel" | "signalQuality">>
  ): Promise<Device> {
    const [row] = await db.update(devices).set(patch).where(eq(devices.id, id)).returning();
    if (!row) throw new NotFoundError("Device", id);
    return row;
  }
}
