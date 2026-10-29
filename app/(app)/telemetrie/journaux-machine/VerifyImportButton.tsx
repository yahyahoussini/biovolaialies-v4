"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { verifyMachineImportAction } from "../actions";

const LABEL: Record<string, { label: string; tone: "success" | "critical" | "neutral" | "warning" }> = {
  INTACT: { label: "Intact", tone: "success" },
  MODIFIE: { label: "Modifié depuis l'import", tone: "critical" },
  PURGE: { label: "Brut purgé (90 j)", tone: "neutral" },
  INCONNU: { label: "Aucune empreinte", tone: "warning" },
  INTERDIT: { label: "Non autorisé", tone: "neutral" },
};

/** Re-hashes the readings an import stored and compares with the ledger. */
export function VerifyImportButton({ importId }: { importId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (status) return <Badge tone={LABEL[status]?.tone ?? "neutral"}>{LABEL[status]?.label ?? status}</Badge>;
  return (
    <button
      type="button"
      className="focus-ring text-xs font-medium text-bio-green hover:underline disabled:opacity-50"
      disabled={pending}
      onClick={() => start(async () => setStatus((await verifyMachineImportAction(importId)).status))}
    >
      {pending ? "Vérification…" : "Vérifier"}
    </button>
  );
}
