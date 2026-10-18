"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Input";
import { verifyAnchorAction } from "./actions";

export function AnchorVerifier() {
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="anchor">Coller une ancre précédemment téléchargée</Label>
      <textarea
        id="anchor"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={5}
        className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs"
        placeholder='{ "version": 1, "headSeq": …, "headHash": "…", "issuedAt": "…", "signature": "…" }'
      />
      <div>
        <Button size="sm" disabled={pending || raw.trim() === ""} onClick={() => startTransition(async () => setResult(await verifyAnchorAction(raw)))}>
          {pending ? "Vérification…" : "Vérifier contre l'ancre"}
        </Button>
      </div>
      {result ? (
        <p role="status" className={`rounded-md px-3 py-2 text-sm ${result.ok ? "bg-success/10 text-success-strong" : "bg-critical/10 text-critical-strong"}`}>
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
