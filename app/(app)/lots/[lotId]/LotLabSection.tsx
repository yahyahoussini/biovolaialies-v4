import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { RESULT_INTERPRETATION_LABEL, SAMPLE_MATRIX_LABEL, SAMPLE_REASON_LABEL, SAMPLE_STATUS_LABEL } from "@/domain/lab/lab";
import { day } from "@/lib/flow-labels";
import { INTERPRETATION_TONE, SAMPLE_STATUS_TONE } from "@/lib/lab-labels";
import type { Session } from "@/services/auth/session";
import { labRecordForLot } from "@/services/lab/lab";

/** The lot's laboratory record: samples taken on the lot, its eggs, or the parent flock it carries. Hidden when there are none. */
export async function LotLabSection({ lotId, session }: { lotId: string; session: Session }) {
  const samples = await labRecordForLot(lotId, session);
  if (samples.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Laboratoire</CardTitle>
        <CardDescription>Prélèvements sur ce lot et ses œufs, avec les résultats tels que rendus.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Prélèvement</TableHead>
              <TableHead>Nature et motif</TableHead>
              <TableHead>Résultats</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {samples.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link href={`/laboratoire/${s.id}`} className="font-semibold text-deep-green underline-offset-2 hover:underline">
                    {s.code}
                  </Link>
                  <p className="text-caption text-secondary">{day(s.sampledAt)}</p>
                </TableCell>
                <TableCell>
                  {SAMPLE_MATRIX_LABEL[s.matrix]}
                  <p className="text-caption text-secondary">{SAMPLE_REASON_LABEL[s.reason]}</p>
                </TableCell>
                <TableCell>
                  {s.results.length === 0 ? <Badge tone={SAMPLE_STATUS_TONE[s.status]}>{SAMPLE_STATUS_LABEL[s.status]}</Badge> : null}
                  <ul className="flex flex-col gap-1">
                    {s.results.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-1.5 text-caption">
                        <span>
                          {r.analyte} : {r.value}
                        </span>
                        <Badge tone={INTERPRETATION_TONE[r.interpretation]}>{RESULT_INTERPRETATION_LABEL[r.interpretation]}</Badge>
                      </li>
                    ))}
                  </ul>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
