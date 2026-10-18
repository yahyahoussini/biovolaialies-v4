import { toPublicError } from "@/domain/shared/errors";
import { getCurrentSession } from "@/services/auth/session";
import { exportEquipmentCsv } from "@/services/equipment/equipment";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return new Response("Connexion requise.", { status: 401 });
  try {
    const params = new URL(request.url).searchParams;
    const filters = { unitCode: params.get("unite"), category: params.get("categorie") };
    return new Response(await exportEquipmentCsv(session, filters), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="equipements-par-unite.csv"', "Cache-Control": "no-store" },
    });
  } catch (error) {
    const e = toPublicError(error);
    return new Response(e.message, { status: e.kind === "AUTHORIZATION" ? 403 : 500 });
  }
}
