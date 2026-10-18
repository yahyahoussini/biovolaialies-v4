import {
  ArrowLeftRight,
  ArrowUpRight,
  Boxes,
  Database,
  Egg,
  Factory,
  GitBranch,
  LayoutDashboard,
  Lock,
  QrCode,
  ShieldCheck,
  Truck,
  WifiOff,
  Workflow,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { env } from "@/lib/env";
import { demoPublicToken } from "@/services/traceability/qr-tokens";
import { ContactForm } from "./ContactForm";

/**
 * The seeded "Traçabilité vérifiée" product. Linked only on demo deployments (the bundled
 * snapshot, or DEMO_MODE): a production database never holds the seed. Decided from
 * configuration, not a query, so this page stays statically prerendered.
 */
const DEMO_PASSPORT_TOKEN = demoPublicToken("product:BU-2025-010");

const CHAIN = [
  "Génétique",
  "Reproducteurs",
  "Œufs",
  "Couvoir",
  "Poussins",
  "Élevage",
  "Collecte / transfert",
  "Abattage",
  "Découpe",
  "Transformation",
  "Conditionnement",
  "Commercialisation",
  "QR",
];

const PROBLEMS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ArrowLeftRight,
    title: "Données fragmentées",
    text: "Structurer les informations provenant des équipes, des sites et des outils déjà utilisés.",
  },
  {
    icon: LayoutDashboard,
    title: "Visibilité opérationnelle",
    text: "Rapprocher les données de production, les stocks, les mouvements et les indicateurs utiles à la décision.",
  },
  {
    icon: GitBranch,
    title: "Traçabilité à consolider",
    text: "Organiser les événements et les liens entre les lots tout au long des étapes couvertes par le système.",
  },
];

const AUDIENCES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Egg, title: "Couvoirs", text: "Suivi des lots d'œufs, cycles d'incubation, mirage, éclosions et sorties de poussins." },
  { icon: Wheat, title: "Unités d'élevage", text: "Suivi des bandes, consommations, mortalité, pesées, ambiance et indicateurs de production." },
  { icon: Boxes, title: "Fabricants d'aliments", text: "Organisation des données de production, des stocks et des flux de matières." },
  { icon: Factory, title: "Abattoirs", text: "Continuité des identifiants entre réception du vif, abattage et lots carcasses." },
  { icon: Workflow, title: "Découpe et transformation", text: "Liens entre lots entrants, opérations, produits finis et conditionnement." },
  { icon: Truck, title: "Opérateurs intégrés", text: "Vision transversale des flux entre plusieurs unités, sous réserve d'interfaces validées." },
];

const DESIGN: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: WifiOff, title: "Mode local / hors ligne", text: "Saisie terrain et synchronisation différée sans doublon lorsque la connectivité est limitée." },
  { icon: ArrowLeftRight, title: "Interopérabilité", text: "API documentée et import de fichiers ; les protocoles machines sont vérifiés avant d'être promis." },
  { icon: Database, title: "Qualité des données", text: "Chaque valeur porte sa provenance et son statut : réel, simulé, estimé, à confirmer ou validé." },
  { icon: Lock, title: "Accès et sécurité", text: "Rôles, périmètres, journal d'audit et journal d'événements chaîné, vérifiable à tout moment." },
];

const STEPS = [
  { title: "Diagnostic", text: "Cartographier les flux, les utilisateurs, les outils et les contraintes techniques." },
  { title: "Cadrage", text: "Définir les livrables, les indicateurs, les interfaces et les critères d'acceptation." },
  { title: "PoC et tests", text: "Configurer le périmètre retenu, tester les données et former les utilisateurs concernés." },
  { title: "Validation", text: "Évaluer les résultats, traiter les écarts et décider des suites à donner." },
];

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <p className={`text-[11px] font-extrabold uppercase tracking-[0.18em] ${dark ? "text-bvu-lime" : "text-bvu-green"}`}>
      {children}
    </p>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-3 mb-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{children}</h2>;
}

