import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import programme from "@/data/seed/reference/programme.json";
import { COVERAGE_LABEL, COVERAGE_TONE, RULE_COVERAGE, TEST_COVERAGE, type CoverageStatus } from "@/lib/programme-coverage";
import { requireModuleAccess } from "@/services/auth/guard";

type Row = (string | number)[];

export default async function ProgrammePage() {
  await requireModuleAccess("SETTINGS");
  const tests = programme.TESTS as Row[];
  const counts = (Object.keys(COVERAGE_LABEL) as CoverageStatus[]).map((s) => ({ s, n: Object.values(TEST_COVERAGE).filter((t) => t.status === s).length }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Programme BVU Tech"
        description="Feuille de route, jalons, preuves et risques du dossier client — et, pour chaque règle et chaque test d'acceptation, ce que ce logiciel couvre réellement."
      />

      <p className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning-strong">
        Statut de mise en production : <strong>NO-GO à ce stade</strong> (dossier client). Le logiciel est un PoC testé sur données
        simulées ; aucune validation industrielle (FAT/SAT) n&apos;a été réalisée.
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {counts.map(({ s, n }) => (
          <StatCard key={s} label={`Tests — ${COVERAGE_LABEL[s].toLowerCase()}`} value={`${n} / ${tests.length}`} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tests d&apos;acceptation T01–T40</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Test</TableHead>
                <TableHead>Domaine</TableHead>
                <TableHead>Scénario</TableHead>
                <TableHead>Attendu</TableHead>
                <TableHead>Couverture</TableHead>
                <TableHead>Où / pourquoi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests.map(([code, domain, name, scenario, expected]) => {
                const cov = TEST_COVERAGE[String(code)];
                return (
                  <TableRow key={String(code)}>
                    <TableCell className="font-medium">{code}</TableCell>
                    <TableCell>{domain}</TableCell>
                    <TableCell>
                      {name}
                      <span className="block text-xs text-secondary">{scenario}</span>
                    </TableCell>
                    <TableCell className="text-xs">{expected}</TableCell>
                    <TableCell>{cov ? <Badge tone={COVERAGE_TONE[cov.status]}>{COVERAGE_LABEL[cov.status]}</Badge> : "—"}</TableCell>
                    <TableCell className="max-w-xs text-xs text-secondary">{cov?.where}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Règles métier R01–R15</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Règle</TableHead>
                <TableHead>Exigence</TableHead>
                <TableHead>Conséquence attendue</TableHead>
                <TableHead>Couverture</TableHead>
                <TableHead>Mise en œuvre</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(programme.RULES as Row[]).map(([code, name, requirement, consequence]) => {
                const cov = RULE_COVERAGE[String(code)];
                return (
                  <TableRow key={String(code)}>
                    <TableCell className="font-medium">
                      {code} · {name}
                    </TableCell>
                    <TableCell>{requirement}</TableCell>
                    <TableCell className="text-xs">{consequence}</TableCell>
                    <TableCell>{cov ? <Badge tone={COVERAGE_TONE[cov.status]}>{COVERAGE_LABEL[cov.status]}</Badge> : "—"}</TableCell>
                    <TableCell className="max-w-xs text-xs text-secondary">{cov?.where}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Jalons G0–G7</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3 text-sm">
              {(programme.GATES as Row[]).map(([code, name, scope, criterion]) => (
                <li key={String(code)} className="rounded-md border border-border p-3">
                  <p className="font-medium">
                    {code} — {name}
                  </p>
                  <p className="text-secondary">{scope}</p>
                  <p className="text-xs">Critère : {criterion}</p>
                  {code === "G2" ? (
                    <p className="mt-1 text-xs text-success-strong">Tests logiciels du PoC passés dans ce dépôt — PV à établir et signer.</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>État des preuves (dossier client)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3 text-sm">
              {(programme.PROOF_STATUS as Row[]).map(([item, status, detail, limit]) => (
                <li key={String(item)} className="rounded-md border border-border p-3">
                  <p className="font-medium">
                    {item} — <span className="text-warning-strong">{status}</span>
                  </p>
                  <p className="text-secondary">{detail}</p>
                  <p className="text-xs">{limit}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Feuille de route RM-01 → RM-21</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Étape</TableHead>
                <TableHead>Semaines</TableHead>
                <TableHead>Activité</TableHead>
                <TableHead>Responsables</TableHead>
                <TableHead>Livrable</TableHead>
                <TableHead>Jalon</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(programme.ROADMAP as Row[]).map(([code, weeks, name, owners, , deliverable, , gate]) => (
                <TableRow key={String(code)}>
                  <TableCell className="font-medium">{code}</TableCell>
                  <TableCell className="whitespace-nowrap">{weeks}</TableCell>
                  <TableCell>{name}</TableCell>
                  <TableCell className="text-xs">{owners}</TableCell>
                  <TableCell className="text-xs">{deliverable}</TableCell>
                  <TableCell>{gate}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Risques</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Risque</TableHead>
                <TableHead>Niveau</TableHead>
                <TableHead>Mitigation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(programme.RISKS as Row[]).map(([code, name, level, mitigation]) => (
                <TableRow key={String(code)}>
                  <TableCell>
                    {code} · {name}
                  </TableCell>
                  <TableCell>
                    <Badge tone={level === "Élevé" ? "critical" : level === "Moyen" ? "warning" : "neutral"}>{level}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{mitigation}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
