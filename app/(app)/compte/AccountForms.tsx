"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/account/FormAlert";
import { RecoveryCodes } from "@/components/account/RecoveryCodes";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { PASSWORD_MIN_LENGTH } from "@/domain/identity/password-policy";
import { changePasswordAction, disableMfaAction, regenerateCodesAction } from "./actions";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "error" | "success" } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (next.length < PASSWORD_MIN_LENGTH) return setMessage({ text: `${PASSWORD_MIN_LENGTH} caractères minimum.`, tone: "error" });
    if (next !== confirm) return setMessage({ text: "Les deux saisies ne sont pas identiques.", tone: "error" });
    setPending(true);
    const result = await changePasswordAction(current, next);
    setPending(false);
    if (!result.ok) return setMessage({ text: result.error?.message ?? "Changement impossible.", tone: "error" });
    setCurrent("");
    setNext("");
    setConfirm("");
    setMessage({ text: "Mot de passe changé. Vos autres sessions ont été fermées.", tone: "success" });
  }

  return (
    <form className="flex max-w-sm flex-col gap-3" onSubmit={submit} noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="current-password">Mot de passe actuel</Label>
        <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="next-password">Nouveau mot de passe</Label>
        <Input id="next-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm-next-password">Confirmer</Label>
        <Input id="confirm-next-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <FormAlert message={message?.text ?? null} tone={message?.tone} />
      <Button type="submit" loading={pending} className="self-start">
        Changer le mot de passe
      </Button>
    </form>
  );
}

/** Asks for the password before a two-step login change: a session left open is not enough. */
function PasswordGate({ label, destructive, onConfirm }: { label: string; destructive?: boolean; onConfirm: (password: string) => Promise<string | null> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="flex max-w-sm flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(await onConfirm(password));
        setPending(false);
      }}
      noValidate
    >
      <Label htmlFor={`gate-${label}`}>Mot de passe</Label>
      <Input id={`gate-${label}`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <FormAlert message={error} />
      <Button type="submit" variant={destructive ? "destructive" : "secondary"} loading={pending} className="self-start">
        {label}
      </Button>
    </form>
  );
}

export function RegenerateCodesForm() {
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);
  if (codes) return <RecoveryCodes codes={codes} doneLabel="Terminer" onDone={() => { setCodes(null); router.refresh(); }} />;
  return (
    <PasswordGate
      label="Renouveler les codes de secours"
      onConfirm={async (password) => {
        const result = await regenerateCodesAction(password);
        if (!result.ok || !result.recoveryCodes) return result.error?.message ?? "Renouvellement impossible.";
        setCodes(result.recoveryCodes);
        return null;
      }}
    />
  );
}

export function DisableMfaForm() {
  const router = useRouter();
  return (
    <PasswordGate
      label="Désactiver la double authentification"
      destructive
      onConfirm={async (password) => {
        const result = await disableMfaAction(password);
        if (!result.ok) return result.error?.message ?? "Désactivation impossible.";
        router.refresh();
        return null;
      }}
    />
  );
}
