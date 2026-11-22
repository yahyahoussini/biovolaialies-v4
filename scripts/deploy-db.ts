import { config } from "dotenv";

// Read local env files first so a developer can run this with only the two Turso values
// exported in the shell; shell variables always win (dotenv never overrides what is already set).
config({ path: ".env.local" });
config({ path: ".env" });

/**
 * One command that takes an empty hosted libSQL/Turso database to a fully seeded one:
 * applies every migration, then loads the demo dataset. Run it once after creating the
 * database — `npm run db:deploy`.
 *
 * It exists because the alternative is a two-step dance (`db:migrate` then `db:seed`) with a
 * drizzle-kit dialect that has to be selected off the URL, and because getting it wrong is
 * silent: point it at the wrong DATABASE_URL and you seed your laptop instead of the database
 * the deployment reads. So this refuses to run against a local file database, and prints the
 * host it is about to write to before touching anything.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set.\n\n" +
        "Set it to the hosted database you want to seed, e.g.\n" +
        '  PowerShell: $env:DATABASE_URL="libsql://<db>-<org>.turso.io"; $env:DATABASE_AUTH_TOKEN="<token>"\n' +
        '  bash:       export DATABASE_URL="libsql://<db>-<org>.turso.io" DATABASE_AUTH_TOKEN="<token>"'
    );
  }

  if (url.startsWith("file:")) {
    throw new Error(
      `db:deploy targets a hosted database, but DATABASE_URL is a local file (${url}).\n\n` +
        "Use `npm run db:migrate && npm run db:seed` for the local database.\n" +
        "For the hosted one, set DATABASE_URL in your shell — a value in .env.local cannot\n" +
        "override a shell variable, but it does override nothing, so the shell is the only\n" +
        "reliable way to point this at Turso."
    );
  }

  if (!authToken) {
    throw new Error("DATABASE_AUTH_TOKEN is not set — a hosted libSQL database requires an auth token.");
  }

  // Imported lazily, and only after the guards above: these modules validate the environment and
  // open a connection at import time, so a static import would connect before we had checked
  // where we were about to write.
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const { migrate } = await import("drizzle-orm/libsql/migrator");

  const host = url.replace(/^\w+:\/\//, "").split("/")[0];
  console.log(`\nTarget database: ${host}\n`);

  const client = createClient({ url, authToken });
  const db = drizzle(client);

  console.log("Applying migrations…");
  await migrate(db, { migrationsFolder: "./data/db/migrations" });
  console.log("Migrations applied.");

  // Imported only now: this pulls in data/db/client.ts, whose module-scope singleton reads
  // DATABASE_URL — by this point it resolves to the same hosted database checked above.
  if (!process.argv.includes("--demo")) {
    console.log("\nMigrations only. A real installation continues with « npm run setup -- --email … --name … »;");
    console.log("a demonstration database with « npm run db:deploy -- --demo ».\n");
    client.close();
    return;
  }

  const { repositories } = await import("../data/repositories");
  const existing = await repositories.organizations.list();
  if (existing.length > 0) {
    console.log("\nDatabase already contains data — skipping the seed.");
    console.log("Drop and recreate the database if you want to start over.\n");
    client.close();
    return;
  }

  console.log("\nSeeding the demo dataset (~1,100 rows over the network — this takes a minute)…\n");
  const { seedDatabase, HERO_LOT_CODE } = await import("../data/seed/seed-database");
  const result = await seedDatabase();

  const { publicPassportUrl } = await import("../lib/public-url");
  console.log("\nDone. The deployment now has data.\n");
  console.log(`Hero lot: ${HERO_LOT_CODE}`);
  console.log(`Anomalies raised: ${result.anomalyCount}`);
  console.log("\nPublic QR passports:\n");
  console.log(`  lot      ${publicPassportUrl(result.lotTokenValue)}`);
  console.log(`  product  ${publicPassportUrl(result.productTokenValue)}`);
  console.log("\nDemo sign-in addresses (shared password is in DEMO_RUNBOOK.md §1):\n");
  for (const spec of result.userSpecs) {
    console.log(`  ${spec.role.padEnd(13)} ${spec.email}`);
  }
  console.log("");

  client.close();
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
