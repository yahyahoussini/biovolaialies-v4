import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

/**
 * `npm run setup -- --email <address> --name "<Nom Prénom>"` — a real installation, from an empty
 * database: every migration, then the first administrator, and nothing else (no demo data). Prints
 * a temporary password once; the administrator replaces it, and sets up two-step login, at the first
 * sign-in. Refuses a database that already has accounts, and one holding the demonstration dataset.
 */

function argument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const email = argument("email")?.trim().toLowerCase() ?? "";
  const fullName = argument("name")?.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || fullName.length < 2) {
    throw new Error('Usage : npm run setup -- --email admin@exemple.ma --name "Nom Prénom"');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL n'est pas défini : indiquez la base de l'installation.");
  const authToken = process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN;

  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const client = createClient({ url, authToken });
  const host = url.startsWith("file:") ? url : url.replace(/^\w+:\/\//, "").split("/")[0];
  console.log(`\nBase : ${host}`);
  console.log("Migrations…");
  await migrate(drizzle(client), { migrationsFolder: "./data/db/migrations" });
  client.close();

  // Imported only now: these read DATABASE_URL and validate the environment at load time.
  const { repositories } = await import("../data/repositories");
  const { DEMO_ACCOUNT_EMAIL } = await import("../data/seed/generators/hierarchy");
  const existing = await repositories.users.list();
  if (existing.some((u) => Object.values(DEMO_ACCOUNT_EMAIL).includes(u.email))) {
    throw new Error("Cette base contient la démonstration : une installation réelle part d'une base vide (autre fichier ou autre volume).");
  }
  if (existing.length > 0) {
    throw new Error(`Cette base est déjà installée (${existing.length} compte(s)). Les comptes suivants se créent dans l'application, menu Utilisateurs.`);
  }

  const { randomBytes } = await import("node:crypto");
  const { generateTemporaryPassword } = await import("../domain/identity/password-policy");
  const { hashPassword } = await import("../lib/password");
  const { recordAudit } = await import("../services/audit/record");
  const temporaryPassword = generateTemporaryPassword((n) => randomBytes(n));
  const admin = await repositories.users.create({
    email,
    passwordHash: hashPassword(temporaryPassword),
    fullName,
    role: "SUPER_ADMIN",
    scopeType: "GLOBAL",
    scopeId: null,
    active: true,
    mustChangePassword: true,
  });
  await recordAudit({
    actorId: admin.id,
    entityType: "user",
    entityId: admin.id,
    field: null,
    oldValue: null,
    newValue: `${admin.email} (SUPER_ADMIN)`,
    reason: "Installation : premier administrateur (npm run setup)",
    relatedLotId: null,
    relatedEventId: null,
  });

  console.log("\nInstallation prête.\n");
  console.log(`  Administrateur : ${admin.email}`);
  console.log(`  Mot de passe provisoire (affiché une seule fois) : ${temporaryPassword}\n`);
  console.log("À la première connexion : choisir un mot de passe, puis activer la double authentification");
  console.log("(application Google Authenticator ou Microsoft Authenticator sur le téléphone).");
  console.log("Ensuite : Structure des élevages (/structure) pour les fermes et bâtiments, Utilisateurs pour les comptes.\n");
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
