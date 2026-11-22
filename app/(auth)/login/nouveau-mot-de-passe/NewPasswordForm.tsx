"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/account/FormAlert";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { PASSWORD_MIN_LENGTH } from "@/domain/identity/password-policy";
import { signInStepPath } from "@/lib/sign-in-steps";
import { setNewPasswordAction } from "../actions";

export function NewPasswordForm({ next }: { next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH) return setError(`${PASSWORD_MIN_LENGTH} caractères minimum.`);
    if (password !== confirm) return setError("Les deux saisies ne sont pas identiques.");
    setPending(true);
    setError(null);
    const result = await setNewPasswordAction(password);
    setPending(false);
    if (!result.ok) {
      setError(result.error?.message ?? "Mot de passe refusé.");
      if (result.error?.message?.startsWith("Étape expirée")) router.push("/login");
      return;
    }
    router.push(signInStepPath(result.next ?? "DONE", next));
    router.refresh();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">Nouveau mot de passe</Label>
        <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="text-micro text-secondary">{PASSWORD_MIN_LENGTH} caractères minimum. Une phrase courte est plus sûre et plus facile à retenir qu&apos;un mot compliqué.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm-password">Confirmer</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <FormAlert message={error} />
      <Button type="submit" loading={pending}>
        Enregistrer et continuer
      </Button>
    </form>
  );
}
