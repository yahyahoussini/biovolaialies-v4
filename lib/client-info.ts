import { headers } from "next/headers";
import type { ClientInfo } from "@/services/auth/journal";

/**
 * Who is calling, as far as the request says. `x-real-ip` is set by the hosting platform (Vercel)
 * and cannot be forged by the caller; failing that, the LAST X-Forwarded-For hop is the one our own
 * proxy appended. The first hop is never used — the client writes it.
 */
export async function clientInfo(): Promise<ClientInfo> {
  const h = await headers();
  const realIp = h.get("x-real-ip")?.trim();
  const ip = realIp || (h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean).at(-1) ?? null);
  return { ip, userAgent: h.get("user-agent") };
}

/** A rate-limit key for the caller: its address, or a shared bucket when none is known. */
export async function clientKey(): Promise<string> {
  return (await clientInfo()).ip ?? "inconnu";
}
