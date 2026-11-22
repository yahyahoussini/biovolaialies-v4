import { config } from "dotenv";

// dotenv/config only reads .env by default — this project keeps secrets in .env.local.
// `.env` is read as a fallback so the one-off "seed the hosted database" step can supply
// DATABASE_URL/DATABASE_AUTH_TOKEN without disturbing a developer's local .env.local.
config({ path: ".env.local" });
config({ path: ".env" });

// Dynamic import: static `import` declarations are hoisted above this file's own code
// by the bundler tsx uses, which would run seed.ts's eager env validation (lib/env.ts,
// pulled in via data/db/client.ts) before the config() call above had a chance to run.
// A dynamic import() is a runtime expression, not a hoisted declaration, so it genuinely
// runs after config() here.
// The demonstration dataset (shared public password, fictitious farms) never goes into a real
// installation by accident: in production it needs demo mode, or an explicit --allow-demo.
if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "true" && !process.argv.includes("--allow-demo")) {
  console.error("\nRefusé : base de production sans DEMO_MODE=true. Une installation réelle commence par « npm run setup ».\n");
  process.exit(1);
}

void import("./seed");
