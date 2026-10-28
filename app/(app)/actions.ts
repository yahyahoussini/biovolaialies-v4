"use server";

import { redirect } from "next/navigation";
import type { PublicError } from "@/domain/shared/errors";
import { clientInfo } from "@/lib/client-info";
import { handleActionError } from "@/lib/handle-error";
import { switchToDemoRole } from "@/services/auth/demo-switch";
import { logout } from "@/services/auth/logout";

export async function logoutAction(): Promise<void> {
  await logout(await clientInfo());
  redirect("/login");
}

export interface SwitchDemoRoleResult {
  ok: boolean;
  error?: PublicError;
}

/** Powers the Topbar's demo Role Switcher — real re-authentication, see services/auth/demo-switch.ts. */
export async function switchDemoRoleAction(role: string): Promise<SwitchDemoRoleResult> {
  try {
    const result = await switchToDemoRole(role, await clientInfo());
    if (!result.ok) {
      return { ok: false, error: { kind: "VALIDATION", message: result.error } };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}
