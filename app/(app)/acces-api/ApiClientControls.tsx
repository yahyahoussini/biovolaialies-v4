"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";
import { API_SCOPE } from "@/domain/shared/enums";
import { createApiClientAction, revokeApiClientAction } from "./actions";

const SCOPE_LABEL: Record<(typeof API_SCOPE)[number], string> = {
  "lots:read": "Lire les objets (API-02)",
  "lots:write": "Créer des lots (API-01)",
  "events:write": "Écrire des événements (API-03)",
  "lineage:read": "Lire la lignée (API-04)",
  "quality:hold": "Ouvrir un blocage (API-05)",
  "measurements:write": "Envoyer des mesures (API-07)",
  "ingest:write": "Ingestion par lots (API-08)",
  "recall:export": "Exporter un rappel (API-10)",
  "telemetry:write": "Passerelle de terrain : mesures et événements",
  "marking:write": "Ligne de marquage des œufs : codes, lectures, plateaux",
};

export function CreateApiClientDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(form: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createApiClientAction(String(form.get("name")), form.getAll("scopes").map(String));
      if (!result.ok) {
        setError(result.error?.message ?? "Création impossible.");
        return;
      }
      setKey(result.key!);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setKey(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <KeyRound className="size-4" aria-hidden="true" />
          Nouvel accès API
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{key ? "Clé générée" : "Nouvel accès API"}</DialogTitle>
          <DialogDescription>
            {key
              ? "Copiez cette clé maintenant : elle ne sera plus jamais affichée (seule son empreinte est conservée)."
              : "Un accès par système (passerelle, ERP, laboratoire), avec les seuls droits dont il a besoin."}
          </DialogDescription>
        </DialogHeader>
        {key ? (
          <div className="flex flex-col gap-3">
            <code className="break-all rounded-md bg-background p-3 text-xs">{key}</code>
            <Button onClick={() => navigator.clipboard?.writeText(key)}>Copier</Button>
          </div>
        ) : (
          <form onSubmit={(event) => {
            // Not `action={…}`: React 19 resets a form after an action runs, which would wipe
            // everything typed whenever the server rejects the submission.
            event.preventDefault();
            submit(new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter));
          }} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Nom du système</Label>
              <Input id="name" name="name" required minLength={3} placeholder="Passerelle couvoir COUV-01" />
            </div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-medium">Droits</legend>
              {API_SCOPE.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="scopes" value={s} className="size-4 accent-bio-green" />
                  <span>{SCOPE_LABEL[s]}</span>
                  <code className="text-xs text-secondary">{s}</code>
                </label>
              ))}
            </fieldset>
            {error ? (
              <p role="alert" className="rounded-md bg-critical/10 px-3 py-2 text-xs text-critical-strong">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                {pending ? "Création…" : "Générer la clé"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RevokeButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Révoquer cet accès ? Les appels avec cette clé seront refusés immédiatement.")) return;
        startTransition(async () => {
          await revokeApiClientAction(clientId);
          router.refresh();
        });
      }}
    >
      Révoquer
    </Button>
  );
}
