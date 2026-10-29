import { toPublicError } from "@/domain/shared/errors";
import { getCurrentSession } from "@/services/auth/session";
import { syncFieldOps } from "@/services/field/sync";
import { sameOrigin } from "@/lib/same-origin";

/** Entries queued on a phone, in its order. Each comes back with what became of it. */
export async function POST(request: Request) {
  const noStore = { "Cache-Control": "no-store" };
  if (!sameOrigin(request)) return Response.json({ error: "Requête refusée : origine inconnue." }, { status: 403, headers: noStore });
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "JSON attendu." }, { status: 415, headers: noStore });
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Connexion requise : reconnectez-vous pour envoyer vos saisies." }, { status: 401, headers: noStore });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Corps de requête illisible." }, { status: 400, headers: noStore });
  }
  try {
    return Response.json(await syncFieldOps(body, session), { headers: noStore });
  } catch (error) {
    const publicError = toPublicError(error);
    const status = publicError.kind === "AUTHORIZATION" ? 403 : publicError.kind === "VALIDATION" ? 400 : 503;
    return Response.json({ error: publicError.message }, { status, headers: noStore });
  }
}
