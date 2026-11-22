"use client";

import Link from "next/link";
import { useState } from "react";
import { FormAlert } from "@/components/account/FormAlert";
import { Button } from "@/components/ui/Button";
import { decodeLogBytes } from "@/domain/telemetry/machine-log";
import type { StructureImportPreview } from "@/services/identity/structure";
import { applyImportAction, previewImportAction } from "../actions";

const LEVELS = [
  ["organization", "Organisations"],
  ["cooperative", "Coopératives"],
  ["producer", "Producteurs"],
  ["farm", "Fermes"],
  ["building", "Bâtiments"],
] as const;

export function StructureImport() {
  const [file, setFile] = useState<{ name: string; text: string; encoding: string } | null>(null);
  const [preview, setPreview] = useState<StructureImportPreview | null>(null);
  const [done, setDone] = useState<StructureImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"check" | "import" | null>(null);

  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    setPreview(null);
    setDone(null);
    setError(null);
    if (!chosen) return setFile(null);
    const decoded = decodeLogBytes(new Uint8Array(await chosen.arrayBuffer()));
    setFile({ name: chosen.name, text: decoded.text, encoding: decoded.encoding });
  }

  async function check() {
    if (!file) return;
    setPending("check");
    setError(null);
    const result = await previewImportAction(file.text);
    setPending(null);
    if (!result.ok) return setError(result.error?.message ?? "Vérification impossible.");
    setPreview(result.data!);
  }

  async function apply() {
    if (!file) return;
    setPending("import");
    setError(null);
    const result = await applyImportAction(file.text);
    setPending(null);
    if (!result.ok) return setError(result.error?.message ?? "Import impossible.");
    if (result.data!.errors.length) return setPreview(result.data!);
    setDone(result.data!);
  }

  const nothingNew = preview ? LEVELS.every(([k]) => preview.create[k] === 0) : false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="structure-file" className="text-sm font-medium text-text">
          Fichier de structure (.csv)
        </label>
        <input id="structure-file" type="file" accept=".csv,text/csv" onChange={pick} className="text-sm text-text" />
        {file ? (
          <p className="text-micro text-secondary">
            {file.name} — lu en {file.encoding}
          </p>
        ) : null}
      </div>
      <Button type="button" className="self-start" disabled={!file} loading={pending === "check"} onClick={check}>
        Vérifier le fichier
      </Button>
      <FormAlert message={error} />

      {preview && !done ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
          <p className="text-sm text-text">
            {preview.rows} ligne(s) lue(s){preview.skipped ? `, ${preview.skipped} ligne d'exemple ignorée` : ""}.
          </p>
          <table className="text-sm">
            <thead>
              <tr className="text-left text-xs text-secondary">
                <th className="pr-4 font-medium">Niveau</th>
                <th className="pr-4 font-medium">À créer</th>
                <th className="font-medium">Déjà présents</th>
              </tr>
            </thead>
            <tbody>
              {LEVELS.map(([k, label]) => (
                <tr key={k}>
                  <td className="pr-4 text-text">{label}</td>
                  <td className="pr-4 font-semibold text-text">{preview.create[k]}</td>
                  <td className="text-secondary">{preview.existing[k]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.errors.length ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-critical-strong">{preview.errors.length} ligne(s) à corriger — rien ne sera enregistré tant qu&apos;il en reste :</p>
              <ul className="list-disc pl-5 text-sm text-text">
                {preview.errors.map((e) => (
                  <li key={`${e.line}-${e.message}`}>
                    Ligne {e.line} : {e.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : nothingNew ? (
            <p className="text-sm text-text">Tout est déjà présent : rien à importer.</p>
          ) : (
            <Button type="button" className="self-start" loading={pending === "import"} onClick={apply}>
              Importer
            </Button>
          )}
        </div>
      ) : null}

      {done ? (
        <div className="flex flex-col gap-2 rounded-md border border-success/25 bg-success/10 p-4 text-sm text-text">
          <p className="font-semibold">Import terminé.</p>
          <p>{LEVELS.map(([k, label]) => `${label} : ${done.create[k]}`).join(" · ")} créés.</p>
          <Link href="/structure" className="font-medium text-bio-green underline underline-offset-2">
            Voir la structure
          </Link>
        </div>
      ) : null}
    </div>
  );
}
