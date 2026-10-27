"use server";

import { revalidatePath } from "next/cache";
import type { FormActionResult } from "@/components/domain/FormDialog";
import { repositories } from "@/data/repositories";
import { ValidationError } from "@/domain/shared/errors";
import { handleActionError } from "@/lib/handle-error";
import { iso, num, opt } from "@/lib/form-values";
import { requireSession } from "@/services/auth/session";
import { importParentStock } from "@/services/hatchery/hatchery";
import { addIdentifierAlias, retireIdentifierAlias } from "@/services/identity/bvu-ids";
import { updateProductionLine } from "@/services/production/lines";
import { startLotPhase } from "@/services/production/phases";
import { changeSubjectStatus, recordSubjectEvent, registerSubjects, releaseSubjectRfid } from "@/services/production/subjects";
import { changeTableEggLotStatus, createTableEggLot } from "@/services/production/table-eggs";
import { cancelTransfer, dispatchTransfer, disputeTransfer, receiveTransfer } from "@/services/production/transfers";

async function run(paths: string[], task: () => Promise<string | void>): Promise<FormActionResult> {
  try {
    const redirectTo = await task();
    for (const path of paths) revalidatePath(path, "layout");
    return { ok: true, redirectTo: redirectTo || undefined };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function startPhaseAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/lots", "/lignes"], async () => {
    const session = await requireSession();
    await startLotPhase({ lotId: v.lotId, phase: v.phase, startedAt: iso(v.startedAt), buildingId: opt(v.buildingId), notes: opt(v.notes) }, session);
  });
}

export async function dispatchTransferAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/transferts", "/lots", "/couvoir"], async () => {
    const session = await requireSession();
    const transfer = await dispatchTransfer(
      {
        objectType: v.objectType,
        objectId: v.objectId,
        destinationBuildingId: v.destinationBuildingId,
        destinationLotId: opt(v.destinationLotId),
        destinationLotCode: opt(v.destinationLotCode),
        destinationLineCode: opt(v.destinationLineCode),
        phaseOnArrival: opt(v.phaseOnArrival),
        quantity: num(v.quantity),
        sentAt: iso(v.sentAt),
        documentRef: opt(v.documentRef),
        transporter: opt(v.transporter),
        vehicle: opt(v.vehicle),
        crates: num(v.crates) ?? null,
        notes: opt(v.notes),
        signerName: v.signerName,
      },
      session
    );
    return `/transferts/${transfer.id}`;
  });
}

export async function receiveTransferAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/transferts", "/lots", "/couvoir"], async () => {
    const session = await requireSession();
    await receiveTransfer(
      { transferId: v.transferId, quantityReceived: num(v.quantityReceived), deadOnArrival: num(v.deadOnArrival) ?? 0, receivedAt: iso(v.receivedAt), discrepancyReason: opt(v.discrepancyReason), signerName: v.signerName },
      session
    );
  });
}

export async function cancelTransferAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/transferts", "/lots"], async () => {
    const session = await requireSession();
    await cancelTransfer({ transferId: v.transferId, reason: v.reason }, session);
  });
}

export async function disputeTransferAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/transferts"], async () => {
    const session = await requireSession();
    await disputeTransfer({ transferId: v.transferId, reason: v.reason }, session);
  });
}

export async function createTableEggLotAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/oeufs-consommation", "/lots"], async () => {
    const session = await requireSession();
    const eggs = await createTableEggLot(
      {
        code: v.code,
        lotId: v.lotId,
        collectedOn: iso(v.collectedOn),
        eggType: opt(v.eggType),
        quantity: num(v.quantity),
        saleable: num(v.saleable),
        cracked: num(v.cracked) ?? 0,
        dirty: num(v.dirty) ?? 0,
        small: num(v.small) ?? 0,
        dataStatus: v.dataStatus,
      },
      session
    );
    return `/oeufs-consommation/${eggs.id}`;
  });
}

export async function changeTableEggStatusAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/oeufs-consommation"], async () => {
    const session = await requireSession();
    await changeTableEggLotStatus({ id: v.id, status: v.status, reason: opt(v.reason) }, session);
  });
}

