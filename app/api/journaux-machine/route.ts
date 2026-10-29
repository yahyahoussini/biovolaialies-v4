import { handleActionError } from "@/lib/handle-error";
import { sameOrigin } from "@/lib/same-origin";
import { getCurrentSession } from "@/services/auth/session";
import { importMachineLog, MAX_LOG_BYTES } from "@/services/telemetry/machine-import";

/**
 * One incubator log, sent as the file itself (multipart): the server fingerprints the exact bytes it
 * received and reads them with the profile confirmed on screen. A route rather than a Server Action,
 * whose body is capped at 1 MB — a month of one-minute lines is larger.
 */
export async function POST(request: Request) {
  const noStore = { "Cache-Control": "no-store" };
  if (!sameOrigin(request)) return Response.json({ error: "Requête refusée : origine inconnue." }, { status: 403, headers: noStore });
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Connexion requise." }, { status: 401, headers: noStore });
  // Refused before the body is read: the declared size already says it is too large.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_LOG_BYTES + 64 * 1024) {
    return Response.json({ error: `Fichier trop volumineux : ${MAX_LOG_BYTES / 1024 / 1024} Mo au plus. Exportez une période plus courte.` }, { status: 413, headers: noStore });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Envoi illisible : formulaire avec fichier attendu." }, { status: 400, headers: noStore });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Aucun fichier reçu." }, { status: 400, headers: noStore });
  let profile: unknown;
  try {
    profile = JSON.parse(String(form.get("profile") ?? ""));
  } catch {
    return Response.json({ error: "Profil de lecture illisible." }, { status: 400, headers: noStore });
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await importMachineLog({ zoneId: form.get("zoneId"), fileName: file.name, dataStatus: form.get("dataStatus"), profile }, bytes, session);
    return Response.json(result, { headers: noStore });
  } catch (error) {
    const e = handleActionError("general", error);
    const status = e.kind === "AUTHORIZATION" ? 403 : e.kind === "NOT_FOUND" ? 404 : e.kind === "CONFLICT" ? 409 : e.kind === "VALIDATION" ? 400 : 500;
    return Response.json({ error: e.message }, { status, headers: noStore });
  }
}
