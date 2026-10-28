import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import { createTestSession } from "../production/test-support";
import { clientHash, listAuthEvents, recordAuthEvent, signInRefusal } from "./journal";

const at = (minutes: number) => new Date(Date.parse("2026-10-28T09:00:00.000Z") + minutes * 60_000);

describe("authentication journal", () => {
  it("refuses an account after five failures in fifteen minutes, and lets it try again afterwards", async () => {
    const client = { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (Android 14) Chrome/130" };
    for (let i = 0; i < 4; i++) await recordAuthEvent({ email: "Rachid@Ferme.ma ", userId: null, outcome: "ECHEC", client }, at(i));
    expect(await signInRefusal("rachid@ferme.ma", client, at(5))).toBeNull();
    await recordAuthEvent({ email: "rachid@ferme.ma", userId: null, outcome: "ECHEC", client }, at(5));
    expect(await signInRefusal("RACHID@ferme.ma", { ip: "198.51.100.1", userAgent: null }, at(6))).toMatch(/ce compte/);
    // Fifteen minutes after the first failures, the oldest ones no longer count.
    expect(await signInRefusal("rachid@ferme.ma", client, at(19))).toBeNull();
  });

  it("refuses a device that tries many accounts, and never stores its address", async () => {
    const client = { ip: "192.0.2.44", userAgent: null };
    for (let i = 0; i < 20; i++) await recordAuthEvent({ email: `essai${i}@exemple.ma`, userId: null, outcome: "ECHEC", client }, at(i * 0.5));
    expect(await signInRefusal("autre@exemple.ma", client, at(11))).toMatch(/cet appareil/);
    expect(await signInRefusal("autre@exemple.ma", { ip: "192.0.2.45", userAgent: null }, at(11))).toBeNull();
    const [event] = await repositories.authEvents.list({ email: "essai0@exemple.ma" }, 1);
    expect(event.clientHash).toBe(clientHash("192.0.2.44"));
    expect(JSON.stringify(event)).not.toContain("192.0.2.44");
  });

  it("is read by administration and audit only", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "journal-admin");
    const auditor = await createTestSession("AUDITOR", "GLOBAL", null, "journal-auditor");
    const farmer = await createTestSession("PRODUCER", "PRODUCER", null, "journal-farmer");
    await recordAuthEvent({ email: "journal-admin@test.local", userId: admin.userId, outcome: "SUCCES" });
    expect((await listAuthEvents(admin, { outcome: "SUCCES" })).some((e) => e.userName === "Test User journal-admin")).toBe(true);
    await expect(listAuthEvents(auditor)).resolves.toBeInstanceOf(Array);
    await expect(listAuthEvents(farmer)).rejects.toThrow(/réservé/);
  });
});
