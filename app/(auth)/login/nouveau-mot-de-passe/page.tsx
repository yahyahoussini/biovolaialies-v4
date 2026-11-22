import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/sign-in-steps";
import { getSignInStage } from "@/services/auth/session";
import { currentSignInPath } from "../current-step";
import { StepCard } from "../StepCard";
import { NewPasswordForm } from "./NewPasswordForm";

export default async function NewPasswordPage({ searchParams }: PageProps<"/login/nouveau-mot-de-passe">) {
  const stage = await getSignInStage();
  const next = safeNextPath((await searchParams).next);
  if (stage?.kind !== "PASSWORD_CHANGE") redirect(await currentSignInPath(next));
  return (
    <StepCard title="Choisissez votre mot de passe" intro="Le mot de passe actuel a été donné par un administrateur : remplacez-le par le vôtre, que vous seul connaîtrez.">
      <NewPasswordForm next={next} />
    </StepCard>
  );
}
