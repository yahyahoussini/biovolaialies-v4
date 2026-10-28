"use server";

import { clientKey } from "@/lib/client-info";
import { handleActionError } from "@/lib/handle-error";
import { submitLead } from "@/services/leads/leads";

export interface ContactFormState {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string>;
}

/**
 * Server Actions carry Next.js's own origin check (POSTs from another site are refused), which
 * covers the CSRF protection the client's Flask version implemented by hand.
 */
export async function submitContactAction(_prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  try {
    const result = await submitLead(
      {
        company: formData.get("company"),
        contactName: formData.get("contactName"),
        email: formData.get("email"),
        phone: formData.get("phone"),
        activity: formData.get("activity"),
        capacity: formData.get("capacity"),
        need: formData.get("need"),
        consent: formData.get("consent") === "yes",
      },
      { clientKey: await clientKey(), honeypot: String(formData.get("website") ?? "") }
    );
    if (!result.ok) {
      return {
        status: "error",
        message: result.error.message,
        fieldErrors: result.error.kind === "VALIDATION" ? result.error.fieldErrors : {},
      };
    }
    return {
      status: "success",
      message: "Merci. Votre demande a bien été enregistrée. Notre équipe revient vers vous pour une première qualification.",
      fieldErrors: {},
    };
  } catch (error) {
    handleActionError("server-action", error);
    return {
      status: "error",
      message: "Une erreur technique est survenue. Merci de réessayer plus tard.",
      fieldErrors: {},
    };
  }
}
