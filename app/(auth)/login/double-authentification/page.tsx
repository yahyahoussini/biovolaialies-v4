import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { MfaSetupPanel } from "@/components/account/MfaSetupPanel";
import { ROLE_LABEL } from "@/lib/labels";
import { safeNextPath } from "@/lib/sign-in-steps";
import { getSignInStage } from "@/services/auth/session";
import { beginMfaEnrollment } from "@/services/identity/account-security";
import { currentSignInPath } from "../current-step";
import { StepCard } from "../StepCard";
import { FinishSignIn } from "./FinishSignIn";

export default async function MfaSetupPage({ searchParams }: PageProps<"/login/double-authentification">) {
  const stage = await getSignInStage();
  const next = safeNextPath((await searchParams).next);
  if (stage?.kind !== "MFA_SETUP") redirect(await currentSignInPath(next));
  if (stage.user.totpEnabledAt) {
    // Confirmed, but the page was reloaded before "Ouvrir BIOVOLAILLES": the codes were shown once.
    return (
      <StepCard title="Double authentification activée" intro="Les codes de secours ont été affichés une seule fois. S'ils n'ont pas été notés, renouvelez-les depuis « Mon compte ».">
        <FinishSignIn next={next} />
      </StepCard>
    );
  }
  const { secret, uri } = await beginMfaEnrollment(stage.user.id);
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 200 });
  return (
    <StepCard
      title="Activez la double authentification"
      intro={`Le rôle ${ROLE_LABEL[stage.user.role]} l'exige : en plus du mot de passe, un code changeant toutes les 30 secondes, affiché par votre téléphone.`}
    >
      <MfaSetupPanel qrDataUrl={qrDataUrl} secret={secret} mode="signin" next={next} />
    </StepCard>
  );
}
