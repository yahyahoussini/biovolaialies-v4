import { toPublicError } from "@/domain/shared/errors";
import { getCurrentSession } from "@/services/auth/session";
import { exportLeadsCsv } from "@/services/leads/leads";

/** CSV download of every lead. Authorization lives in the service (LEADS:EXPORT), not in the proxy. */
export async function GET() {
  const session = await getCurrentSession();
  if (!session) return new Response("Connexion requise.", { status: 401 });
  try {
    const csv = await exportLeadsCsv(session);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="prospects-bvu-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const publicError = toPublicError(error);
    return new Response(publicError.message, { status: publicError.kind === "AUTHORIZATION" ? 403 : 500 });
  }
}
