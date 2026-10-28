import { getCurrentSession } from "@/services/auth/session";
import { getRoleFocus } from "@/services/dashboard/role-focus";
import { getDashboardOverview } from "@/services/dashboard/overview";
import { DashboardClient } from "./DashboardClient";
import { RoleFocusView } from "./RoleFocusView";

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  const [overview, focus] = await Promise.all([getDashboardOverview(session), getRoleFocus(session)]);
  return <DashboardClient overview={overview} lead={<RoleFocusView focus={focus} />} />;
}
