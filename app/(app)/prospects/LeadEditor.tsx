"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/Dialog";
import { Label } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { LEAD_STATUS } from "@/domain/shared/enums";
import type { Lead } from "@/domain/leads/types";
import { LEAD_STATUS_LABEL } from "@/lib/lead-labels";
import { updateLeadAction } from "./actions";

export function LeadEditor({ lead, activityLabel }: { lead: Lead; activityLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string>(lead.status);
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateLeadAction(lead.id, status, notes);
      if (!result.ok) {
        setError(result.error?.message ?? "Enregistrement impossible.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          Ouvrir
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{lead.company}</DialogTitle>
          <DialogDescription>
            {activityLabel} · reçue le {new Date(lead.createdAt).toLocaleString("fr-FR")}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-secondary">Contact</dt>
          <dd>{lead.contactName}</dd>
          <dt className="text-secondary">E-mail</dt>
          <dd>
            <a className="text-bio-green underline" href={`mailto:${lead.email}`}>
              {lead.email}
            </a>
          </dd>
          <dt className="text-secondary">Téléphone</dt>
          <dd>{lead.phone ?? "—"}</dd>
          <dt className="text-secondary">Capacité</dt>
          <dd>{lead.capacity ?? "—"}</dd>
        </dl>
        <div className="rounded-md bg-background p-3 text-sm whitespace-pre-wrap">{lead.need}</div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`status-${lead.id}`}>Statut</Label>
          <Select id={`status-${lead.id}`} value={status} onChange={(e) => setStatus(e.target.value)}>
            {LEAD_STATUS.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`notes-${lead.id}`}>Notes internes</Label>
          <textarea
            id={`notes-${lead.id}`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            rows={4}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
          />
        </div>
        {error ? (
          <p role="alert" className="rounded-md bg-critical/10 px-3 py-2 text-xs text-critical-strong">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
