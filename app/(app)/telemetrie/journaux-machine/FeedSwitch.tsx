"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { setMachineFeedAction } from "../actions";

/** Switches how the machine is read: by the gateway over Modbus, or from its exported log. */
export function FeedSwitch({ zoneId, feed }: { zoneId: string; feed: "PASSERELLE" | "FICHIER" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const next = feed === "PASSERELLE" ? "FICHIER" : "PASSERELLE";
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="secondary"
        size="sm"
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await setMachineFeedAction({ zoneId, feed: next });
            if (result.ok) router.refresh();
            else setError(result.error?.message ?? "Changement refusé.");
          })
        }
      >
        {next === "FICHIER" ? "Passer en lecture par fichier" : "Faire lire par la passerelle"}
      </Button>
      {error ? <p className="text-caption text-critical-strong">{error}</p> : null}
    </div>
  );
}
