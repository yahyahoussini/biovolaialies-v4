"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/account/FormAlert";
import { Button } from "@/components/ui/Button";
import { resetMfaAction, resetPasswordAction } from "../actions";

/** Password and two-step login resets for someone else's account. Their own goes through "Mon compte". */
export function UserSecurityPanel({ userId, isSelf, mfaEnabled }: { userId: string; isSelf: boolean; mfaEnabled: boolean }) {
  const router = useRouter();
  const [temporary, setTemporary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"password" | "mfa" | null>(null);

  if (isSelf) {
    return <p className="text-sm text-secondary">Pour votre propre compte, passez par « Mon compte ».</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {temporary ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text">Mot de passe provisoire, affiché une seule fois — la personne le remplacera à sa prochaine connexion :</p>
          <p className="rounded-md border border-border bg-background p-3 text-center font-mono text-lg text-text">{temporary}</p>
        </div>
      ) : null}
      <FormAlert message={error} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          loading={pending === "password"}
          onClick={async () => {
            if (!window.confirm("Réinitialiser le mot de passe ? Ses sessions ouvertes seront fermées.")) return;
            setPending("password");
            setError(null);
            const result = await resetPasswordAction(userId);
            setPending(null);
            if (!result.ok) return setError(result.error?.message ?? "Réinitialisation impossible.");
            setTemporary(result.data!.temporaryPassword);
            router.refresh();
          }}
        >
          Réinitialiser le mot de passe
        </Button>
        {mfaEnabled ? (
          <Button
            type="button"
            variant="destructive"
            loading={pending === "mfa"}
            onClick={async () => {
              if (!window.confirm("Retirer sa double authentification (téléphone perdu) ? Elle sera redemandée à sa prochaine connexion si son rôle l'exige.")) return;
              setPending("mfa");
              setError(null);
              const result = await resetMfaAction(userId);
              setPending(null);
              if (!result.ok) return setError(result.error?.message ?? "Réinitialisation impossible.");
              router.refresh();
            }}
          >
            Réinitialiser la double authentification
          </Button>
        ) : null}
      </div>
    </div>
  );
}
