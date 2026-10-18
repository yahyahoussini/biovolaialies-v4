import { toPublicError } from "@/domain/shared/errors";
import { getCurrentSession } from "@/services/auth/session";
import { issueLedgerAnchor } from "@/services/ledger/ledger";

/** Downloads a signed anchor of the current chain head — to be kept outside the platform. */
export async function GET() {
  const session = await getCurrentSession();
  if (!session) return new Response("Connexion requise.", { status: 401 });
  try {
    const anchor = await issueLedgerAnchor(session);
    return new Response(JSON.stringify(anchor, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="ancre-journal-${anchor.headSeq}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const e = toPublicError(error);
    return new Response(e.message, { status: e.kind === "AUTHORIZATION" ? 403 : 409 });
  }
}
