import { ApiError, apiRoute } from "@/services/api/http";

/**
 * API-06 — deliberately not available to machines. A release is a human decision taken by an
 * authorised quality manager, a different person from the one who opened the hold, with
 * justification and evidence (rule R10) — the platform records it in the application, where
 * that person is authenticated. Always 403, with the reason.
 */
export const POST = apiRoute(null, async () => {
  throw new ApiError(403, "HUMAN_DECISION_REQUIRED", "La levée d'un blocage est une décision humaine : elle se prend dans l'application par un responsable qualité habilité.");
});
