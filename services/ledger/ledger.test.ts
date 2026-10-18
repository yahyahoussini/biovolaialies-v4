import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../data/db/client";
import { ledgerEvents } from "../../data/db/schema";
import { createTestSession } from "../production/test-support";
import { appendLedgerEvent, issueLedgerAnchor, verifyAgainstAnchor, verifyLedger } from "./ledger";

const base = {
  eventType: "TEST_EVENT",
  objectType: "LOT",
  objectId: "lot-ledger",
  actorKind: "SYSTEM" as const,
  actorId: null,
  source: "test",
  occurredAt: "2026-10-01T08:00:00.000Z",
};

describe("ledger", () => {
  it("chains appends, survives concurrent writers and replays idempotently (R08, T10)", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "ledger-1");
    await Promise.all(Array.from({ length: 8 }, (_, i) => appendLedgerEvent({ ...base, payload: { i } })));

    const first = await appendLedgerEvent({ ...base, payload: { qty: 10 }, idempotencyKey: "terminal-7:42" });
    const replay = await appendLedgerEvent({ ...base, payload: { qty: 10 }, idempotencyKey: "terminal-7:42" });
    expect(replay.duplicate).toBe(true);
    expect(replay.event.id).toBe(first.event.id);
    await expect(appendLedgerEvent({ ...base, payload: { qty: 11 }, idempotencyKey: "terminal-7:42" })).rejects.toThrow(/déjà été utilisée/);

    const result = await verifyLedger(admin);
    expect(result.ok).toBe(true);
  });

  it("detects a row edited directly in the database (T08), and an anchor exposes the rewrite", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "ledger-2");
    const { event } = await appendLedgerEvent({ ...base, payload: { qty: 500 } });
    const anchor = await issueLedgerAnchor(admin);
    expect((await verifyAgainstAnchor(admin, anchor)).ok).toBe(true);

    await db.update(ledgerEvents).set({ payload: { qty: 50 } }).where(eq(ledgerEvents.id, event.id));
    const result = await verifyLedger(admin);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(event.seq);
    expect((await verifyAgainstAnchor(admin, anchor)).ok).toBe(false);
    await expect(issueLedgerAnchor(admin)).rejects.toThrow(/non intègre/);

    // Restore so later tests in this file see a sound chain.
    await db.update(ledgerEvents).set({ payload: { qty: 500 } }).where(eq(ledgerEvents.id, event.id));
    expect((await verifyLedger(admin)).ok).toBe(true);
  });

  it("rejects a forged anchor and a role without integrity access", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "ledger-3");
    const anchor = await issueLedgerAnchor(admin);
    const forged = await verifyAgainstAnchor(admin, { ...anchor, headSeq: anchor.headSeq + 1 });
    expect(forged.ok).toBe(false);
    const tech = await createTestSession("TECHNICIAN", "FARM", "x", "ledger-4");
    await expect(verifyLedger(tech)).rejects.toThrow();
  });
});
