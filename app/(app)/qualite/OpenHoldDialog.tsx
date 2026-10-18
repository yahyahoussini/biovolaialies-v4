"use client";

import { ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { QUALITY_HOLD_SCOPE, QUALITY_REASON } from "@/domain/shared/enums";
import { ENTITY_TYPE_LABEL } from "@/lib/labels";
import { QUALITY_REASON_LABEL, QUALITY_SCOPE_LABEL } from "@/lib/quality-labels";
import { openHoldAction } from "./actions";

const HOLDABLE = ["PARENT_FLOCK", "EGG_LOT", "HATCH_CYCLE", "CHICK_LOT", "LOT", "COLLECTION", "SLAUGHTER_BATCH", "TRANSFORMATION_BATCH", "PRODUCT", "SHIPMENT"] as const;

export function OpenHoldDialog({ defaultType = "LOT", defaultCode = "", triggerLabel = "Ouvrir un blocage" }: { defaultType?: string; defaultCode?: string; triggerLabel?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(form: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await openHoldAction({
        rootType: String(form.get("rootType")),
        code: String(form.get("code")),
        reason: String(form.get("reason")),
        description: String(form.get("description")),
        scope: String(form.get("scope")),
        evidence: String(form.get("evidence")),
      });
      if (!result.ok) {
        setError(result.error?.message ?? "Ouverture impossible.");
        return;
      }
      setOpen(false);
      router.push(`/qualite/${result.data!.caseId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive">
          <ShieldAlert className="size-4" aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ouvrir un blocage qualité</DialogTitle>
          <DialogDescription>
            Le blocage interdit toute opération en aval de l&apos;objet (et de ses dérivés si choisi) jusqu&apos;à décision d&apos;un
            responsable qualité.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => {
            // Not `action={…}`: React 19 resets a form after an action runs, which would wipe
            // everything typed whenever the server rejects the submission.
            event.preventDefault();
            submit(new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter));
          }} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rootType">Type d&apos;objet</Label>
              <Select id="rootType" name="rootType" defaultValue={defaultType}>
                {HOLDABLE.map((t) => (
                  <option key={t} value={t}>
                    {ENTITY_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="code">Code</Label>
              <Input id="code" name="code" required defaultValue={defaultCode} placeholder="BU-2026-001" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reason">Motif</Label>
              <Select id="reason" name="reason" defaultValue="SUSPICION_SANITAIRE">
                {QUALITY_REASON.map((r) => (
                  <option key={r} value={r}>
                    {QUALITY_REASON_LABEL[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scope">Portée</Label>
              <Select id="scope" name="scope" defaultValue="DESCENDANTS">
                {QUALITY_HOLD_SCOPE.map((s) => (
                  <option key={s} value={s}>
                    {QUALITY_SCOPE_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Description de la cause</Label>
            <textarea id="description" name="description" required minLength={10} rows={3} className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="evidence">Preuves (références séparées par « ; », facultatif)</Label>
            <Input id="evidence" name="evidence" placeholder="LAB-2026-044; photo-3" />
          </div>
          {error ? (
            <p role="alert" className="rounded-md bg-critical/10 px-3 py-2 text-xs text-critical-strong">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Ouverture…" : "Bloquer"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
