import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/domain/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { ROLE_LABEL } from "@/lib/labels";
import { getCurrentSession } from "@/services/auth/session";
import { accountOverview, beginMfaEnrollment } from "@/services/identity/account-security";
import { ChangePasswordForm } from "./AccountForms";
import { MfaCard } from "./MfaCard";

/** Every signed-in user's own account: password and two-step login. */
export default async function AccountPage({ searchParams }: PageProps<"/compte">) {
  const session = await getCurrentSession();
  if (!session) redirect("/login?next=/compte");
  const account = await accountOverview(session);
  const enrolling = (await searchParams).activer === "1" && !account.mfaEnabled;
  const setup = enrolling ? await beginMfaEnrollment(session.userId) : null;
  const qrDataUrl = setup ? await QRCode.toDataURL(setup.uri, { margin: 1, width: 200 }) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Mon compte" description={`${account.fullName} — ${account.email} — ${ROLE_LABEL[account.role]}`} />

      <Card>
        <CardHeader>
          <CardTitle>Mot de passe</CardTitle>
          <CardDescription>
            {account.passwordChangedAt
              ? `Changé le ${new Date(account.passwordChangedAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "short", timeStyle: "short" })}.`
              : "Jamais changé depuis la création du compte."}{" "}
            Le changer ferme vos sessions ouvertes sur d&apos;autres appareils.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Double authentification
            <Badge tone={account.mfaEnabled ? "success" : account.mfaRequired ? "critical" : "neutral"}>{account.mfaEnabled ? "Activée" : "Désactivée"}</Badge>
          </CardTitle>
          <CardDescription>
            Un code à 6 chiffres, affiché par une application du téléphone, demandé après le mot de passe.
            {account.mfaRequired ? " Obligatoire pour votre rôle." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <MfaCard
            enabled={account.mfaEnabled}
            required={account.mfaRequired}
            codesLeft={account.recoveryCodesLeft}
            setup={setup && qrDataUrl ? { qrDataUrl, secret: setup.secret } : null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
