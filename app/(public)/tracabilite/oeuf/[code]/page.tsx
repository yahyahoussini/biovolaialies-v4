import { Egg, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { Metadata } from "next";
import { clientKey } from "@/lib/client-info";
import { rateLimit } from "@/lib/rate-limit";
import { resolvePublicEgg, type PublicEggResult, type PublicEggTone } from "@/services/public/egg";
import { EggLookupForm } from "../EggLookupForm";

export const metadata: Metadata = {
  title: "Origine de l'œuf — BIOVOLAILLES",
  description: "Origine et contrôle de marquage d'un œuf BIOVOLAILLES.",
  robots: { index: false, follow: false },
};

/** Codes are sequential: a brake on one address trying codes one after another. */
const LOOKUPS_PER_MINUTE = 30;

const TONE: Record<PublicEggTone, { box: string; text: string; Icon: typeof ShieldCheck }> = {
  ok: { box: "border-bio-green/30", text: "text-deep-forest", Icon: ShieldCheck },
  warning: { box: "border-warning/40", text: "text-warning-strong", Icon: ShieldAlert },
  critical: { box: "border-critical/40", text: "text-critical-strong", Icon: ShieldAlert },
  neutral: { box: "border-border", text: "text-text", Icon: ShieldQuestion },
};

/**
 * The public egg page: resolvePublicEgg() is the only data access, and it decides what may be
 * shown. A misread code is said to be misread; an unknown code is said to be unknown — never a
 * guess at the egg it was meant to be.
 */
export default async function PublicEggPage({ params }: PageProps<"/tracabilite/oeuf/[code]">) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  const limited = !rateLimit(`egg:${await clientKey()}`, LOOKUPS_PER_MINUTE, 60_000).allowed;
  const result: PublicEggResult | null = limited ? null : await resolvePublicEgg(code);

  return (
    <>
      <header className="bg-deep-forest px-5 pb-9 pt-8 text-center text-white">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-white/10">
          <Egg className="size-5" aria-hidden="true" />
        </div>
        <p className="mt-3 text-caption font-semibold uppercase tracking-widest text-white/70">BIOVOLAILLES</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">{result?.status === "FOUND" && result.egg.kind === "PLATEAU" ? "Plateau d'œufs" : "Origine de l'œuf"}</h1>
        <p className="mt-1.5 font-mono text-sm tracking-wider text-white/75">{code.toUpperCase()}</p>
      </header>

      <main className="mx-auto flex max-w-md flex-col gap-6 px-5 pb-10">
        {limited ? (
          <Verdict tone="warning" title="Trop de recherches" detail="Réessayez dans une minute." />
        ) : result?.status === "MISREAD" ? (
          <Verdict tone="warning" title="Code mal lu" detail="Le caractère de contrôle ne correspond pas : un caractère est mal lu ou deux sont inversés. Vérifiez chaque caractère du code." />
        ) : result?.status === "UNKNOWN" ? (
          <Verdict tone="neutral" title="Code inconnu" detail="Ce code n'a pas été imprimé par une ligne de marquage BIOVOLAILLES." />
        ) : result?.status === "FOUND" ? (
          <>
            <Verdict tone={result.egg.tone} title={result.egg.title} detail={result.egg.detail} />
            {result.egg.isDemoData ? (
              <p className="rounded-lg border border-gold/45 bg-gold/10 px-4 py-3 text-center text-caption font-medium leading-relaxed text-deep-forest">
                Données de démonstration — cet environnement n&apos;est pas une chaîne de production réelle.
              </p>
            ) : null}
            <section className="flex flex-col rounded-xl border border-border bg-surface px-5 py-1">
              <h2 className="sr-only">Informations</h2>
              {result.egg.facts.map((f, i) => (
                <div key={f.label} className={`flex items-start justify-between gap-4 py-3 ${i < result.egg.facts.length - 1 ? "border-b border-border" : ""}`}>
                  <span className="shrink-0 text-caption text-secondary">{f.label}</span>
                  <span className="text-right text-sm font-semibold text-text">{f.value}</span>
                </div>
              ))}
            </section>
            {result.egg.readRate !== null ? (
              <section className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface px-5 py-4">
                <h2 className="text-overline">Qualité de la preuve</h2>
                <p className="text-sm leading-relaxed text-secondary">
                  La caméra de la ligne a relu{" "}
                  <span className="font-semibold text-text">{(result.egg.readRate * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %</span> des codes imprimés lors de ce marquage. Les œufs dont le code n&apos;a pas été relu sortent par le rejet.
                </p>
              </section>
            ) : null}
          </>
        ) : null}
        <EggLookupForm />
      </main>

      <footer className="border-t border-border px-5 py-6 text-center text-caption leading-relaxed text-secondary">Propulsé par BIOVOLAILLES — vérification basée sur les données internes du système.</footer>
    </>
  );
}

function Verdict({ tone, title, detail }: { tone: PublicEggTone; title: string; detail: string }) {
  const { box, text, Icon } = TONE[tone];
  return (
    <section className={`-mt-5 flex flex-col items-center gap-2 rounded-xl border bg-surface px-6 py-6 text-center shadow-sm ${box}`}>
      <Icon className={`size-8 ${tone === "ok" ? "text-bio-green" : text}`} aria-hidden="true" />
      <p className={`text-lg font-bold tracking-tight ${text}`}>{title}</p>
      <p className="text-sm leading-relaxed text-secondary">{detail}</p>
    </section>
  );
}
