"use server";

import { revalidatePath } from "next/cache";
import type { PublicError } from "@/domain/shared/errors";
import { handleActionError } from "@/lib/handle-error";
import { requireSession } from "@/services/auth/session";
import {
  applyStructureImport,
  createBuilding,
  createCooperative,
  createFarm,
  createOrganization,
  createProducer,
  previewStructureImport,
  updateStructure,
  type StructureImportPreview,
  type StructureLevel,
} from "@/services/identity/structure";

export interface StructureActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: PublicError;
}

/** `parentId` is the organisation of a cooperative, the cooperative of a producer, and so on; none for an organisation. */
export async function createStructureAction(level: StructureLevel, parentId: string | null, values: Record<string, unknown>): Promise<StructureActionResult> {
  try {
    const session = await requireSession();
    switch (level) {
      case "organization":
        await createOrganization(values, session);
        break;
      case "cooperative":
        await createCooperative({ ...values, organizationId: parentId }, session);
        break;
      case "producer":
        await createProducer({ ...values, cooperativeId: parentId }, session);
        break;
      case "farm":
        await createFarm({ ...values, producerId: parentId }, session);
        break;
      case "building":
        await createBuilding({ ...values, farmId: parentId }, session);
        break;
    }
    revalidatePath("/structure");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function updateStructureAction(level: StructureLevel, id: string, values: Record<string, unknown>): Promise<StructureActionResult> {
  try {
    const session = await requireSession();
    await updateStructure(level, id, values, session);
    revalidatePath("/structure");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function previewImportAction(text: string): Promise<StructureActionResult<StructureImportPreview>> {
  try {
    const session = await requireSession();
    return { ok: true, data: await previewStructureImport(text, session) };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function applyImportAction(text: string): Promise<StructureActionResult<StructureImportPreview>> {
  try {
    const session = await requireSession();
    const result = await applyStructureImport(text, session);
    revalidatePath("/structure");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}
