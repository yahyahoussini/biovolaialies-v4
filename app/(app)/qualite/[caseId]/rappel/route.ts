import { toPublicError } from "@/domain/shared/errors";
import { can } from "@/domain/shared/permissions";
import { repositories } from "@/data/repositories";
import { getCurrentSession } from "@/services/auth/session";
import { buildRecallReportForCase, recallReportToCsv } from "@/services/quality/recall";

/** CSV export of a case's recall scope (client spec API-10, as a signed-in download). */
export async function GET(_request: Request, ctx: RouteContext<"/qualite/[caseId]/rappel">) {
  const session = await getCurrentSession();
  if (!session) return new Response("Connexion requise.", { status: 401 });
  if (!can(session, "EXPORT", "QUALITY")) return new Response("Export non autorisé pour votre rôle.", { status: 403 });
  const { caseId } = await ctx.params;
  try {
    const qualityCase = await repositories.qualityCases.findById(caseId);
    const report = await buildRecallReportForCase(caseId, session);
    return new Response(recallReportToCsv(report, qualityCase?.code ?? caseId), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="rappel-${qualityCase?.code ?? caseId}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const e = toPublicError(error);
    return new Response(e.message, { status: e.kind === "AUTHORIZATION" ? 403 : e.kind === "NOT_FOUND" ? 404 : 500 });
  }
}
