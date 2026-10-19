"use server";

import { revalidatePath } from "next/cache";
import type { FormActionResult } from "@/components/domain/FormDialog";
import { handleActionError } from "@/lib/handle-error";
import { iso, num, opt } from "@/lib/form-values";
import { requireSession } from "@/services/auth/session";
import { decideBandProposal, proposeLearnedBands, saveTechnicianBand, type LearningReport } from "@/services/telemetry/bands";
import { recordCalibration } from "@/services/telemetry/calibration";
import { verifyIngestMessage } from "@/services/telemetry/ingest";
import { endOccupation, startOccupation } from "@/services/telemetry/occupation";
import { provisionBuilding } from "@/services/telemetry/provisioning";
import { saveRuleSettings } from "@/services/telemetry/settings";
import { can } from "@/domain/shared/permissions";

function fail(error: unknown): FormActionResult {
  return { ok: false, error: handleActionError("server-action", error) };
}

export async function saveRuleSettingsAction(v: Record<string, string>): Promise<FormActionResult> {
  try {
    const session = await requireSession();
    const { rule, ...values } = v;
    await saveRuleSettings(rule, null, values, session);
    revalidatePath("/telemetrie/regles");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function learnBandsAction(): Promise<{ ok: boolean; reports?: LearningReport[]; alertsWithoutOutcome?: number; error?: string }> {
  try {
    const session = await requireSession();
    const out = await proposeLearnedBands(session);
    revalidatePath("/telemetrie/bandes");
    return { ok: true, ...out };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error).message };
  }
}

export async function decideBandAction(v: Record<string, string>): Promise<FormActionResult> {
  try {
    const session = await requireSession();
    await decideBandProposal({ proposalId: v.proposalId, accept: v.decision === "ACCEPTER" }, session);
    revalidatePath("/telemetrie/bandes");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function saveBandAction(v: Record<string, string>): Promise<FormActionResult> {
  try {
    const session = await requireSession();
    await saveTechnicianBand(
      {
        bandId: opt(v.bandId),
        sensorType: v.sensorType,
        productionLine: v.productionLine,
        ageDayFrom: num(v.ageDayFrom),
        ageDayTo: num(v.ageDayTo),
        season: v.season,
        low: num(v.low),
        high: num(v.high),
        unit: v.unit,
        note: v.note,
      },
      session
    );
    revalidatePath("/telemetrie/bandes");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function recordCalibrationAction(v: Record<string, string>): Promise<FormActionResult> {
  try {
    const session = await requireSession();
    await recordCalibration(
      {
        sensorId: v.sensorId,
        calibratedAt: iso(v.calibratedAt),
        method: v.method,
        referenceInstrument: v.referenceInstrument,
        referenceValue: num(v.referenceValue),
        measuredValue: num(v.measuredValue),
        tolerance: num(v.tolerance),
        offsetApplied: num(v.offsetApplied) ?? null,
        intervalDays: num(v.intervalDays),
        evidenceRef: v.evidenceRef,
      },
      session
    );
    revalidatePath("/telemetrie/etalonnage");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function startOccupationAction(v: Record<string, string>): Promise<FormActionResult> {
  try {
    const session = await requireSession();
    await startOccupation({ zoneId: v.zoneId, lotId: v.lotId, startedAt: iso(v.startedAt), endedAt: opt(v.endedAt) ? iso(v.endedAt) : null, headCount: num(v.headCount) ?? null, note: opt(v.note) }, session);
    revalidatePath("/telemetrie/occupation");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function endOccupationAction(v: Record<string, string>): Promise<FormActionResult> {
  try {
    const session = await requireSession();
    await endOccupation({ occupationId: v.occupationId, endedAt: iso(v.endedAt) }, session);
    revalidatePath("/telemetrie/occupation");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function provisionBuildingAction(v: Record<string, string>): Promise<FormActionResult> {
  try {
    const session = await requireSession();
    const incubators = opt(v.incubators)?.split(/[;,\s]+/).filter(Boolean);
    await provisionBuilding(v.buildingId, { drinkingLines: num(v.drinkingLines), feedLines: num(v.feedLines), incubators }, session);
    revalidatePath("/telemetrie");
    return { ok: true, redirectTo: `/telemetrie/${v.buildingId}` };
  } catch (error) {
    return fail(error);
  }
}

export async function verifyMessageAction(messageId: string): Promise<{ status: string }> {
  const session = await requireSession();
  if (!can(session, "VIEW", "INTEGRITY") && !can(session, "VIEW", "IOT")) return { status: "INTERDIT" };
  return { status: (await verifyIngestMessage(messageId)).status };
}
