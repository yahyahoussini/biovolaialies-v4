import { ApiError, apiRoute, json } from "@/services/api/http";
import { apiRecallExport } from "@/services/api/operations";
import { recallReportToCsv } from "@/services/quality/recall";

/** API-10 — recall scope of a quality case (by id or code), as JSON (default) or CSV (?format=csv). */
export const GET = apiRoute<{ caseId: string }>("recall:export", async ({ request, session, correlationId }, { caseId }) => {
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "csv") throw new ApiError(400, "INVALID_FORMAT", "format = json | csv.");
  const result = await apiRecallExport(caseId, session);
  if (format === "csv") {
    return new Response(recallReportToCsv(result.report, result.caseCode), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="rappel-${result.caseCode}.csv"`,
        "X-Correlation-ID": correlationId,
        "Cache-Control": "no-store",
      },
    });
  }
  return json(result, 200, correlationId);
});
