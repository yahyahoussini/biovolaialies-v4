"use client";

import { useState } from "react";
import type { FieldKind } from "@/domain/field/field";
import { FIELD_KIND_LABEL } from "@/domain/field/field";
import { ADMIN_ROUTE, ADMIN_ROUTE_LABEL, SANITARY_STATUS_LABEL } from "@/domain/sanitary/health";
import { SANITARY_STATUS } from "@/domain/shared/enums";
import { fmt, parseNumber } from "./field-format";

/**
 * One form per kind of field entry. It checks what a person can check by eye (a number where a
 * number goes); the server applies the same rules as the office forms when the entry arrives.
 */

interface Field {
  name: string;
  label: string;
  type: "int" | "decimal" | "text" | "textarea" | "select";
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
  placeholder?: string;
}

const ROUTES = ADMIN_ROUTE.map((r) => ({ value: r, label: ADMIN_ROUTE_LABEL[r] }));
const FEEDS = ["Démarrage", "Croissance", "Finition", "Ponte", "Reproducteurs"].map((f) => ({ value: f, label: f }));
const CAUSES = ["", "Chaleur", "Écrasement", "Maladie suspectée", "Prédateur", "Inconnue"].map((c) => ({ value: c, label: c || "— Non précisée —" }));

function fieldsFor(kind: FieldKind, laying: boolean, signerHint: string): Field[] {
  switch (kind) {
    case "MORTALITE":
      return [
        { name: "count", label: "Morts constatés aujourd'hui", type: "int", required: true, hint: "Le total du jour. Si vous recomptez plus tard, saisissez le nouveau total : seule la différence est ajoutée." },
        { name: "cause", label: "Cause probable", type: "select", options: CAUSES },
      ];
    case "PESEE":
      return [
        { name: "averageWeightKg", label: "Poids moyen (kg)", type: "decimal", required: true, placeholder: "1,42" },
        { name: "sampleCount", label: "Sujets pesés", type: "int" },
      ];
    case "ALIMENT":
      return [
        { name: "quantityKg", label: "Aliment distribué (kg)", type: "decimal", required: true },
        { name: "feedType", label: "Aliment", type: "select", required: true, options: FEEDS },
      ];
    case "EAU":
      return [{ name: "quantityL", label: "Eau consommée (litres)", type: "decimal", required: true, hint: "Différence entre deux relevés du compteur." }];
    case "VACCINATION":
      return [
        { name: "vaccine", label: "Vaccin", type: "text", required: true },
        { name: "disease", label: "Maladie visée", type: "text", required: true, placeholder: "Newcastle, Gumboro…" },
        { name: "route", label: "Voie", type: "select", required: true, options: ROUTES },
        { name: "batchNumber", label: "N° de lot du vaccin", type: "text" },
        { name: "headcount", label: "Sujets vaccinés", type: "int" },
      ];
    case "TRAITEMENT":
      return [
        { name: "product", label: "Médicament", type: "text", required: true },
        { name: "indication", label: "Motif", type: "text", required: true },
        { name: "route", label: "Voie", type: "select", required: true, options: ROUTES },
        { name: "durationDays", label: "Durée (jours)", type: "int", required: true },
        { name: "withdrawalMeatDays", label: "Délai d'attente viande (jours)", type: "int", required: true, hint: "0 s'il n'y en a pas." },
        ...(laying ? [{ name: "withdrawalEggDays", label: "Délai d'attente œufs (jours)", type: "int" as const, required: true, hint: "Obligatoire sur pondeuses et reproducteurs." }] : []),
        { name: "prescriptionRef", label: "N° d'ordonnance", type: "text" },
        { name: "prescriber", label: "Vétérinaire", type: "text" },
      ];
    case "OBSERVATION":
      return [
        { name: "status", label: "Appréciation", type: "select", required: true, options: SANITARY_STATUS.map((s) => ({ value: s, label: SANITARY_STATUS_LABEL[s] })) },
        { name: "signs", label: "Ce que vous voyez", type: "textarea", required: true },
        { name: "affectedCount", label: "Sujets concernés", type: "int" },
      ];
    case "RECEPTION":
      return [
        { name: "quantityReceived", label: "Reçus vivants", type: "int", required: true, hint: "Comptez avant de regarder le bon de livraison." },
        { name: "deadOnArrival", label: "Morts à l'arrivée", type: "int", required: true },
        { name: "discrepancyReason", label: "Explication d'un écart", type: "textarea" },
        { name: "signerName", label: "Signature : votre nom complet", type: "text", required: true, hint: signerHint },
      ];
  }
}

