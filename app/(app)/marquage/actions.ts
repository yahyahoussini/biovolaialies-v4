"use server";

import { revalidatePath } from "next/cache";
import type { FormActionResult } from "@/components/domain/FormDialog";
import { MARKING_ROUTE, parseShellCode, type MarkingRoute } from "@/domain/marking/marking";
import { AuthorizationError, ValidationError } from "@/domain/shared/errors";
import { env } from "@/lib/env";
import { handleActionError } from "@/lib/handle-error";
import { num, opt } from "@/lib/form-values";
import { requireSession } from "@/services/auth/session";
import {
  closeMarkingRun,
  createMarkingLine,
  liftReadStop,
  packTray,
  recordCandlingRejects,
  simulateMarking,
  startMarkingRun,
  updateMarkingLine,
} from "@/services/marking/marking";
import { repositories } from "@/data/repositories";

async function run(task: () => Promise<string | void>): Promise<FormActionResult> {
  try {
    const redirectTo = await task();
    revalidatePath("/marquage", "layout");
    return redirectTo ? { ok: true, redirectTo } : { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

/** The form offers sources of both routes in one list, "B:<id>" or "A:<id>": the route follows the source. */
export async function startRunAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const session = await requireSession();
    const [code, sourceId] = (v.source ?? "").split(":");
    const route: MarkingRoute | undefined = code === "A" ? "A_COUVER" : code === "B" ? "B_CONSOMMATION" : undefined;
    if (!route || !MARKING_ROUTE.includes(route)) throw new ValidationError("Choisissez ce que la ligne va marquer.");
    const created = await startMarkingRun({ lineId: v.lineId, route, sourceId, notes: opt(v.notes) }, session);
    return `/marquage/${created.id}`;
  });
}

export async function liftStopAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    await liftReadStop({ runId: v.runId, note: v.note }, await requireSession());
  });
}

export async function closeRunAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    await closeMarkingRun({ runId: v.runId, note: opt(v.note) }, await requireSession());
  });
}

/** A tray declared by hand, from the codes printed on its first and last eggs. */
export async function packTrayAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const session = await requireSession();
    const markingRun = await repositories.marking.findRun(v.runId);
    const line = markingRun ? await repositories.marking.findLine(markingRun.lineId) : null;
    const first = parseShellCode(v.firstCode ?? "");
    const last = parseShellCode(v.lastCode ?? "");
    if (!first?.valid || !last?.valid) throw new ValidationError("Codes illisibles : relisez le premier et le dernier œuf du plateau.");
    if (!line || first.prefix !== line.shellPrefix || last.prefix !== line.shellPrefix) throw new ValidationError("Ces codes n'ont pas été imprimés par cette ligne.");
    await packTray(v.runId, { firstSerial: first.serial, lastSerial: last.serial, capacity: num(v.capacity) ?? null }, session);
  });
}

/** Demonstration only: the line's controller, played by the server through the same functions as the machine API. */
export async function simulateAction(runId: string, preset: "NORMAL" | "ENCRASSEE"): Promise<FormActionResult> {
  return run(async () => {
    if (!env.DEMO_MODE) throw new AuthorizationError("La simulation n'existe qu'en démonstration.");
    const session = await requireSession();
    await simulateMarking(runId, preset === "NORMAL" ? { eggs: 600, failRate: 0.004 } : { eggs: 400, failRate: 0.004, clogAfter: 120, clogRate: 0.12 }, session);
  });
}

export async function createLineAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    const routes = v.routes === "LES_DEUX" ? ["A_COUVER", "B_CONSOMMATION"] : [v.routes];
    await createMarkingLine(
      {
        code: v.code,
        name: v.name,
        buildingId: v.buildingId,
        routes,
        shellPrefix: v.shellPrefix,
        readThreshold: (num(v.readThresholdPct) ?? NaN) / 100,
        readWindow: num(v.readWindow),
        trayCapacity: num(v.trayCapacity),
        protocol: opt(v.protocol),
      },
      await requireSession()
    );
  });
}

export async function updateLineAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(async () => {
    await updateMarkingLine(
      {
        lineId: v.lineId,
        readThreshold: (num(v.readThresholdPct) ?? NaN) / 100,
        readWindow: num(v.readWindow),
        trayCapacity: num(v.trayCapacity),
        protocol: opt(v.protocol),
        active: v.active === "OUI",
        reason: v.reason,
      },
      await requireSession()
    );
  });
}

export async function candlingRejectsAction(v: Record<string, string>): Promise<FormActionResult> {
  try {
    await recordCandlingRejects({ cycleId: v.cycleId, codes: v.codes ?? "" }, await requireSession());
    revalidatePath(`/couvoir/cycles/${v.cycleId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}
