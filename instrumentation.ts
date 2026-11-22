import type { Instrumentation } from "next";

/**
 * Server errors, reported where an operator looks: one JSON line on the server's output
 * (`docker compose logs app`), and — when ERRORS_NOTIFY_TO and the e-mail provider are set — an
 * e-mail, at most one per kind of error every 30 minutes. Only the route, the method, the path
 * without its query string and the message leave the server: no body, cookie or header.
 */
const lastSent = new Map<string, number>();
const THROTTLE_MS = 30 * 60_000;

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const err = (typeof error === "object" && error !== null ? error : {}) as { message?: string; digest?: string };
  const message = (err.message ?? String(error)).slice(0, 500);
  const entry = {
    level: "error",
    at: new Date().toISOString(),
    digest: err.digest ?? null,
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    kind: context.routeType,
    message,
  };
  console.error(JSON.stringify(entry));

  const to = (process.env.ERRORS_NOTIFY_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (to.length === 0) return;
  const key = `${context.routePath}|${message.slice(0, 120)}`;
  const now = Date.now();
  if ((lastSent.get(key) ?? 0) > now - THROTTLE_MS) return;
  lastSent.set(key, now);
  const { sendEmailTo } = await import("./services/notify/email");
  await sendEmailTo(to, {
    subject: `BIOVOLAILLES — erreur serveur (${context.routePath})`,
    text: [
      `Une erreur serveur s'est produite le ${entry.at}.`,
      "",
      `Route : ${entry.route} (${entry.kind})`,
      `Requête : ${entry.method} ${entry.path}`,
      `Référence : ${entry.digest ?? "—"}`,
      `Message : ${message}`,
      "",
      "Les occurrences suivantes de la même erreur ne sont pas renvoyées avant 30 minutes ; elles restent dans les journaux du serveur (docker compose logs app).",
    ].join("\n"),
  });
};
