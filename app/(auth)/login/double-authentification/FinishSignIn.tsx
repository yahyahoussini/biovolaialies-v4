"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/account/FormAlert";
import { Button } from "@/components/ui/Button";
import { signInStepPath } from "@/lib/sign-in-steps";
import { finishSignInAction } from "../actions";

export function FinishSignIn({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <FormAlert message={error} />
      <Button
        type="button"
        loading={pending}
        onClick={async () => {
          setPending(true);
          const result = await finishSignInAction();
          setPending(false);
          if (!result.ok) return setError(result.error?.message ?? "Connexion impossible.");
          router.push(signInStepPath(result.next ?? "DONE", next));
          router.refresh();
        }}
      >
        Ouvrir BIOVOLAILLES
      </Button>
    </div>
  );
}
