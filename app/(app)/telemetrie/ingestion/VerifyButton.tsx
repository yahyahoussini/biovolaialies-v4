"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { verifyMessageAction } from "../actions";

const LABEL: Record<string, { label: string; tone: "success" | "critical" | "neutral" | "warning" }> = {
  INTACT: { label: "Intact", tone: "success" },
  MODIFIE: { label: "Modifié depuis réception", tone: "critical" },
  PURGE: { label: "Brut purgé (90 j)", tone: "neutral" },
  INCONNU: { label: "Aucune empreinte", tone: "warning" },
  INTERDIT: { label: "Non autorisé", tone: "neutral" },
};

/** Re-hashes the stored readings of one message and compares with the ledger. */
export function VerifyButton({ messageId }: { messageId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (status) return <Badge tone={LABEL[status]?.tone ?? "neutral"}>{LABEL[status]?.label ?? status}</Badge>;
  return (
    <button
      type="button"
      className="focus-ring text-xs font-medium text-bio-green hover:underline disabled:opacity-50"
      disabled={pending}
      onClick={() => start(async () => setStatus((await verifyMessageAction(messageId)).status))}
    >
      {pending ? "Vérification…" : "Vérifier"}
    </button>
  );
}
