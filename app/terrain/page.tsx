import { redirect } from "next/navigation";
import { repositories } from "@/data/repositories";
import { getCurrentSession } from "@/services/auth/session";
import { FieldApp } from "./FieldApp";

/**
 * Entry of the field app. Rendered once with network, then served by the phone's worker: from
 * there everything the person sees comes from what the phone holds (lib/field).
 */
export default async function FieldPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login?next=/terrain");
  const user = await repositories.users.findById(session.userId);
  return <FieldApp userId={session.userId} userName={user?.fullName ?? "—"} />;
}
