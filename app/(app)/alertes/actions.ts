"use server";

import { revalidatePath } from "next/cache";
import { repositories } from "@/data/repositories";
import type { PublicError } from "@/domain/shared/errors";
import { handleActionError } from "@/lib/handle-error";
import { requireSession } from "@/services/auth/session";
import { acknowledgeAlert, dismissAlert, resolveAlert } from "@/services/intelligence/alerts";

export interface ActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: PublicError;
}

async function revalidateAfterAlertChange(alertId: string): Promise<void> {
  revalidatePath(`/alertes/${alertId}`);
  revalidatePath("/alertes");
  revalidatePath("/anomalies");
  revalidatePath("/dashboard");
  const alert = await repositories.alerts.findById(alertId);
  const anomaly = alert ? await repositories.anomalies.findById(alert.anomalyId) : null;
  if (anomaly?.lotId) revalidatePath(`/lots/${anomaly.lotId}`);
}

export async function acknowledgeAlertAction(alertId: string, comment?: string): Promise<ActionResult> {
  try {
    const session = await requireSession();
    await acknowledgeAlert(alertId, session, comment);
    await revalidateAfterAlertChange(alertId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function resolveAlertAction(alertId: string, comment?: string, outcome?: string): Promise<ActionResult> {
  try {
    const session = await requireSession();
    await resolveAlert(alertId, session, comment, outcome);
    await revalidateAfterAlertChange(alertId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function dismissAlertAction(alertId: string, comment?: string, outcome?: string): Promise<ActionResult> {
  try {
    const session = await requireSession();
    await dismissAlert(alertId, session, comment, outcome);
    await revalidateAfterAlertChange(alertId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}
