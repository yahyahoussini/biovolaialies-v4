"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MfaSetupPanel } from "@/components/account/MfaSetupPanel";
import { RecoveryCodes } from "@/components/account/RecoveryCodes";
import { DisableMfaForm, RegenerateCodesForm } from "./AccountForms";

/**
 * The whole two-step login section of "Mon compte", one component: when enabling it, the action
 * changes the session cookie and Next.js re-renders the page with "enabled" — this component stays
 * mounted, so the recovery codes it holds stay on screen until they are kept.
 */
export function MfaCard({
  enabled,
  required,
  codesLeft,
  setup,
}: {
  enabled: boolean;
  required: boolean;
  codesLeft: number;
  setup: { qrDataUrl: string; secret: string } | null;
}) {
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);

  if (codes) {
    return (
      <RecoveryCodes
        codes={codes}
        doneLabel="Terminer"
        onDone={() => {
          setCodes(null);
          router.replace("/compte");
          router.refresh();
        }}
      />
    );
  }
  if (enabled) {
    return (
      <div className="flex flex-col gap-6">
        <p className="text-sm text-text">
          Codes de secours restants : <strong>{codesLeft}</strong> sur 10.
          {codesLeft <= 3 ? " Renouvelez-les avant d'en manquer." : ""}
        </p>
        <RegenerateCodesForm />
        {required ? null : <DisableMfaForm />}
      </div>
    );
  }
  if (setup) {
    return (
      <div className="max-w-md">
        <MfaSetupPanel qrDataUrl={setup.qrDataUrl} secret={setup.secret} mode="account" next="/compte" onCodes={setCodes} />
      </div>
    );
  }
  return (
    <Link href="/compte?activer=1" className="self-start rounded-md bg-bio-green px-4 py-2 text-sm font-medium text-white hover:bg-deep-green">
      Activer la double authentification
    </Link>
  );
}
