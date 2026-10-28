"use client";

import { useState, useTransition } from "react";
import type { VerifyOutcome } from "@/services/exports/exports";
import { verifyExportAction } from "./actions";

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The file is read and fingerprinted in the browser; only its SHA-256 goes to the server. */
export function VerifyExport() {
  const [digest, setDigest] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function check(file: File) {
    setError(null);
    setOutcome(null);
    const value = hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
    setDigest(value);
    startTransition(async () => {
      const result = await verifyExportAction(value);
      if (result.ok) setOutcome(result.outcome);
      else setError(result.error.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold">Fichier à vérifier</span>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && check(e.target.files[0])} className="text-sm" />
      </label>
      {digest ? <p className="break-all font-mono text-caption text-secondary">SHA-256 : {digest}</p> : null}
      {pending ? <p className="text-sm text-secondary">Vérification…</p> : null}
      {error ? <p className="text-sm text-critical-strong">{error}</p> : null}
      {outcome?.status === "IDENTIQUE" ? (
        <p role="status" className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-success-strong">
          Fichier identique à l&apos;export « {outcome.record.label} » produit le {new Date(outcome.record.createdAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })} par {outcome.record.createdByName} ({outcome.record.rows} lignes). Il n&apos;a pas été modifié depuis.
        </p>
      ) : null}
      {outcome?.status === "INCONNU" ? (
        <p role="status" className="rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm text-critical-strong">
          Aucun export enregistré ne correspond : ce fichier a été modifié, ou il ne vient pas de la plateforme.
        </p>
      ) : null}
    </div>
  );
}
