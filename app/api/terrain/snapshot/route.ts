import { toPublicError } from "@/domain/shared/errors";
import { getCurrentSession } from "@/services/auth/session";
import { buildFieldSnapshot } from "@/services/field/snapshot";

/** What the field app keeps for offline work. Scope and permissions are applied by the service. */
export async function GET() {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Connexion requise." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    return Response.json(await buildFieldSnapshot(session), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const publicError = toPublicError(error);
    return Response.json({ error: publicError.message }, { status: publicError.kind === "AUTHORIZATION" ? 403 : 500, headers: { "Cache-Control": "no-store" } });
  }
}
