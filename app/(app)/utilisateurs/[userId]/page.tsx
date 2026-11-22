import { notFound } from "next/navigation";
import { PageHeader } from "@/components/domain/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { repositories } from "@/data/repositories";
import { ROLE_LABEL } from "@/lib/labels";
import { requireModuleAccess } from "@/services/auth/guard";
import { securitySummary } from "@/services/identity/account-security";
import { describeScopeTarget } from "@/services/identity/user-management";
import { UserSecurityPanel } from "./UserSecurityPanel";
import { UserEditForm } from "./UserEditForm";

export default async function UserDetailPage({ params }: PageProps<"/utilisateurs/[userId]">) {
  const session = await requireModuleAccess("USERS");
  const { userId } = await params;

  const [user, organizations, cooperatives, producers, farms] = await Promise.all([
    repositories.users.findById(userId),
    repositories.organizations.list(),
    repositories.cooperatives.list(),
    repositories.producers.list(),
    repositories.farms.list(),
  ]);
  if (!user) notFound();

  const scopeLabel = await describeScopeTarget(user.scopeType, user.scopeId);
  const security = securitySummary(user);
  const scopeTargets = {
    ORGANIZATION: organizations.map((o) => ({ id: o.id, label: o.name })),
    COOPERATIVE: cooperatives.map((c) => ({ id: c.id, label: c.name })),
    PRODUCER: producers.map((p) => ({ id: p.id, label: p.name })),
    FARM: farms.map((f) => ({ id: f.id, label: f.name })),
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Administration", href: "/administration" }, { label: "Utilisateurs", href: "/utilisateurs" }, { label: user.fullName }]}
        title={user.fullName}
        description={user.email}
        meta={<Badge tone={user.active ? "success" : "neutral"}>{user.active ? "Actif" : "Désactivé"}</Badge>}
      />

      <Card>
        <CardHeader>
          <CardTitle>Aperçu</CardTitle>
          <CardDescription>Rôle actuel : {ROLE_LABEL[user.role]} — Périmètre : {scopeLabel}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
          <div>
            <p className="text-xs text-secondary">Créé le</p>
            <p className="text-text">{new Date(user.createdAt).toLocaleDateString("fr-FR")}</p>
          </div>
          <div>
            <p className="text-xs text-secondary">Dernière activité</p>
            <p className="text-text">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("fr-FR") : "Jamais connecté"}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sécurité du compte</CardTitle>
          <CardDescription>
            {security.mustChangePassword ? "Mot de passe provisoire, à changer à la prochaine connexion. " : ""}
            Double authentification : {security.mfaEnabled ? `activée (${security.recoveryCodesLeft} code(s) de secours restant(s))` : "non activée"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserSecurityPanel userId={user.id} isSelf={user.id === session.userId} mfaEnabled={security.mfaEnabled} />
        </CardContent>
      </Card>

      <UserEditForm
        userId={user.id}
        currentRole={user.role}
        currentScopeType={user.scopeType}
        currentScopeId={user.scopeId}
        currentActive={user.active}
        isSelf={user.id === session.userId}
        scopeTargets={scopeTargets}
      />
    </div>
  );
}
