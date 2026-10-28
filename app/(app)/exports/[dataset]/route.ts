import { toPublicError } from "@/domain/shared/errors";
import { getCurrentSession } from "@/services/auth/session";
import { produceExport } from "@/services/exports/exports";

/** One registered export: the file, with its register id and fingerprint in the headers. */
export async function GET(_request: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const session = await getCurrentSession();
  if (!session) return new Response("Connexion requise.", { status: 401 });
  try {
    const { dataset } = await params;
    const { record, body } = await produceExport(dataset, session);
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${record.filename}"`,
        "Cache-Control": "no-store",
        "X-Export-Id": record.id,
        "X-Content-SHA256": record.sha256,
      },
    });
  } catch (error) {
    const e = toPublicError(error);
    return new Response(e.message, { status: e.kind === "AUTHORIZATION" ? 403 : e.kind === "NOT_FOUND" ? 404 : 500 });
  }
}
