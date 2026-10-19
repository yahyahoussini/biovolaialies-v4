"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import type { AlertStatus } from "@/domain/shared/enums";
import { acknowledgeAlertAction, dismissAlertAction, resolveAlertAction } from "../actions";

type Kind = "ack" | "resolve" | "dismiss";

const OUTCOMES = [
  { value: "JUSTIFIEE", label: "Justifiée — un vrai problème" },
  { value: "FAUSSE_ALERTE", label: "Fausse alerte" },
  { value: "INDETERMINEE", label: "Indéterminée" },
] as const;

/**
 * Acknowledge/resolve/dismiss (phase-6 brief §15) — every transition records an actor+timestamp+comment
 * through services/intelligence/alerts.ts. A sensor alert is closed only with the intervention and
 * its outcome (document 3, ch. 4), which the band learning uses afterwards.
 */
export function AlertActionsPanel({ alertId, status, requiresOutcome = false }: { alertId: string; status: AlertStatus; requiresOutcome?: boolean }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [outcome, setOutcome] = useState<string>("");
  const [pending, setPending] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canAcknowledge = status === "OPEN";
  const canResolve = status === "OPEN" || status === "ACKNOWLEDGED";
  const canDismiss = status === "OPEN" || status === "ACKNOWLEDGED";

  async function run(kind: Kind) {
    setPending(kind);
    setError(null);
    const result =
      kind === "ack"
        ? await acknowledgeAlertAction(alertId, comment.trim() || undefined)
        : await (kind === "resolve" ? resolveAlertAction : dismissAlertAction)(alertId, comment.trim() || undefined, outcome || undefined);
    setPending(null);
    if (!result.ok) {
      setError(result.error?.message ?? "Action impossible.");
      return;
    }
    setComment("");
    router.refresh();
  }

  if (!canAcknowledge && !canResolve && !canDismiss) {
    return <p className="text-xs text-secondary">Cette alerte est déjà {status === "RESOLVED" ? "résolue" : "écartée"}.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="alert-comment">{requiresOutcome ? "Intervention réalisée (obligatoire pour clore)" : "Commentaire (optionnel)"}</Label>
        <Input
          id="alert-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={requiresOutcome ? "Ex. : litière remplacée zone arrière, ventilation +10 %" : "Résultat, remarque…"}
        />
      </div>
      {requiresOutcome ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium">L&apos;alerte était-elle juste ? (obligatoire pour clore)</legend>
          {OUTCOMES.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input type="radio" name="alert-outcome" value={o.value} checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
              {o.label}
            </label>
          ))}
          <p className="text-xs text-secondary">Les heures d&apos;une alerte justifiée sont écartées de l&apos;apprentissage des bandes ; une alerte close sans réponse ne lui apprend rien.</p>
        </fieldset>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-critical-strong">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canAcknowledge ? (
          <Button size="sm" variant="secondary" disabled={pending !== null} onClick={() => run("ack")}>
            Prendre en compte
          </Button>
        ) : null}
        {canResolve ? (
          <Button size="sm" disabled={pending !== null} onClick={() => run("resolve")}>
            Résoudre
          </Button>
        ) : null}
        {canDismiss ? (
          <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => run("dismiss")}>
            Écarter
          </Button>
        ) : null}
      </div>
    </div>
  );
}