export default function HomePage() {
  const demoPassportAvailable = env.DATABASE_SNAPSHOT || env.DEMO_MODE;

  return (
    <>
      {/* Hero */}
      <section
        id="accueil"
        className="bg-[radial-gradient(ellipse_at_85%_15%,rgba(200,230,107,0.22),transparent_35%)] py-16 sm:py-24"
      >
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Eyebrow>Pilotage numérique des filières avicoles</Eyebrow>
            <h1 className="mt-4 mb-6 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
              Relier les données.
              <br />
              Maîtriser les flux.
              <br />
              <span className="text-bvu-green">Tracer la production.</span>
            </h1>
            <p className="max-w-xl text-lg text-bvu-muted">
              BVU Tech conçoit une plateforme numérique intégrée pour aider les opérateurs avicoles à mieux suivre leurs
              opérations, structurer leurs données et renforcer la traçabilité de leurs produits — de la génétique au QR
              code.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#contact" className="inline-flex items-center gap-2 rounded-full bg-bvu-green px-5 py-3 font-bold text-white transition hover:-translate-y-0.5">
                Étudier mon projet <ArrowUpRight className="size-4" aria-hidden="true" />
              </a>
              <a href="#solution" className="rounded-full border border-bvu-line bg-white px-5 py-3 font-bold transition hover:-translate-y-0.5">
                Découvrir la solution
              </a>
            </div>
            <p className="mt-4 text-xs text-bvu-muted">
              Une approche modulaire, à dimensionner selon vos installations, vos équipements et vos contraintes
              opérationnelles.
            </p>
          </div>

          <div aria-label="Illustration conceptuelle du tableau de bord" className="rotate-[0.5deg] rounded-3xl border border-bvu-line bg-white p-6 shadow-[0_18px_50px_rgba(16,42,36,0.08)]">
            <div className="flex justify-between gap-3">
              <div>
                <p className="text-[11px] text-bvu-muted">BVU TECH / APERÇU</p>
                <p className="text-lg font-extrabold">Vue de pilotage</p>
              </div>
              <span className="h-fit rounded-full bg-[#edf5e9] px-2.5 py-1 text-[10px] font-extrabold text-bvu-green">MAQUETTE</span>
            </div>
            <div className="my-5 grid grid-cols-3 gap-2.5">
              {[
                ["LOT", "Identification"],
                ["FLUX", "Suivi opérationnel"],
                ["QR", "Restitution produit"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-bvu-paper p-3">
                  <strong className="block text-lg">{k}</strong>
                  <span className="text-[11px] text-bvu-muted">{v}</span>
                </div>
              ))}
            </div>
            <ol className="grid gap-3 rounded-xl border border-bvu-line p-4 text-sm">
              {[
                "Référentiel et création du lot",
                "Enregistrement des événements",
                "Suivi des transferts et opérations",
                "Blocage qualité et rappel amont / aval",
                "Historique et restitution des données",
              ].map((step) => (
                <li key={step} className="flex items-center gap-2.5">
                  <span className="size-2.5 shrink-0 rounded-full bg-bvu-green" aria-hidden="true" />
                  {step}
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-bvu-muted">Illustration conceptuelle — données fictives.</p>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section id="enjeux" className="py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="mb-9 max-w-3xl">
            <Eyebrow>Le problème opérationnel</Eyebrow>
            <SectionTitle>Des opérations connectées, mais des données souvent dispersées.</SectionTitle>
            <p className="text-bvu-muted">
              Lorsque les informations sont réparties entre fichiers, registres, logiciels et équipements, la consolidation
              des indicateurs et la reconstitution du parcours d&apos;un lot peuvent devenir complexes — et un rappel
              produit, lent et incertain.
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {PROBLEMS.map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-2xl border border-bvu-line bg-white p-6">
                <span className="grid size-11 place-items-center rounded-xl bg-[#edf5e9] text-bvu-green">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-bvu-muted">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Solution */}
      <section id="solution" className="bg-bvu-dark py-20 text-white">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="mb-9 max-w-3xl">
            <Eyebrow dark>Une architecture modulaire</Eyebrow>
            <SectionTitle>Deux briques fonctionnelles complémentaires.</SectionTitle>
            <p className="text-bvu-on-dark">
              Le périmètre définitif est établi après analyse des processus, des équipements, des données disponibles et
              des besoins du client.
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <article className="rounded-2xl border border-[#29493f] bg-bvu-card-dark p-7">
              <span className="grid size-11 place-items-center rounded-xl bg-bvu-lime text-bvu-dark">
                <GitBranch className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-xl font-bold">Master Traceability</h3>
              <p className="mt-2 text-bvu-on-dark">
                Structurer l&apos;identité des lots, enregistrer les événements, documenter les transferts et relier les
                étapes du parcours de production.
              </p>
              <ul className="mt-4 grid gap-1.5 text-bvu-on-dark">
                <li>• Référentiel des lots et identifiants, de la génétique au produit fini</li>
                <li>• Journal d&apos;événements en ajout seul, chaîné et vérifiable</li>
                <li>• Blocage qualité propagé aux lots descendants, levée par rôle habilité</li>
                <li>• Rappel amont / aval et passeport produit par QR code</li>
              </ul>
            </article>
            <article className="rounded-2xl border border-[#29493f] bg-bvu-card-dark p-7">
              <span className="grid size-11 place-items-center rounded-xl bg-bvu-lime text-bvu-dark">
                <LayoutDashboard className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-xl font-bold">Production Flow</h3>
              <p className="mt-2 text-bvu-on-dark">
                Organiser les informations de pilotage de la production et faciliter le suivi des indicateurs définis avec
                l&apos;opérateur.
              </p>
              <ul className="mt-4 grid gap-1.5 text-bvu-on-dark">
                <li>• Effectifs, consommations d&apos;aliment et d&apos;eau, pesées et mortalité</li>
                <li>• Indicateurs calculés seulement quand les données le justifient (FCR, croissance…)</li>
                <li>• Détection d&apos;anomalies par règles explicites, alertes et actions tracées</li>
                <li>• Bilans matière : couvoir, abattage, découpe et transformation</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      {/* Chain */}
      <section id="tracabilite" className="py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="max-w-3xl">
            <Eyebrow>Vision de chaîne</Eyebrow>
            <SectionTitle>Relier les étapes couvertes par le projet.</SectionTitle>
            <p className="text-bvu-muted">
              La chaîne ci-dessous représente la cible fonctionnelle. Chaque maillon dépend des données accessibles, des
              responsabilités des acteurs et de la validation des interfaces nécessaires.
            </p>
          </div>
          <ol className="mt-7 flex flex-wrap gap-2.5" aria-label="Chaîne de traçabilité">
            {CHAIN.map((step, i) => (
              <li key={step} className="flex items-center gap-2.5">
                <span className="rounded-lg border border-bvu-line bg-white px-3 py-2 text-sm font-bold">{step}</span>
                {i < CHAIN.length - 1 ? (
                  <span aria-hidden="true" className="text-bvu-muted">
                    →
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="mt-8 rounded-2xl border border-[#dce9d7] bg-[#edf5e9] p-6">
            <strong>Principe d&apos;intégration</strong>
            <p className="mt-2 text-bvu-muted">
              Les connexions à des automates, capteurs, logiciels tiers ou équipements industriels sont étudiées au cas par
              cas. La compatibilité Modbus, OPC UA, API, fichiers d&apos;import ou autres protocoles est vérifiée sur banc
              avant d&apos;être promise.
            </p>
          </div>
        </div>
      </section>

      {/* Demo */}
      <section id="demonstration" className="bg-bvu-mist py-20">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <Eyebrow>Démonstrateur logiciel</Eyebrow>
            <SectionTitle>Voir la traçabilité, pas seulement la lire.</SectionTitle>
            <p className="text-bvu-muted">
              Un démonstrateur fonctionnel couvre déjà la chaîne de bout en bout sur des données simulées, calibrées sur
              des standards de souche : lots, mesures, indicateurs, anomalies, blocage qualité, rappel et passeport QR
              public.
            </p>
            <p className="mt-3 text-sm text-bvu-muted">
              Démonstrateur logiciel — données simulées. Aucune validation industrielle sur site n&apos;est revendiquée à
              ce stade : elle passe par les recettes usine et site (FAT / SAT) du projet pilote.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {demoPassportAvailable ? (
                <Link
                  href={`/tracabilite/${DEMO_PASSPORT_TOKEN}`}
                  className="inline-flex items-center gap-2 rounded-full bg-bvu-green px-5 py-3 font-bold text-white transition hover:-translate-y-0.5"
                >
                  <QrCode className="size-4" aria-hidden="true" /> Ouvrir un passeport produit
                </Link>
              ) : null}
              <a href="#contact" className="rounded-full border border-bvu-line bg-white px-5 py-3 font-bold transition hover:-translate-y-0.5">
                Demander une démonstration guidée
              </a>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {DESIGN.map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-2xl border border-bvu-line bg-white p-5">
                <Icon className="size-5 text-bvu-green" aria-hidden="true" />
                <h3 className="mt-3 font-bold">{title}</h3>
                <p className="mt-1.5 text-sm text-bvu-muted">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Method */}
      <section id="methode" className="bg-bvu-dark py-20 text-white">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="mb-9 max-w-3xl">
            <Eyebrow dark>Méthode de déploiement</Eyebrow>
            <SectionTitle>Partir du terrain, valider avant de généraliser.</SectionTitle>
            <p className="text-bvu-on-dark">
              Le calendrier et le périmètre du PoC sont arrêtés conjointement selon la complexité du site, les données
              disponibles et les moyens mobilisés.
            </p>
          </div>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-2xl border border-[#345047] bg-white/5 p-6">
                <p className="text-xs font-black text-bvu-lime">ÉTAPE {String(i + 1).padStart(2, "0")}</p>
                <h3 className="mt-2 text-lg font-bold">{step.title}</h3>
                <p className="mt-2 text-sm text-bvu-on-dark">{step.text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-xs text-bvu-on-dark">
            Toute durée annoncée reste indicative jusqu&apos;à la validation du périmètre, des ressources et des prérequis
            techniques.
          </p>
        </div>
      </section>

      {/* Audiences */}
      <section id="clients" className="py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="mb-9 max-w-3xl">
            <Eyebrow>Pour les professionnels</Eyebrow>
            <SectionTitle>Une solution à étudier selon votre activité.</SectionTitle>
            <p className="text-bvu-muted">
              Le modèle d&apos;intégration et l&apos;offre commerciale sont adaptés au volume d&apos;activité, au nombre de
              sites et aux besoins réels.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AUDIENCES.map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-2xl border border-bvu-line bg-white p-6">
                <Icon className="size-5 text-bvu-green" aria-hidden="true" />
                <h3 className="mt-3 text-lg font-bold">{title}</h3>
                <p className="mt-1.5 text-bvu-muted">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="pb-24 pt-4">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <Eyebrow>Parlons de votre projet</Eyebrow>
            <SectionTitle>Étudions votre besoin opérationnel.</SectionTitle>
            <p className="text-bvu-muted">
              Décrivez votre activité, vos sites et vos priorités. Une première qualification permettra d&apos;identifier
              les données disponibles, les contraintes et un éventuel périmètre pilote.
            </p>
            <div className="mt-6 rounded-2xl border border-[#dce9d7] bg-[#edf5e9] p-6">
              <div className="flex items-center gap-2 font-bold">
                <ShieldCheck className="size-5 text-bvu-green" aria-hidden="true" /> Une approche B2B sur mesure
              </div>
              <p className="mt-2 text-bvu-muted">
                Le dimensionnement et le modèle d&apos;abonnement annuel sont définis selon les capacités, les volumes et
                les modules retenus. Les conditions commerciales sont communiquées après cadrage.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-bvu-line bg-white p-6 sm:p-7">
            <h3 className="text-xl font-bold">Demande de contact</h3>
            <p className="mb-5 mt-1 text-sm text-bvu-muted">Votre demande est lue par l&apos;équipe BVU Tech avant toute prise de contact.</p>
            <ContactForm demoStorageNote={env.DATABASE_SNAPSHOT} />
          </div>
        </div>
      </section>
    </>
  );
}
