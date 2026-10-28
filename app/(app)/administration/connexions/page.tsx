import { redirect } from "next/navigation";
import { PageHeader } from "@/components/domain/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { AUTH_OUTCOME, AUTH_OUTCOME_LABEL, FAILURE_WINDOW_MS, MAX_FAILURES_PER_ACCOUNT, MAX_FAILURES_PER_CLIENT, type AuthOutcome } from "@/domain/governance/governance";
import { canAccessModule } from "@/domain/shared/permissions";
import { when } from "@/lib/flow-labels";
import { requireSession } from "@/services/auth/session";
import { listAuthEvents } from "@/services/auth/journal";

const TONE: Record<AuthOutcome, "success" | "warning" | "critical" | "neutral" | "info"> = { SUCCES: "success", ECHEC: "warning", BLOQUE: "critical", DECONNEXION: "neutral", BASCULE_DEMO: "info" };

/** Device as a short, stable label — the keyed hash of its address, never the address. */
const device = (hash: string | null, ua: string | null) => {
  const browser = ua ? (/Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Autre navigateur") : "—";
  const system = ua ? (/Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "") : "";
  return { label: [browser, system].filter(Boolean).join(" · "), hash: hash ?? "—" };
};

/**
 * The authentication journal (document 3, ch. 08): every sign-in, failure, block and sign-out.
 * Failures are counted per account and per device; past the limit, sign-in is refused for a while
 * with the same message whether the account exists or not.
 */
export default async function SignInJournalPage({ searchParams }: PageProps<"/administration/connexions">) {
  const session = await requireSession();
  if (!canAccessModule(session, "USERS") && !canAccessModule(session, "AUDIT")) redirect("/non-autorise");
  const params = await searchParams;
  const email = typeof params.email === "string" ? params.email : "";
  const outcome = typeof params.outcome === "string" && (AUTH_OUTCOME as readonly string[]).includes(params.outcome) ? (params.outcome as AuthOutcome) : undefined;
  const events = await listAuthEvents(session, { email, outcome });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Administration", href: "/administration" }, { label: "Connexions" }]}
        title="Journal des connexions"
        description={`Chaque connexion, échec, blocage et déconnexion. Après ${MAX_FAILURES_PER_ACCOUNT} échecs sur un compte, ou ${MAX_FAILURES_PER_CLIENT} depuis un même appareil, en ${FAILURE_WINDOW_MS / 60_000} minutes, la connexion est refusée. L'appareil est noté par une empreinte de son adresse, jamais par l'adresse elle-même.`}
      />
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-secondary">Compte</span>
          <input name="email" defaultValue={email} placeholder="adresse e-mail" className="h-10 rounded-lg border border-border bg-background px-3" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-secondary">Événement</span>
          <select name="outcome" defaultValue={outcome ?? ""} className="h-10 rounded-lg border border-border bg-background px-3">
            <option value="">Tous</option>
            {AUTH_OUTCOME.map((o) => (
              <option key={o} value={o}>
                {AUTH_OUTCOME_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-10 rounded-lg bg-bio-green px-4 text-sm font-semibold text-white">
          Filtrer
        </button>
      </form>
      <Card>
        <CardHeader>
          <CardTitle>Derniers événements</CardTitle>
          <CardDescription>Les 300 plus récents, du plus récent au plus ancien.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quand</TableHead>
                <TableHead>Compte</TableHead>
                <TableHead>Événement</TableHead>
                <TableHead>Appareil</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 ? <TableEmpty colSpan={4}>Aucun événement.</TableEmpty> : null}
              {events.map((e) => {
                const d = device(e.clientHash, e.userAgent);
                return (
                  <TableRow key={e.id}>
                    <TableCell>{when(e.at)}</TableCell>
                    <TableCell>
                      {e.userName ?? "—"}
                      <p className="text-caption text-secondary">{e.email}</p>
                    </TableCell>
                    <TableCell>
                      <Badge tone={TONE[e.outcome]}>{AUTH_OUTCOME_LABEL[e.outcome]}</Badge>
                      {e.detail ? <p className="text-caption text-secondary">{e.detail}</p> : null}
                    </TableCell>
                    <TableCell>
                      {d.label}
                      <p className="font-mono text-caption text-secondary">{d.hash}</p>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
