import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/sign-in-steps";
import { getSignInStage } from "@/services/auth/session";
import { currentSignInPath } from "../current-step";
import { StepCard } from "../StepCard";
import { SecondFactorForm } from "./SecondFactorForm";

export default async function SecondFactorPage({ searchParams }: PageProps<"/login/verification">) {
  const stage = await getSignInStage();
  const next = safeNextPath((await searchParams).next);
  if (stage?.kind !== "SECOND_FACTOR") redirect(await currentSignInPath(next));
  return (
    <StepCard title="Double authentification" intro="Saisissez le code à 6 chiffres affiché par votre application d'authentification.">
      <SecondFactorForm next={next} />
    </StepCard>
  );
}
