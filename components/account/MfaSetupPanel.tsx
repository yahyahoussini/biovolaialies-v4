"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { confirmMfaSetupAction, finishSignInAction } from "@/app/(auth)/login/actions";
import { confirmOwnMfaAction } from "@/app/(app)/compte/actions";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { signInStepPath } from "@/lib/sign-in-steps";
import { FormAlert } from "./FormAlert";
import { RecoveryCodes } from "./RecoveryCodes";

/**
 * Setting up two-step login: scan the QR code (or type the key), prove it with a first code, then
 * keep the recovery codes. Used during a sign-in that requires it, and from "Mon compte".
 */
export function MfaSetupPanel({ qrDataUrl, secret, mode, next, onCodes }: { qrDataUrl: string; secret: string; mode: "signin" | "account"; next: string; onCodes?: (codes: string[]) => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = mode === "signin" ? await confirmMfaSetupAction(code) : await confirmOwnMfaAction(code);
    setPending(false);
    if (!result.ok || !result.recoveryCodes) {
      setError(result.error?.message ?? "Activation impossible.");
      return;
    }
    if (onCodes) onCodes(result.recoveryCodes);
    else setCodes(result.recoveryCodes);
  }

  if (codes) {
    return (
      <div className="flex flex-col gap-3">
        <RecoveryCodes
          codes={codes}
          doneLabel={mode === "signin" ? "Ouvrir BIOVOLAILLES" : "Terminer"}
          onDone={async () => {
            if (mode === "account") {
              setCodes(null);
              router.refresh();
              return;
            }
            const finished = await finishSignInAction();
            if (!finished.ok) return setError(finished.error?.message ?? "Connexion impossible.");
            router.push(signInStepPath(finished.next ?? "DONE", next));
            router.refresh();
          }}
        />
        <FormAlert message={error} />
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-text">
        <li>Installez une application d&apos;authentification sur votre téléphone (Google Authenticator, Microsoft Authenticator…).</li>
        <li>Dans l&apos;application, ajoutez un compte en scannant ce code.</li>
        <li>Saisissez le code à 6 chiffres qu&apos;elle affiche.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL generated on the server, nothing to optimise */}
      <img src={qrDataUrl} alt="Code QR à scanner avec l'application d'authentification" width={200} height={200} className="self-center rounded-md border border-border bg-white p-2" />
      <p className="text-xs text-secondary">
        Sans appareil photo, saisissez cette clé dans l&apos;application : <span className="break-all font-mono text-text">{secret.match(/.{1,4}/g)?.join(" ")}</span>
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mfa-code">Code à 6 chiffres</Label>
        <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      <FormAlert message={error} />
      <Button type="submit" loading={pending}>
        Activer la double authentification
      </Button>
    </form>
  );
}
