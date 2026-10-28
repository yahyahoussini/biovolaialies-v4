"use server";

import { revalidatePath } from "next/cache";
import type { FormActionResult } from "@/components/domain/FormDialog";
import { ValidationError } from "@/domain/shared/errors";
import { handleActionError } from "@/lib/handle-error";
import { iso, num, opt } from "@/lib/form-values";
import { requireSession } from "@/services/auth/session";
import { createSample, markSampleSent, recordResults, reviewResult } from "@/services/lab/lab";

async function run(task: () => Promise<string | void>): Promise<FormActionResult> {
  try {
    const redirectTo = await task();
    revalidatePath("/laboratoire", "layout");
    revalidatePath("/lots", "layout");
    revalidatePath("/dashboard");
    return redirectTo ? { ok: true, redirectTo } : { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

/** The form offers every target in one list as "<TYPE>:<id>". */
export async function createSampleAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const [objectType, objectId] = (v.target ?? "").split(":");
    if (!objectType || !objectId) throw new ValidationError("Choisissez ce qui a été prélevé.");
    const sample = await createSample(
      { objectType, objectId, matrix: v.matrix, reason: v.reason, sampledAt: iso(v.sampledAt), sampleCount: num(v.sampleCount) ?? null, laboratory: v.laboratory, notes: opt(v.notes) },
      await requireSession()
    );
    return `/laboratoire/${sample.id}`;
  });
}

export async function markSentAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    await markSampleSent({ sampleId: v.sampleId, sentAt: iso(v.sentAt) }, await requireSession());
  });
}

/** One analysis per submission: the dialog stays simple, and a report of several lines is entered line by line. */
export async function recordResultAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    await recordResults(
      {
        sampleId: v.sampleId,
        complete: v.complete === "OUI",
        results: [
          {
            analyte: v.analyte,
            method: opt(v.method),
            value: v.value,
            numericValue: num(v.numericValue) ?? null,
            unit: opt(v.unit),
            interpretation: v.interpretation,
            resultAt: iso(v.resultAt),
            reportRef: opt(v.reportRef),
          },
        ],
      },
      await requireSession()
    );
  });
}

export async function reviewResultAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    await reviewResult({ resultId: v.resultId, note: opt(v.note) }, await requireSession());
  });
}
