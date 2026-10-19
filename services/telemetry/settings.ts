import { repositories } from "../../data/repositories";
import { DECISION_RULE, type DecisionRule } from "../../domain/telemetry/catalog";
import { RULE_PARAMS, mergeParams } from "../../domain/telemetry/rules/settings";
import type { RuleParams } from "../../domain/telemetry/rules/types";
import { AuthorizationError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";

export async function listRuleSettings(session: Session) {
  if (!can(session, "VIEW", "IOT")) throw new AuthorizationError();
  const stored = await repositories.ruleSettings.listAll();
  return DECISION_RULE.map((rule) => {
    const global = stored.find((s) => s.ruleCode === rule && s.buildingId === null) ?? null;
    return {
      rule,
      params: RULE_PARAMS[rule],
      effective: mergeParams(rule, global?.params),
      overrides: stored.filter((s) => s.ruleCode === rule && s.buildingId !== null),
      updatedAt: global?.updatedAt ?? null,
    };
  });
}

/**
 * Changes a rule's parameters without redeploying (document 3, ch. 1). Values arrive as text
 * from the form; each is checked against the parameter's kind, and the change is audited with
 * the values before and after. A changed threshold applies from the next evaluation onwards.
 */
export async function saveRuleSettings(rule: string, buildingId: string | null, raw: Record<string, string>, session: Session) {
  if (!can(session, "VALIDATE", "IOT")) throw new AuthorizationError("Seuls le technicien et la direction modifient les seuils.");
  if (!(DECISION_RULE as readonly string[]).includes(rule)) throw new ValidationError("Règle inconnue.");
  const code = rule as DecisionRule;
  const params: RuleParams = {};
  for (const spec of RULE_PARAMS[code]) {
    const v = raw[spec.key]?.trim();
    if (v === undefined || v === "") continue;
    if (typeof spec.default === "number") {
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n)) throw new ValidationError(`${spec.label} : nombre attendu.`);
      if (n < 0 && spec.key !== "utcOffsetMinutes") throw new ValidationError(`${spec.label} : valeur négative refusée.`);
      params[spec.key] = n;
    } else {
      if (!/^\d{2}:\d{2}$/.test(v)) throw new ValidationError(`${spec.label} : format hh:mm attendu.`);
      params[spec.key] = v;
    }
  }
  const { previous } = await repositories.ruleSettings.upsert(code, buildingId, params, session.userId);
  await recordAudit({
    actorId: session.userId,
    entityType: "rule_settings",
    entityId: `${code}${buildingId ? `:${buildingId}` : ""}`,
    field: "params",
    oldValue: previous ? JSON.stringify(previous) : "valeurs par défaut",
    newValue: JSON.stringify(params),
    reason: "Paramètres de règle modifiés depuis l'écran (sans redéploiement)",
    relatedLotId: null,
    relatedEventId: null,
  });
  return mergeParams(code, params);
}
