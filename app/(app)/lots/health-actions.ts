"use server";

import { revalidatePath } from "next/cache";
import type { FormActionResult } from "@/components/domain/FormDialog";
import { handleActionError } from "@/lib/handle-error";
import { iso, num, opt } from "@/lib/form-values";
import { requireSession } from "@/services/auth/session";
import { recordObservation, recordTreatment, recordVaccination, reviewObservation } from "@/services/sanitary/health";

async function run(task: () => Promise<void>): Promise<FormActionResult> {
  try {
    await task();
    revalidatePath("/lots", "layout");
    revalidatePath("/oeufs-consommation", "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function recordVaccinationAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const session = await requireSession();
    await recordVaccination(
      v.lotId,
      {
        vaccine: v.vaccine,
        disease: v.disease,
        batchNumber: opt(v.batchNumber),
        route: v.route,
        dose: opt(v.dose),
        headcount: num(v.headcount) ?? null,
        administeredAt: iso(v.administeredAt),
        operator: opt(v.operator),
        notes: opt(v.notes),
      },
      session
    );
  });
}

export async function recordTreatmentAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const session = await requireSession();
    await recordTreatment(
      v.lotId,
      {
        product: v.product,
        activeSubstance: opt(v.activeSubstance),
        indication: v.indication,
        prescriptionRef: opt(v.prescriptionRef),
        prescriber: opt(v.prescriber),
        route: v.route,
        dose: opt(v.dose),
        startedAt: iso(v.startedAt),
        durationDays: num(v.durationDays),
        withdrawalMeatDays: num(v.withdrawalMeatDays),
        withdrawalEggDays: num(v.withdrawalEggDays) ?? null,
        headcount: num(v.headcount) ?? null,
        notes: opt(v.notes),
      },
      session
    );
  });
}

export async function recordObservationAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const session = await requireSession();
    await recordObservation(v.lotId, { status: v.status, signs: v.signs, affectedCount: num(v.affectedCount) ?? null, observedAt: iso(v.observedAt) }, session);
  });
}

export async function reviewObservationAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const session = await requireSession();
    await reviewObservation({ observationId: v.observationId, decision: v.decision, comment: opt(v.comment) }, session);
  });
}
