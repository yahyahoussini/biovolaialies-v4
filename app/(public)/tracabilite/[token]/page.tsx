import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { clientKey } from "@/lib/client-info";
import { rateLimit } from "@/lib/rate-limit";
import { resolvePublicPassport } from "@/services/public/passport";
import { PassportView } from "./PassportView";

export const metadata: Metadata = {
  title: "Passeport de traçabilité — BIOVOLAILLES",
  description: "Vérifiez l'origine et le parcours de ce produit avicole.",
};

/**
 * The public gateway (phase-9 brief §1): resolvePublicPassport() is the ONLY data access this
 * route performs — no repository import here, ever. An invalid, revoked, or expired token
 * resolves to null and reads as a plain 404, indistinguishable from a token that never existed.
 */
/** Generous for people scanning labels, low enough to stop a script walking through tokens. Per server instance. */
const LOOKUPS_PER_MINUTE = 60;

export default async function PublicPassportPage({ params }: PageProps<"/tracabilite/[token]">) {
  const { token } = await params;
  if (!rateLimit(`passport:${await clientKey()}`, LOOKUPS_PER_MINUTE, 60_000).allowed) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p role="alert" className="max-w-sm text-center text-sm text-text">
          Trop de consultations depuis cet appareil en une minute. Réessayez dans un instant.
        </p>
      </main>
    );
  }
  const passport = await resolvePublicPassport(token);
  if (!passport) notFound();

  return <PassportView passport={passport} />;
}
