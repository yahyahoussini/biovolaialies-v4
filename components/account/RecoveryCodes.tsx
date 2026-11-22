"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

/** Shown once, right after they are issued: the server keeps only their hashes. */
export function RecoveryCodes({ codes, onDone, doneLabel }: { codes: string[]; onDone: () => void; doneLabel: string }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  function download() {
    const body = `Codes de secours BIOVOLAILLES\nChacun remplace une seule fois le code du téléphone.\n\n${text}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "biovolailles-codes-de-secours.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text">
        Gardez ces dix codes en lieu sûr (papier, coffre de mots de passe). Si vous perdez votre téléphone, chacun permet une seule
        connexion. Ils ne seront plus affichés.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-md border border-border bg-background p-3 font-mono text-sm text-text">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}
        >
          {copied ? "Copiés" : "Copier"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={download}>
          Télécharger (.txt)
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm text-text">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        J&apos;ai mis ces codes en lieu sûr
      </label>
      <Button type="button" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}
