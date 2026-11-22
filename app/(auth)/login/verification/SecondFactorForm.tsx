"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/account/FormAlert";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { signInStepPath } from "@/lib/sign-in-steps";
import { verifyCodeAction } from "../actions";

export function SecondFactorForm({ next }: { next: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await verifyCodeAction(code);
    setPending(false);
    if (!result.ok) {
      setError(result.error?.message ?? "Code refusé.");
      if (result.error?.message?.startsWith("Étape expirée")) router.push("/login");
      return;
    }
    router.push(signInStepPath(result.next ?? "DONE", next));
    router.refresh();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="code">Code</Label>
        <Input id="code" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
        <p className="text-micro text-secondary">Téléphone perdu ? Saisissez l&apos;un de vos codes de secours (XXXXX-XXXXX).</p>
      </div>
      <FormAlert message={error} />
      <Button type="submit" loading={pending}>
        Valider
      </Button>
    </form>
  );
}
