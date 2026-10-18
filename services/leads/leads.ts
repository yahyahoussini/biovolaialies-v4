import { z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import type { Lead } from "../../domain/leads/types";
import { CONSENT_VERSION, leadSubmissionSchema } from "../../domain/leads/validation";
import { LEAD_STATUS } from "../../domain/shared/enums";
import { AuthorizationError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { err, ok, type Result } from "../../domain/shared/result";
import { LEAD_ACTIVITY_LABEL, LEAD_STATUS_LABEL } from "../../lib/lead-labels";
import { rateLimit } from "../../lib/rate-limit";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { sendInternalNotification } from "../notify/email";

/** Per-client-address burst brake, and a per-e-mail daily cap against form flooding. */
const IP_LIMIT = 5;
const IP_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_DAILY_LIMIT = 3;
const GLOBAL_HOURLY_LIMIT = 60;

export interface SubmissionMeta {
  clientKey: string;
  /** Value of the hidden honeypot field — any content means a bot. */
  honeypot: string;
}

export type SubmissionError =
  | { kind: "VALIDATION"; message: string; fieldErrors: Record<string, string> }
  | { kind: "RATE_LIMITED"; message: string };

/**
 * Public entry point behind the contact form. Returns a Result rather than throwing because
 * every failure here is an expected, user-facing outcome. A honeypot hit reports success
 * without storing anything, so a bot learns nothing.
 */
export async function submitLead(input: unknown, meta: SubmissionMeta): Promise<Result<{ stored: boolean }, SubmissionError>> {
  if (meta.honeypot.trim() !== "") return ok({ stored: false });

  const limit = rateLimit(`lead:${meta.clientKey}`, IP_LIMIT, IP_WINDOW_MS);
  // Site-wide ceiling, whatever the address: no B2B form legitimately gets more than this.
  const global = rateLimit("lead:*", GLOBAL_HOURLY_LIMIT, 60 * 60 * 1000);
  if (!limit.allowed || !global.allowed) {
    return err({ kind: "RATE_LIMITED", message: "Trop de demandes en peu de temps. Merci de réessayer dans quelques minutes." });
  }

  const parsed = leadSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      fieldErrors[field] ??= issue.message;
    }
    return err({ kind: "VALIDATION", message: "Merci de corriger les champs signalés.", fieldErrors });
  }
  const data = parsed.data;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if ((await repositories.leads.countSince(data.email, since)) >= EMAIL_DAILY_LIMIT) {
    return err({ kind: "RATE_LIMITED", message: "Plusieurs demandes ont déjà été reçues pour cette adresse aujourd'hui. Nous revenons vers vous." });
  }

  const lead = await repositories.leads.create({ ...data, consent: true, consentVersion: CONSENT_VERSION });

  await sendInternalNotification({
    subject: `Nouvelle demande BVU Tech — ${lead.company} (${LEAD_ACTIVITY_LABEL[lead.activity]})`,
    replyTo: lead.email,
    text: [
      `Entreprise : ${lead.company}`,
      `Contact : ${lead.contactName}`,
      `E-mail : ${lead.email}`,
      `Téléphone : ${lead.phone ?? "—"}`,
      `Activité : ${LEAD_ACTIVITY_LABEL[lead.activity]}`,
      `Capacité / volume : ${lead.capacity ?? "—"}`,
      "",
      "Besoin :",
      lead.need,
    ].join("\n"),
  });

  return ok({ stored: true });
}

function assertCanManageLeads(session: Session, action: "VIEW" | "EDIT" | "EXPORT"): void {
  if (!can(session, action, "LEADS")) throw new AuthorizationError();
}

export async function listLeads(session: Session): Promise<Lead[]> {
  assertCanManageLeads(session, "VIEW");
  return repositories.leads.list();
}

export const updateLeadInputSchema = z.object({
  leadId: z.string().min(1),
  status: z.enum(LEAD_STATUS),
  notes: z.string().trim().max(2000).nullable(),
});

export async function updateLead(input: unknown, session: Session): Promise<Lead> {
  assertCanManageLeads(session, "EDIT");
  const parsed = updateLeadInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const { leadId, status, notes } = parsed.data;

  const existing = await repositories.leads.findById(leadId);
  if (!existing) throw new NotFoundError("Lead", leadId);

  const updated = await repositories.leads.update(leadId, { status, notes: notes || null });
  if (existing.status !== status) {
    await recordAudit({
      actorId: session.userId,
      entityType: "lead",
      entityId: leadId,
      field: "status",
      oldValue: existing.status,
      newValue: status,
      reason: "Suivi commercial d'une demande entrante",
      relatedLotId: null,
      relatedEventId: null,
    });
  }
  return updated;
}

/** RFC 4180 field quoting, plus a leading quote on values a spreadsheet would run as a formula. */
export function csvField(value: string | null | undefined): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function exportLeadsCsv(session: Session): Promise<string> {
  assertCanManageLeads(session, "EXPORT");
  const leads = await repositories.leads.list();
  const header = ["Date", "Entreprise", "Contact", "E-mail", "Téléphone", "Activité", "Capacité", "Besoin", "Statut", "Notes"];
  const rows = leads.map((l) =>
    [
      l.createdAt,
      l.company,
      l.contactName,
      l.email,
      l.phone,
      LEAD_ACTIVITY_LABEL[l.activity],
      l.capacity,
      l.need,
      LEAD_STATUS_LABEL[l.status],
      l.notes,
    ]
      .map(csvField)
      .join(",")
  );
  // BOM so Excel opens the UTF-8 accents correctly.
  return "﻿" + [header.join(","), ...rows].join("\r\n");
}
