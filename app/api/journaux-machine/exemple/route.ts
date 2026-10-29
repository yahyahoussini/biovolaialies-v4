import { handleActionError } from "@/lib/handle-error";
import { getCurrentSession } from "@/services/auth/session";
import { machineLogSample } from "@/services/telemetry/machine-import";

/** An example incubator log, as a machine writes it (Windows-1252), marked so it cannot be imported as real data. */
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return new Response("Connexion requise.", { status: 401 });
  try {
    const { fileName, body } = await machineLogSample(new URL(request.url).searchParams.get("zone") ?? "", session);
    return new Response(body, {
      headers: { "Content-Type": "text/csv; charset=windows-1252", "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    const e = handleActionError("general", error);
    return new Response(e.message, { status: e.kind === "AUTHORIZATION" ? 403 : e.kind === "NOT_FOUND" ? 404 : 500 });
  }
}
