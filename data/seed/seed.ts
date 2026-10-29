import { dbClient } from "../db/client";
import { repositories } from "../repositories";
import { logger } from "../../lib/logger";
import { publicPassportUrl } from "../../lib/public-url";
import { DEMO_ACCOUNT_EMAIL } from "./generators/hierarchy";
import { HERO_LOT_CODE, seedDatabase, VERIFIED_LOT_CODE } from "./seed-database";

/** CLI wrapper around seedDatabase() — the dataset itself lives there so the in-app demo reset produces exactly the same scenario. */
async function main() {
  const existing = await repositories.organizations.list();
  if (existing.length > 0) {
    logger.info("seed", "Database already contains data — skipping. Run `npm run db:reset` to start fresh.");
    return;
  }

  const result = await seedDatabase();

  // The shared password is deliberately NOT printed here: this output is frequently on screen
  // while a presenter sets up in front of an audience. The credential lives in DEMO_RUNBOOK.md.
  console.log("\nDemo accounts (all share one password — see DEMO_RUNBOOK.md §1):\n");
  // Every role's account, including those created with their part of the scenario (hatchery, laboratory).
  for (const [role, email] of Object.entries(DEMO_ACCOUNT_EMAIL)) {
    console.log(`  ${role.padEnd(16)} ${email}`);
  }
  console.log(`\nHero lot: ${HERO_LOT_CODE} (Ferme Al Baraka — BAT-01)\n`);
  console.log("Public QR passports:\n");
  console.log(`  lot      ${publicPassportUrl(result.lotTokenValue)}`);
  console.log(`  product  ${publicPassportUrl(result.productTokenValue)}`);
  console.log(`\nValidated passport — reads "Traçabilité vérifiée" (${VERIFIED_LOT_CODE}):\n`);
  console.log(`  product  ${publicPassportUrl(result.verifiedProductTokenValue)}\n`);
}

main()
  .catch((error) => {
    logger.error("seed", "Seed failed", error);
    process.exitCode = 1;
  })
  .finally(() => {
    dbClient.close();
  });
