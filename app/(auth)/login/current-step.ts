import { signInStepPath } from "@/lib/sign-in-steps";
import { getCurrentSession, getSignInStage } from "@/services/auth/session";

/**
 * Where a sign-in stands now: the page of its current step, the page asked for once complete, or the
 * sign-in form. A step page reached at the wrong moment — typically re-rendered by Next.js after an
 * action changed the session cookie — sends the visitor here rather than back to the start.
 */
export async function currentSignInPath(next: string): Promise<string> {
  const stage = await getSignInStage();
  if (stage) return signInStepPath(stage.kind, next);
  return (await getCurrentSession()) ? next : "/login";
}
