"use server";

import { revalidatePath } from "next/cache";
import type { FormActionResult } from "@/components/domain/FormDialog";
import { ValidationError } from "@/domain/shared/errors";
import { handleActionError } from "@/lib/handle-error";
import { iso, num, opt } from "@/lib/form-values";
import { requireSession } from "@/services/auth/session";
import {
  createChickLot,
  createEggLot,
  createHatchCycle,
  createParentFlock,
  placeChicksIntoLot,
  recordCandling,
  recordHatch,
} from "@/services/hatchery/hatchery";
import { repositories } from "@/data/repositories";

async function run(task: () => Promise<string | void>): Promise<FormActionResult> {
  try {
    const redirectTo = await task();
    revalidatePath("/couvoir", "layout");
    return { ok: true, redirectTo: redirectTo || undefined };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function createParentFlockAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const session = await requireSession();
    const flock = await createParentFlock(
      {
        code: v.code,
        buildingId: v.buildingId,
        strain: v.strain,
        geneticSupplier: v.geneticSupplier,
        originCountry: v.originCountry,
        importReference: opt(v.importReference),
        placedAt: iso(v.placedAt),
        femaleCount: num(v.femaleCount),
        maleCount: num(v.maleCount),
        lineCode: opt(v.lineCode),
        hatchedAt: v.hatchedAt ? iso(v.hatchedAt) : null,
        dataStatus: v.dataStatus,
        documentId: opt(v.documentId),
      },
      session
    );
    return `/couvoir/reproducteurs/${flock.id}`;
  });
}

export async function createEggLotAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const session = await requireSession();
    await createEggLot(
      { code: v.code, parentFlockId: v.parentFlockId, collectedAt: iso(v.collectedAt), quantity: num(v.quantity), storageBuildingId: opt(v.storageBuildingId), dataStatus: v.dataStatus },
      session
    );
  });
}

export async function createHatchCycleAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const session = await requireSession();
    // "OAC-1:3000; OAC-2:2000" — lot codes with the eggs drawn from each.
    const allocations = [];
    for (const part of v.allocations.split(/[;\n]/).map((p) => p.trim()).filter(Boolean)) {
      const [code, quantity] = part.split(":").map((x) => x.trim());
      const egg = await repositories.eggLots.findByCode(code);
      if (!egg) throw new ValidationError(`Lot d'œufs « ${code} » introuvable.`);
      allocations.push({ eggLotId: egg.id, quantity: num(quantity) });
    }
    const cycle = await createHatchCycle(
      { code: v.code, buildingId: v.buildingId, incubatorRef: v.incubatorRef, setAt: iso(v.setAt), allocations, dataStatus: v.dataStatus },
      session
    );
    return `/couvoir/cycles/${cycle.id}`;
  });
}

export async function recordCandlingAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const session = await requireSession();
    await recordCandling({ cycleId: v.cycleId, candledAt: iso(v.candledAt), clearsRemoved: num(v.clearsRemoved) }, session);
  });
}

export async function recordHatchAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const session = await requireSession();
    await recordHatch(
      { cycleId: v.cycleId, hatchedAt: iso(v.hatchedAt), chicksHatched: num(v.chicksHatched), unhatched: num(v.unhatched), culls: num(v.culls) },
      session
    );
  });
}

export async function createChickLotAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const session = await requireSession();
    await createChickLot(
      { code: v.code, hatchCycleId: v.hatchCycleId, quantity: num(v.quantity), grade: v.grade, dispatchedAt: iso(v.dispatchedAt), dataStatus: v.dataStatus },
      session
    );
  });
}

export async function placeChicksAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const session = await requireSession();
    const lot = await repositories.lots.findByCode(v.lotCode.trim());
    if (!lot) throw new ValidationError(`Lot d'élevage « ${v.lotCode} » introuvable.`);
    await placeChicksIntoLot({ lotId: lot.id, chickLotId: v.chickLotId, quantity: num(v.quantity) }, session);
    return `/lots/${lot.id}/tracabilite`;
  });
}
