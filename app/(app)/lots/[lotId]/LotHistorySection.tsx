import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { can } from "@/domain/shared/permissions";
import { when } from "@/lib/flow-labels";
import { auditEntityTypeLabel } from "@/lib/labels";
import { lotChangeHistory } from "@/services/audit/queries";
import type { Session } from "@/services/auth/session";

const SHOWN = 25;

/** The lot's change history: each modification with its author, its time, the value before and after, and the reason given. */
export async function LotHistorySection({ lotId, session }: { lotId: string; session: Session }) {
  const changes = await lotChangeHistory(lotId, session);
  if (changes.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historique des modifications</CardTitle>
        <CardDescription>Qui a modifié quoi, quand, la valeur avant et après, et pourquoi. Rien n&apos;y est jamais effacé.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Enregistré le</TableHead>
              <TableHead>Qui</TableHead>
              <TableHead>Quoi</TableHead>
              <TableHead>Avant → après</TableHead>
              <TableHead>Motif</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changes.slice(0, SHOWN).map((c) => (
              <TableRow key={c.id}>
                <TableCell className="whitespace-nowrap">{when(c.createdAt)}</TableCell>
                <TableCell>{c.actorName}</TableCell>
                <TableCell>
                  {auditEntityTypeLabel(c.entityType)}
                  {c.field ? <p className="text-caption text-secondary">{c.field}</p> : null}
                </TableCell>
                <TableCell className="max-w-md">
                  {c.oldValue !== null ? (
                    <>
                      <span className="text-secondary line-through decoration-secondary/60">{c.oldValue}</span> → <span className="font-medium">{c.newValue ?? "—"}</span>
                    </>
                  ) : (
                    <span>{c.newValue ?? "—"}</span>
                  )}
                </TableCell>
                <TableCell className="max-w-xs text-caption text-secondary">{c.reason ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {changes.length > SHOWN ? (
          can(session, "VIEW", "AUDIT") ? (
            <Link href={`/audit?relatedLotId=${lotId}`} className="text-sm font-semibold text-deep-green underline-offset-2 hover:underline">
              Voir les {changes.length} modifications dans le journal d&apos;audit
            </Link>
          ) : (
            <p className="text-caption text-secondary">Les {SHOWN} plus récentes sur {changes.length}.</p>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
