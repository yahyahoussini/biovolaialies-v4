"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import type { LearningReport } from "@/services/telemetry/bands";
import { learnBandsAction } from "../actions";

const OUTCOME = { PROPOSEE: "Proposition créée", INSUFFISANT: "Historique insuffisant", INCHANGEE: "Confirmée" } as const;

/** Runs the learning on finished lots and shows, band by band, what it could and could not learn. */
export function LearnButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ reports?: LearningReport[]; alertsWithoutOutcome?: number; error?: string } | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await learnBandsAction();
            setResult(r);
            router.refresh();
          })
        }
      >
        {pending ? "Apprentissage…" : "Apprendre sur les lots terminés"}
      </Button>
      {result?.error ? <p role="alert" className="text-sm text-critical-strong">{result.error}</p> : null}
      {result?.reports ? (
        <div className="rounded-md border border-border p-3 text-sm">
          {result.alertsWithoutOutcome ? (
            <p className="mb-2 text-warning-strong">
              {result.alertsWithoutOutcome} alerte(s) close(s) sans issue enregistrée : l&apos;apprentissage ne peut pas savoir si elles étaient justes.
            </p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {result.reports.map((r) => (
              <li key={r.bandId}>
                <strong>{OUTCOME[r.outcome]}</strong> — {r.label} : {r.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