const NUMERIC = new Set(["int", "decimal"]);

function summarize(kind: FieldKind, p: Record<string, unknown>): string {
  switch (kind) {
    case "MORTALITE":
      return `${fmt(Number(p.count))} morts aujourd'hui${p.cause ? ` (${p.cause})` : ""}`;
    case "PESEE":
      return `${fmt(Number(p.averageWeightKg), 3)} kg en moyenne${p.sampleCount ? ` sur ${p.sampleCount} sujets` : ""}`;
    case "ALIMENT":
      return `${fmt(Number(p.quantityKg), 1)} kg d'aliment ${String(p.feedType).toLowerCase()}`;
    case "EAU":
      return `${fmt(Number(p.quantityL), 1)} L d'eau`;
    case "VACCINATION":
      return `${p.vaccine} contre ${p.disease}`;
    case "TRAITEMENT":
      return `${p.product} — ${p.indication}, ${p.durationDays} j`;
    case "OBSERVATION":
      return `${SANITARY_STATUS_LABEL[p.status as keyof typeof SANITARY_STATUS_LABEL]} : ${String(p.signs).slice(0, 60)}`;
    case "RECEPTION":
      return `${fmt(Number(p.quantityReceived))} reçus vivants, ${fmt(Number(p.deadOnArrival))} morts`;
  }
}

export function EntrySheet({
  kind,
  title,
  laying,
  signerHint,
  onCancel,
  onSave,
}: {
  kind: FieldKind;
  title: string;
  laying: boolean;
  signerHint: string;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>, summary: string) => Promise<void>;
}) {
  const fields = fieldsFor(kind, laying, signerHint);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(form: FormData) {
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = String(form.get(f.name) ?? "");
      if (NUMERIC.has(f.type)) {
        const n = parseNumber(raw);
        if (n === null) {
          if (f.required) return setError(`${f.label} : valeur requise.`);
          continue;
        }
        if (Number.isNaN(n) || n < 0 || (f.type === "int" && !Number.isInteger(n))) return setError(`${f.label} : nombre ${f.type === "int" ? "entier " : ""}positif attendu.`);
        payload[f.name] = n;
      } else {
        const text = raw.trim();
        if (!text) {
          if (f.required) return setError(`${f.label} : valeur requise.`);
          continue;
        }
        payload[f.name] = text;
      }
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(payload, summarize(kind, payload));
    } catch {
      setError("Impossible d'écrire sur le téléphone : vérifiez l'espace de stockage.");
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-bio-green">{FIELD_KIND_LABEL[kind]}</p>
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
      </div>
      {fields.map((f) => (
        <label key={f.name} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text">
            {f.label}
            {f.required ? <span className="text-critical"> *</span> : null}
          </span>
          {f.type === "select" ? (
            <select name={f.name} required={f.required} defaultValue={f.options?.[0]?.value} className="h-12 rounded-lg border border-border bg-surface px-3 text-base">
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === "textarea" ? (
            <textarea name={f.name} required={f.required} rows={3} className="rounded-lg border border-border bg-surface px-3 py-2 text-base" />
          ) : (
            <input
              name={f.name}
              required={f.required}
              placeholder={f.placeholder}
              inputMode={f.type === "int" ? "numeric" : f.type === "decimal" ? "decimal" : undefined}
              autoComplete="off"
              className="h-12 rounded-lg border border-border bg-surface px-3 text-base"
            />
          )}
          {f.hint ? <span className="text-xs text-secondary">{f.hint}</span> : null}
        </label>
      ))}
      {error ? (
        <p role="alert" className="rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical-strong">
          {error}
        </p>
      ) : null}
      <div className="sticky bottom-0 flex gap-3 bg-background py-3">
        <button type="button" onClick={onCancel} className="h-12 flex-1 rounded-lg border border-border bg-surface text-base font-medium text-text">
          Annuler
        </button>
        <button type="submit" disabled={saving} className="h-12 flex-[2] rounded-lg bg-bio-green text-base font-semibold text-white disabled:opacity-60">
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
      <p className="text-xs text-secondary">Enregistré d&apos;abord sur le téléphone, puis envoyé dès que le réseau le permet. Rien n&apos;est perdu si l&apos;application se ferme.</p>
    </form>
  );
}