const SEX: Record<string, string> = { F: "FEMELLE", FEMELLE: "FEMELLE", M: "MALE", MALE: "MALE", "MÂLE": "MALE", I: "INDETERMINE", INDETERMINE: "INDETERMINE" };

/** One bird per line: "bague;puce;sexe" — the chip may be empty ("B-0012;;F"). */
function parseSubjectLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [visualId, rfidUid, sex] = line.split(/[;,\t]/).map((p) => p?.trim() ?? "");
      const parsedSex = SEX[(sex || "I").toUpperCase()];
      if (!parsedSex) throw new ValidationError(`Ligne ${i + 1} : sexe « ${sex} » inconnu (F, M ou I).`);
      return { visualId, rfidUid: rfidUid || null, sex: parsedSex };
    });
}

export async function registerSubjectsAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/lots"], async () => {
    const session = await requireSession();
    await registerSubjects({ lotId: v.lotId, taggedAt: iso(v.taggedAt), dataStatus: v.dataStatus, subjects: parseSubjectLines(v.subjects ?? "") }, session);
  });
}

export async function changeSubjectStatusAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/lots"], async () => {
    const session = await requireSession();
    await changeSubjectStatus({ subjectId: v.subjectId, status: v.status, at: iso(v.at), reason: v.reason }, session);
  });
}

export async function recordSubjectEventAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/lots"], async () => {
    const session = await requireSession();
    await recordSubjectEvent(
      { subjectId: v.subjectId, eventType: v.eventType, value: num(v.value) ?? null, unit: opt(v.unit), notes: opt(v.notes), attributionProof: opt(v.attributionProof), occurredAt: iso(v.occurredAt), deviceId: opt(v.deviceId) },
      session
    );
  });
}

export async function releaseRfidAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/lots"], async () => {
    const session = await requireSession();
    await releaseSubjectRfid({ subjectId: v.subjectId, reason: v.reason }, session);
  });
}

export async function importParentStockAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/couvoir", "/lots", "/lignes"], async () => {
    const session = await requireSession();
    const flock = await importParentStock(
      {
        code: v.code,
        buildingId: v.buildingId,
        lineCode: v.lineCode,
        strain: v.strain,
        geneticSupplier: v.geneticSupplier,
        originCountry: v.originCountry,
        importReference: opt(v.importReference),
        supplierFlockCode: opt(v.supplierFlockCode),
        hatchedAt: iso(v.hatchedAt),
        placedAt: iso(v.placedAt),
        femaleCount: num(v.femaleCount),
        maleCount: num(v.maleCount),
        dataStatus: v.dataStatus,
        documentId: opt(v.documentId),
      },
      session
    );
    return flock.lotId ? `/lots/${flock.lotId}` : `/couvoir/reproducteurs/${flock.id}`;
  });
}

export async function updateLineAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/lignes"], async () => {
    const session = await requireSession();
    const line = await repositories.productionLines.findByCode(v.code);
    if (!line) throw new ValidationError("Ligne inconnue.");
    const phasePlan = line.phasePlan.map((step, i) => ({
      phase: step.phase,
      endsBetween: i === line.phasePlan.length - 1 ? null : ([num(v[`step${i}_min`]), num(v[`step${i}_max`])] as [number, number]),
    }));
    await updateProductionLine(
      v.code,
      {
        label: v.label,
        purpose: line.purpose,
        parentLineCode: line.parentLineCode,
        eggType: line.eggType,
        phasePlan,
        exitMinDays: num(v.exitMinDays) ?? null,
        exitMaxDays: num(v.exitMaxDays) ?? null,
        exitLabel: v.exitLabel,
        active: v.active !== "false",
        reason: v.reason,
      },
      session
    );
  });
}

export async function addAliasAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/identifiants"], async () => {
    const session = await requireSession();
    await addIdentifierAlias({ bvuId: v.bvuId, scheme: v.scheme, issuer: v.issuer ?? "", value: v.value, reason: opt(v.reason) }, session);
  });
}

export async function retireAliasAction(v: Record<string, string>): Promise<FormActionResult> {
  return run(["/identifiants"], async () => {
    const session = await requireSession();
    await retireIdentifierAlias(v.aliasId, v.reason ?? "", session);
  });
}
