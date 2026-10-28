import { FormDialog } from "@/components/domain/FormDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import type { Session } from "@/services/auth/session";
import { getCycleMarking } from "@/services/marking/marking";
import { candlingRejectsAction } from "../../../marquage/actions";

const n = (v: number) => v.toLocaleString("fr-FR");

/**
 * Route A of the marking line (document 3): hatching eggs marked at collection, so the eggs removed
 * at candling are named by their code and traced to their parent flock, and the time each egg spent
 * in the egg room is known rather than guessed. Shown only when a loaded egg lot was marked.
 */
export async function CycleMarkingSection({ cycleId, cycleCode, session }: { cycleId: string; cycleCode: string; session: Session }) {
  const marking = await getCycleMarking(cycleId, session);
  if (!marking) return null;
  const unidentified = marking.clearsRemoved === null ? null : Math.max(0, marking.clearsRemoved - marking.identified);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Œufs marqués au ramassage</CardTitle>
          <CardDescription>
            Rebuts du mirage identifiés par leur code et rattachés à leur troupeau ; durée de stockage connue œuf par œuf.
            {unidentified !== null ? ` ${n(marking.identified)} rebuts identifiés sur ${n(marking.clearsRemoved ?? 0)} clairs retirés${unidentified > 0 ? ` — ${n(unidentified)} sans code lisible` : ""}.` : ""}
          </CardDescription>
        </div>
        {marking.canRecord ? (
          <FormDialog
            title="Rebuts du mirage"
            description="Scannez ou tapez le code de chaque œuf retiré, un par ligne. Un code inconnu, mal lu ou d'un autre cycle refuse toute la saisie, avec la liste à corriger ; un code déjà saisi ne compte qu'une fois."
            triggerLabel="Saisir les rebuts"
            action={candlingRejectsAction}
            fields={[
              { name: "cycleId", label: "Cycle", type: "select", defaultValue: cycleId, options: [{ value: cycleId, label: cycleCode }] },
              { name: "codes", label: "Codes des œufs retirés", type: "textarea", required: true },
            ]}
          />
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-overline">Rebuts par troupeau parent</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Troupeau</TableHead>
                <TableHead>Lot d&apos;œufs</TableHead>
                <TableHead className="text-right">Rebuts identifiés</TableHead>
                <TableHead className="text-right">Part</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {marking.rejectsByFlock.length === 0 ? <TableEmpty colSpan={4}>Aucun lot marqué.</TableEmpty> : null}
              {marking.rejectsByFlock.map((r) => (
                <TableRow key={r.eggLotCode}>
                  <TableCell>{r.flockCode}</TableCell>
                  <TableCell>{r.eggLotCode}</TableCell>
                  <TableCell className="text-right">{n(r.identified)}</TableCell>
                  <TableCell className="text-right">{r.loaded ? `${((r.identified / r.loaded) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-overline">Durée en salle d&apos;œufs avant incubation</h3>
          {marking.storageRange ? (
            <p className="text-sm text-secondary">
              {marking.storageRange.min === marking.storageRange.max
                ? `${n(marking.storageRange.min)} jour${marking.storageRange.min > 1 ? "s" : ""} pour chacun des œufs marqués des lots chargés.`
                : `De ${n(marking.storageRange.min)} à ${n(marking.storageRange.max)} jours, ${marking.storageRange.mean.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} en moyenne, sur les œufs marqués des lots chargés.`}
            </p>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Jours de stockage</TableHead>
                <TableHead className="text-right">Œufs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {marking.storage.length === 0 ? <TableEmpty colSpan={2}>Aucun œuf relu.</TableEmpty> : null}
              {marking.storage.map((d) => (
                <TableRow key={d.days}>
                  <TableCell>{d.days}</TableCell>
                  <TableCell className="text-right">{n(d.eggs)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
