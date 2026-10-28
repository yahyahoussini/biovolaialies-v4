"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { simulateAction } from "./actions";

/** Demonstration: plays the line controller for a few hundred eggs, cleanly or with a clogging head. */
export function SimulateButtons({ runId }: { runId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const play = (preset: "NORMAL" | "ENCRASSEE") =>
    startTransition(async () => {
      setError(null);
      const result = await simulateAction(runId, preset);
      if (!result.ok) setError(result.error?.message ?? "Simulation impossible.");
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => play("NORMAL")}>
        Simuler 600 œufs
      </Button>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => play("ENCRASSEE")}>
        Simuler une tête encrassée
      </Button>
      {error ? <p className="w-full text-sm text-critical-strong">{error}</p> : null}
    </div>
  );
}
