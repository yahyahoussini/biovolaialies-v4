import { env } from "../../lib/env";
import { logger } from "../../lib/logger";

export interface EmailMessage {
  subject: string;
  text: string;
  replyTo?: string;
}

export function isEmailNotificationConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.LEADS_NOTIFY_TO && env.LEADS_NOTIFY_FROM);
}

/**
 * Sends one plain-text e-mail to the configured internal address. Never throws: a failed
 * notification must not lose the lead, which is already stored by the time this runs.
 * Returns whether the provider accepted the message.
 */
export async function sendInternalNotification(message: EmailMessage): Promise<boolean> {
  if (!isEmailNotificationConfigured()) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.LEADS_NOTIFY_FROM,
        to: [env.LEADS_NOTIFY_TO],
        subject: message.subject,
        text: message.text,
        reply_to: message.replyTo,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      logger.warn("general", `E-mail notification refused by provider (HTTP ${response.status}).`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error("general", "E-mail notification failed", error);
    return false;
  }
}

export function isAlertEmailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && (env.ALERTS_NOTIFY_FROM ?? env.LEADS_NOTIFY_FROM));
}

/** Sends one plain-text e-mail to the given people. Never throws; returns whether the provider accepted it. */
export async function sendEmailTo(to: string[], message: EmailMessage): Promise<boolean> {
  const from = env.ALERTS_NOTIFY_FROM ?? env.LEADS_NOTIFY_FROM;
  if (!env.RESEND_API_KEY || !from || to.length === 0) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) logger.warn("general", `Alert e-mail refused by provider (HTTP ${response.status}).`);
    return response.ok;
  } catch (error) {
    logger.error("general", "Alert e-mail failed", error);
    return false;
  }
}
