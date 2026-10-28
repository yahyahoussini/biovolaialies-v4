import { repositories } from "../../data/repositories";
import { isGlobalScope } from "../../domain/shared/scope";
import { isEntityType } from "../../domain/traceability/entity-types";
import type { Session } from "../auth/session";
import { getLabSample } from "../lab/lab";
import { resolveEntityHierarchy } from "../quality/holds";
import { resolveIdentifier, type ResolvedIdentifier } from "./bvu-ids";
import { isWithinScope, resolveBuildingHierarchy, resolveLotHierarchy, type HierarchyPath } from "./scope-check";

/**
 * resolveIdentifier, for a person: an object outside their scope is answered exactly like an
 * object that does not exist — no identifier, no alias, not even the fact that the code is in use
 * (document 3, ch. 07: "même en modifiant l'adresse dans son navigateur").
 */
export async function resolveIdentifierInScope(raw: string, session: Session): Promise<ResolvedIdentifier[]> {
  const results = await resolveIdentifier(raw);
  if (isGlobalScope(session)) return results;
  const visible: ResolvedIdentifier[] = [];
  for (const r of results) {
    if (r.objectType === "SAMPLE") {
      if (await getLabSample(r.objectId, session).then(() => true, () => false)) visible.push(r);
      continue;
    }
    const paths = await pathsOf(r).catch(() => [] as HierarchyPath[]);
    if (paths.some((p) => isWithinScope(session, p))) visible.push(r);
  }
  return visible;
}

/** Where an identified object lives; a transfer lives on both sides. */
async function pathsOf(r: ResolvedIdentifier): Promise<HierarchyPath[]> {
  switch (r.objectType) {
    case "SUBJECT": {
      const subject = await repositories.subjects.findById(r.objectId);
      return subject ? [await resolveLotHierarchy(subject.lotId)] : [];
    }
    case "TABLE_EGG_LOT": {
      const eggs = await repositories.tableEggLots.findById(r.objectId);
      return eggs ? [await resolveLotHierarchy(eggs.lotId)] : [];
    }
    case "TRANSFER": {
      const transfer = await repositories.transfers.findById(r.objectId);
      return transfer ? [await resolveBuildingHierarchy(transfer.sourceBuildingId), await resolveBuildingHierarchy(transfer.destinationBuildingId)] : [];
    }
    case "PACKAGE": {
      const tray = await repositories.marking.findTray(r.objectId);
      const run = tray ? await repositories.marking.findRun(tray.runId) : null;
      const line = run ? await repositories.marking.findLine(run.lineId) : null;
      return line ? [await resolveBuildingHierarchy(line.buildingId)] : [];
    }
    case "QUALITY_CASE": {
      const qualityCase = await repositories.qualityCases.findById(r.objectId);
      const path = qualityCase && isEntityType(qualityCase.rootType) ? await resolveEntityHierarchy(qualityCase.rootType, qualityCase.rootId) : null;
      return path ? [path] : [];
    }
    default: {
      if (!isEntityType(r.objectType)) return [];
      const path = await resolveEntityHierarchy(r.objectType, r.objectId);
      return path ? [path] : [];
    }
  }
}
