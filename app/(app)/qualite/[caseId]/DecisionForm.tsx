"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { decideHoldAction } from "../actions";

export function DecisionForm({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(form: FormData) {
    setError(null);
    const decision = String(form.get("decision"));
    startTransition(async () => {
      const result = await decideHoldAction({
        caseId,
        decision,
        justification: String(form.get("justification")),
        evidence: String(form.get("evidence")),
      });
      if (!result.ok) {
        setError(result.error?.message ?? "Décision impossible.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="justification">Justification (20 caractères minimum)</Label>
        <textarea id="justification" name="justification" required minLength={20} rows={3} className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="evidence">Preuves (au moins une référence, séparées par « ; »)</Label>
        <Input id="evidence" name="evidence" required placeholder="LAB-2026-051; PV-QA-12" />
      </div>
      {error ? (
        <p role="alert" className="rounded-md bg-critical/10 px-3 py-2 text-xs text-critical-strong">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="LIBERE" disabled={pending}>
          Lever le blocage
        </Button>
        <Button type="submit" name="decision" value="NON_CONFORME" variant="destructive" disabled={pending}>
          Confirmer la non-conformité
        </Button>
      </div>
    </form>
  );
}
