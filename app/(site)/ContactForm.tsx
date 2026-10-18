"use client";

import { useActionState } from "react";
import { LEAD_ACTIVITY } from "@/domain/shared/enums";
import { submitContactAction, type ContactFormState } from "./actions";

const ACTIVITY_LABEL: Record<(typeof LEAD_ACTIVITY)[number], string> = {
  COUVOIR: "Couvoir",
  ELEVAGE: "Élevage avicole",
  ALIMENT: "Fabrication d'aliments",
  ABATTAGE: "Abattage",
  DECOUPE_TRANSFORMATION: "Découpe / transformation",
  OPERATEUR_INTEGRE: "Opérateur intégré",
  AUTRE: "Autre",
};

const INITIAL: ContactFormState = { status: "idle", message: null, fieldErrors: {} };

const inputClass =
  "w-full rounded-lg border border-[#d6dfd7] bg-white px-3 py-2.5 text-bvu-ink outline-none focus:border-bvu-green focus:ring-2 focus:ring-bvu-green/30";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs font-medium text-critical-strong">
      {message}
    </p>
  );
}

export function ContactForm({ demoStorageNote }: { demoStorageNote: boolean }) {
  const [state, action, pending] = useActionState(submitContactAction, INITIAL);
  const e = state.fieldErrors;

  if (state.status === "success") {
    return (
      <div role="status" className="rounded-xl border border-[#d4e8d2] bg-[#edf5e9] p-5 text-bvu-ink">
        <p className="font-bold">Demande envoyée</p>
        <p className="mt-1 text-sm text-bvu-muted">{state.message}</p>
      </div>
    );
  }

  const describedBy = (field: string) => (e[field] ? `${field}-error` : undefined);

  return (
    <form action={action} className="grid gap-4" noValidate>
      {/* Honeypot: hidden from people and assistive tech, irresistible to naive bots. */}
      <div className="absolute -left-[10000px]" aria-hidden="true">
        <label>
          Ne pas remplir <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {state.status === "error" && state.message ? (
        <p role="alert" className="rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical-strong">
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="company" className="mb-1 block text-xs font-extrabold">
            Entreprise *
          </label>
          <input id="company" name="company" maxLength={120} required className={inputClass} aria-invalid={!!e.company} aria-describedby={describedBy("company")} />
          <FieldError id="company-error" message={e.company} />
        </div>
        <div>
          <label htmlFor="contactName" className="mb-1 block text-xs font-extrabold">
            Nom du contact *
          </label>
          <input id="contactName" name="contactName" maxLength={100} required autoComplete="name" className={inputClass} aria-invalid={!!e.contactName} aria-describedby={describedBy("contactName")} />
          <FieldError id="contactName-error" message={e.contactName} />
        </div>
        <div>
          <label htmlFor="email" className="mb-1 block text-xs font-extrabold">
            E-mail professionnel *
          </label>
          <input id="email" name="email" type="email" maxLength={254} required autoComplete="email" className={inputClass} aria-invalid={!!e.email} aria-describedby={describedBy("email")} />
          <FieldError id="email-error" message={e.email} />
        </div>
        <div>
          <label htmlFor="phone" className="mb-1 block text-xs font-extrabold">
            Téléphone
          </label>
          <input id="phone" name="phone" type="tel" maxLength={40} autoComplete="tel" className={inputClass} aria-invalid={!!e.phone} aria-describedby={describedBy("phone")} />
          <FieldError id="phone-error" message={e.phone} />
        </div>
      </div>

      <div>
        <label htmlFor="activity" className="mb-1 block text-xs font-extrabold">
          Activité *
        </label>
        <select id="activity" name="activity" required defaultValue="" className={inputClass} aria-invalid={!!e.activity} aria-describedby={describedBy("activity")}>
          <option value="" disabled>
            Sélectionner
          </option>
          {LEAD_ACTIVITY.map((a) => (
            <option key={a} value={a}>
              {ACTIVITY_LABEL[a]}
            </option>
          ))}
        </select>
        <FieldError id="activity-error" message={e.activity} />
      </div>

      <div>
        <label htmlFor="capacity" className="mb-1 block text-xs font-extrabold">
          Capacité ou volume (facultatif)
        </label>
        <input id="capacity" name="capacity" maxLength={120} placeholder="Ex. : capacité annuelle, nombre de sites" className={inputClass} />
      </div>

      <div>
        <label htmlFor="need" className="mb-1 block text-xs font-extrabold">
          Votre besoin principal *
        </label>
        <textarea
          id="need"
          name="need"
          maxLength={3000}
          required
          rows={5}
          placeholder="Traçabilité, pilotage, intégration, continuité réseau…"
          className={`${inputClass} min-h-32 resize-y`}
          aria-invalid={!!e.need}
          aria-describedby={describedBy("need")}
        />
        <FieldError id="need-error" message={e.need} />
      </div>

      <div>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="consent" value="yes" required className="mt-1 size-4 accent-bvu-green" aria-invalid={!!e.consent} aria-describedby={describedBy("consent")} />
          <span>
            J&apos;accepte que mes informations soient utilisées par BVU Tech pour traiter cette demande de contact,
            conformément à la{" "}
            <a href="/confidentialite" className="font-semibold text-bvu-green underline">
              politique de confidentialité
            </a>
            . *
          </span>
        </label>
        <FieldError id="consent-error" message={e.consent} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="justify-self-start rounded-full bg-bvu-green px-6 py-3 font-bold text-white transition hover:-translate-y-0.5 disabled:opacity-60"
      >
        {pending ? "Envoi en cours…" : "Envoyer ma demande"}
      </button>
      <p className="text-xs text-bvu-muted">
        Les champs marqués d&apos;un astérisque sont obligatoires. Vos données servent uniquement au traitement de votre
        demande.
        {demoStorageNote
          ? " Cette instance de démonstration ne conserve pas les demandes durablement : pour un contact garanti, écrivez-nous directement."
          : null}
      </p>
    </form>
  );
}
