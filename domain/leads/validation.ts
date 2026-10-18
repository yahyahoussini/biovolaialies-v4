import { z } from "../../lib/zod";
import { LEAD_ACTIVITY } from "../shared/enums";

/** Version of the consent sentence shown under the form — stored with each lead (accountability under law 09-08). */
export const CONSENT_VERSION = "2026-10-v1";

/** Strips ASCII control characters (except tab/newline/CR) — same intent as the client's original `clean_text`. */
export function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

const optionalText = (max: number) =>
  z.preprocess((v) => {
    const cleaned = cleanText(v, max);
    return cleaned === "" ? null : cleaned;
  }, z.string().nullable());

const requiredText = (max: number, message: string) => z.preprocess((v) => cleanText(v, max), z.string().min(1, message));

export const leadSubmissionSchema = z.object({
  company: requiredText(120, "Indiquez le nom de l'entreprise."),
  contactName: requiredText(100, "Indiquez le nom du contact."),
  email: z.preprocess((v) => cleanText(v, 254).toLowerCase(), z.email("L'adresse e-mail semble invalide.").max(254)),
  phone: optionalText(40).refine((v) => v === null || /^[+0-9 ().-]{6,40}$/.test(v), "Le numéro de téléphone semble invalide."),
  activity: z.enum(LEAD_ACTIVITY, { message: "Sélectionnez une activité." }),
  capacity: optionalText(120),
  need: requiredText(3000, "Décrivez votre besoin principal.").refine((v) => v.length >= 10, "Décrivez votre besoin en quelques mots (10 caractères minimum)."),
  consent: z.literal(true, { message: "Votre consentement est nécessaire pour traiter la demande." }),
});
export type LeadSubmission = z.infer<typeof leadSubmissionSchema>;
