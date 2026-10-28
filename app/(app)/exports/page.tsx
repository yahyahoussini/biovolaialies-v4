import { FileDown } from "lucide-react";
import { PageHeader } from "@/components/domain/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { when } from "@/lib/flow-labels";
import { requireSession } from "@/services/auth/session";
import { datasetsFor, EXPORT_DATASET_INFO, listExports } from "@/services/exports/exports";
import { VerifyExport } from "./VerifyExport";

/**
 * Exports that can be relied on (document 3, lot 12): each file is read from the database through
 * the reader's own scope, then registered with its fingerprint in the chained ledger before it leaves.
 */
export default async function ExportsPage() {
  const session = await requireSession();
  const [datasets, history] = await Promise.all([Promise.resolve(datasetsFor(session)), listExports(session)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Exports"
        description="Chaque export est lu dans la base, dans votre périmètre, puis enregistré avec son empreinte SHA-256 dans le journal chaîné avant d'être téléchargé. Plus tard, n'importe quel détenteur du fichier peut vérifier ici qu'il n'a pas été modifié : c'est ce qui rend un export opposable."
      />
      <Card>
        <CardHeader>
          <CardTitle>Télécharger</CardTitle>
          <CardDescription>Fichiers CSV (UTF-8), lisibles par un tableur.</CardDescription>
        </CardHeader>
        <CardContent>
          {datasets.length === 0 ? <p className="text-sm text-secondary">Aucun export n&apos;est ouvert à votre rôle.</p> : null}
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {datasets.map((d) => (
              <li key={d}>
                <a href={`/exports/${d}`} className="focus-ring flex h-full items-start gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-background">
                  <FileDown className="mt-0.5 size-5 shrink-0 text-bio-green" aria-hidden="true" />
                  <span className="flex flex-col gap-1">
                    <span className="font-semibold text-text">{EXPORT_DATASET_INFO[d].label}</span>
                    <span className="text-caption text-secondary">{EXPORT_DATASET_INFO[d].description}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Vérifier un fichier</CardTitle>
            <CardDescription>Le fichier reste sur votre appareil : seule son empreinte est envoyée et comparée au registre.</CardDescription>
          </CardHeader>
          <CardContent>
            <VerifyExport />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Registre des exports</CardTitle>
            <CardDescription>Les 100 derniers{history.length && history.some((h) => h.createdBy !== session.userId) ? "" : " que vous avez produits"}.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Export</TableHead>
                  <TableHead>Par</TableHead>
                  <TableHead className="text-right">Lignes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.length === 0 ? <TableEmpty colSpan={3}>Aucun export.</TableEmpty> : null}
                {history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>
                      <p className="font-semibold">{h.label}</p>
                      <p className="text-caption text-secondary">{when(h.createdAt)}</p>
                      <p className="font-mono text-caption text-secondary">{h.sha256.slice(0, 16)}…</p>
                    </TableCell>
                    <TableCell>{h.createdByName}</TableCell>
                    <TableCell className="text-right">{h.rows.toLocaleString("fr-FR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
