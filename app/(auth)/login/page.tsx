import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/sign-in-steps";
import { getCurrentSession } from "@/services/auth/session";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await getCurrentSession();
  const params = await searchParams;
  const next = safeNextPath(params.next);

  if (session) {
    redirect(next);
  }

  return <LoginForm next={next} />;
}
