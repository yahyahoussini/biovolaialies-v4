import { Leaf, MapPin, ShieldAlert, ShieldCheck } from "lucide-react";
import type { PublicPassport } from "@/domain/traceability/types";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function formatPeriod(period: PublicPassport["period"]): string {
  const start = formatDate(period.start);
  if (!period.end) return period.start ? `Depuis le ${start}` : "—";
  return `${start} → ${formatDate(period.end)}`;
}

/**
 * Pure presentational — every value here comes straight from the curated PublicPassport DTO
 * (services/public/passport.ts). No id, no repository access, nothing beyond what that DTO
 * already decided is safe to show (phase-9 brief §4-§5).
 *
 * Deliberately unlike the internal control centre (§16): one column, large type, generous
 * spacing, and a single question answered per block. The first screen answers "what is this,
 * where is it from, is it verified" without scrolling — so product identity leads, and the
 * verification verdict sits immediately under it.
 */
export function PassportView({ passport }: { passport: PublicPassport }) {
  const title = passport.productName ?? `Lot ${passport.lotCode}`;

  return (
    <>
      <header className="bg-deep-forest px-5 pb-9 pt-8 text-center text-white">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-white/10">
          <Leaf className="size-5" aria-hidden="true" />
        </div>
        <p className="mt-3 text-caption font-semibold uppercase tracking-widest text-white/70">BIOVOLAILLES</p>
        {/* The product is the page's subject, so it is the h1 — the brand name is not. */}
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 flex items-center justify-center gap-1.5 text-sm text-white/75">
          <MapPin className="size-3.5" aria-hidden="true" />
          {passport.originFarmName}, {passport.originCity}
        </p>
      </header>

      <main className="mx-auto flex max-w-md flex-col gap-6 px-5 pb-10">
        {/* Pulled up over the header seam so the verdict is unmissable on first paint. */}
        <section
          className={`-mt-5 flex flex-col items-center gap-2 rounded-xl border px-6 py-6 text-center shadow-sm ${
            passport.verified ? "border-bio-green/30 bg-surface" : "border-warning/30 bg-surface"
          }`}
        >
          {passport.verified ? (
            <ShieldCheck className="size-8 text-bio-green" aria-hidden="true" />
          ) : (
            <ShieldAlert className="size-8 text-warning-strong" aria-hidden="true" />
          )}
          <p className={`text-lg font-bold tracking-tight ${passport.verified ? "text-deep-forest" : "text-warning-strong"}`}>
            {passport.verified ? "Traçabilité vérifiée" : "Traçabilité non vérifiée"}
          </p>
          <p className="text-sm leading-relaxed text-secondary">{passport.publicStatus}</p>
        </section>

        {passport.qualityHold ? (
          <p role="alert" className="rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-center text-sm font-semibold leading-relaxed text-critical-strong">
            Ce produit fait l&apos;objet d&apos;une vérification qualité en cours par l&apos;opérateur. Renseignez-vous auprès
            de votre point de vente avant consommation.
          </p>
        ) : null}

        {passport.isDemoData ? (
          <p className="rounded-lg border border-gold/45 bg-gold/10 px-4 py-3 text-center text-caption font-medium leading-relaxed text-deep-forest">
            Données de démonstration — cet environnement n&apos;est pas une chaîne de production réelle.
          </p>
        ) : null}

        <section className="flex flex-col rounded-xl border border-border bg-surface px-5 py-1">
          <h2 className="sr-only">Informations produit</h2>
          {passport.bvuId ? <Fact label="Identifiant BIOVOLAILLES" value={passport.bvuId} mono /> : null}
          <Fact label="Lot" value={passport.lotCode} />
          <Fact label="Ferme d'origine" value={passport.originFarmName} />
          <Fact label="Ville" value={passport.originCity} />
          {passport.geneticOrigin ? <Fact label="Origine amont" value={passport.geneticOrigin} /> : null}
          <Fact label="Période de production" value={formatPeriod(passport.period)} last />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-overline">Parcours</h2>
          <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm">
            {passport.lineage.map((stage, i) => (
              <li key={`${stage.label}-${i}`} className="flex items-center gap-1.5">
                {i > 0 ? (
                  <span className="text-muted" aria-hidden="true">
                    →
                  </span>
                ) : null}
                <span className="rounded-full border border-border bg-surface px-3 py-1 text-caption font-medium text-text">
                  {stage.name}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-overline">Étapes de traçabilité</h2>
          <ol className="flex flex-col rounded-xl border border-border bg-surface p-5">
            {passport.timeline.map((entry, i) => (
              <li key={`${entry.label}-${i}`} className="relative flex gap-3.5 pb-5 last:pb-0">
                {i < passport.timeline.length - 1 ? (
                  <span className="absolute left-1.25 top-3.5 h-full w-px bg-border" aria-hidden="true" />
                ) : null}
                <span
                  className={`z-10 mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-surface ${
                    entry.verified ? "bg-bio-green" : "bg-border"
                  }`}
                  aria-hidden="true"
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold text-text">
                    {entry.label}
                    {/* Verification is stated, not left to the dot's colour alone (§18). */}
                    {!entry.verified ? <span className="font-normal text-secondary"> — non vérifiée</span> : null}
                  </span>
                  {entry.description ? <span className="text-caption text-secondary">{entry.description}</span> : null}
                  {entry.date ? <span className="text-caption text-muted">{formatDate(entry.date)}</span> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {passport.certifications.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-overline">Certifications</h2>
            <div className="flex flex-wrap gap-2">
              {passport.certifications.map((cert) => (
                <span
                  key={cert}
                  className="rounded-full border border-bio-green/25 bg-bio-green/10 px-3 py-1 text-caption font-semibold text-deep-green"
                >
                  {cert}
                </span>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <footer className="border-t border-border px-5 py-6 text-center text-caption leading-relaxed text-secondary">
        Propulsé par BIOVOLAILLES — vérification basée sur les données internes du système.
      </footer>
    </>
  );
}

function Fact({ label, value, last, mono }: { label: string; value: string; last?: boolean; mono?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-4 py-3 ${last ? "" : "border-b border-border"}`}>
      <span className="shrink-0 text-caption text-secondary">{label}</span>
      <span className={`text-right text-sm font-semibold text-text ${mono ? "break-all font-mono tracking-wide" : ""}`}>{value}</span>
    </div>
  );
}
