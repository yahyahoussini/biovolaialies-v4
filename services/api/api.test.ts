import { beforeEach, describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import { resetRateLimits } from "../../lib/rate-limit";
import { createLot } from "../production/lot";
import { createTestSession } from "../production/test-support";
import { authenticateApiKey, createApiClient, revokeApiClient } from "./clients";
import { apiRoute, json, readBody } from "./http";
import { apiAppendEvent, apiGetObject, apiIngest, apiOpenHold, eventBodySchema } from "./operations";

async function fixture(suffix: string) {
  const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, `api-${suffix}`);
  const org = await repositories.organizations.create({ name: `Org ${suffix}`, type: "INTERNAL" });
  const coop = await repositories.cooperatives.create({ organizationId: org.id, name: `Coop ${suffix}`, region: "R" });
  const producer = await repositories.producers.create({ cooperativeId: coop.id, name: `P ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: producer.id, name: `F ${suffix}`, city: "Fès", region: "R", geoLat: null, geoLng: null });
  const building = await repositories.buildings.create({ farmId: farm.id, code: `B-${suffix}`, name: "B", capacity: 5000, zoneType: "ELEVAGE" });
  const lot = await createLot({ code: `API-${suffix}`, buildingId: building.id, species: "Poulet", breed: "Ross 308", initialPopulation: 1000, plannedStartAt: null, dataStatus: "SIMULATION" }, admin);
  return { admin, lot };
}

function request(key: string | null, body?: unknown, headers: Record<string, string> = {}) {
  return new Request("http://test.local/api/v1/x", {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("API keys", () => {
  it("authenticates a valid key, refuses a revoked one, and stores only a hash", async () => {
    const { admin } = await fixture("k1");
    const { client, key } = await createApiClient({ name: "Passerelle couvoir", scopes: ["events:write"] }, admin);
    expect(client.keyHash).not.toContain(key);
    expect((await authenticateApiKey(`Bearer ${key}`))?.clientId).toBe(client.id);
    expect(await authenticateApiKey("Bearer bvu_wrong")).toBeNull();
    await revokeApiClient(client.id, admin);
    expect(await authenticateApiKey(`Bearer ${key}`)).toBeNull();
  });

  it("only lets an administrator issue keys", async () => {
    const tech = await createTestSession("TECHNICIAN", "GLOBAL", null, "api-k2");
    await expect(createApiClient({ name: "x-client", scopes: ["lots:read"] }, tech)).rejects.toThrow();
  });
});

describe("API error policy (apiRoute)", () => {
  beforeEach(() => resetRateLimits());

  const echo = apiRoute("events:write", async ({ request, correlationId }) => {
    const body = await readBody(request, eventBodySchema);
    return json({ eventType: body.eventType }, 201, correlationId);
  });

  it("answers 401 / 403 / 400 / 201 and always sets a correlation id", async () => {
    const { admin } = await fixture("e1");
    const { key: readKey } = await createApiClient({ name: "lecture", scopes: ["lots:read"] }, admin);
    const { key } = await createApiClient({ name: "écriture", scopes: ["events:write"] }, admin);

    const noKey = await echo(request(null, {}));
    expect(noKey.status).toBe(401);
    expect(noKey.headers.get("x-correlation-id")).toBeTruthy();
    expect((await echo(request(readKey, {}))).status).toBe(403);
    expect((await echo(request(key, "{not json"))).status).toBe(400);
    expect((await echo(request(key, { eventType: "lowercase" }))).status).toBe(400);
    const ok = await echo(request(key, { eventType: "EGG_MOVEMENT_EVENT", objectType: "LOT", occurredAt: "2026-10-01T10:00:00Z" }, { "x-correlation-id": "trace-123456" }));
    expect(ok.status).toBe(201);
    expect(ok.headers.get("x-correlation-id")).toBe("trace-123456");
  });

  it("answers 429 with Retry-After past the quota", async () => {
    const { admin } = await fixture("e2");
    const { key } = await createApiClient({ name: "rafale", scopes: ["events:write"] }, admin);
    let last: Response | null = null;
    for (let i = 0; i < 121; i++) last = await echo(request(key, { eventType: "X1", objectType: "LOT", occurredAt: "2026-10-01T10:00:00Z" }));
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("API operations", () => {
  it("replays an offline event without duplicating it, and rejects a conflicting replay (T10, T11)", async () => {
    const { admin, lot } = await fixture("o1");
    const { client } = await createApiClient({ name: "terminal-12", scopes: ["events:write"] }, admin);
    const principal = { clientId: client.id, name: client.name, scopes: ["events:write" as const] };
    const body = { eventType: "PESEE_TERRAIN", objectType: "LOT", objectCode: lot.code, occurredAt: "2026-10-01T10:00:00Z", payload: { kg: 1.9 }, idempotencyKey: "t12-000042", schemaVersion: 1 };

    const first = await apiAppendEvent(body, principal);
    const replay = await apiAppendEvent(body, principal);
    expect(replay).toMatchObject({ eventId: first.eventId, duplicate: true });
    await expect(apiAppendEvent({ ...body, payload: { kg: 2.4 } }, principal)).rejects.toThrow(/déjà été utilisée/);
    await expect(apiAppendEvent({ ...body, idempotencyKey: "t12-000043", occurredAt: "2999-01-01T00:00:00Z" }, principal)).rejects.toThrow(/futur/);
  });

  it("ingests a batch with per-record results", async () => {
    const { admin, lot } = await fixture("o2");
    const { client } = await createApiClient({ name: "erp", scopes: ["ingest:write"] }, admin);
    const principal = { clientId: client.id, name: client.name, scopes: ["ingest:write" as const] };
    const record = { eventType: "RECEPTION_VIF", objectType: "LOT", objectId: lot.id, occurredAt: "2026-10-02T06:00:00Z", idempotencyKey: "erp-batch7-1" };
    const result = await apiIngest(
      { sourceSystem: "ERP-X", schemaVersion: 1, batchId: "batch-7", records: [record, record, { eventType: "BAD" }, { ...record, idempotencyKey: "erp-batch7-2", objectId: "missing" }] },
      principal
    );
    expect(result).toMatchObject({ accepted: 1, duplicates: 1, rejected: 2 });
  });

  it("opens a hold through the API and reports it on the object", async () => {
    const { admin, lot } = await fixture("o3");
    const { client } = await createApiClient({ name: "labo", scopes: ["quality:hold", "lots:read"] }, admin);
    const principal = { clientId: client.id, name: client.name, scopes: ["quality:hold" as const] };
    const hold = await apiOpenHold({ objectType: "LOT", objectCode: lot.code, reason: "RESULTAT_LABORATOIRE", description: "Résultat positif transmis par le LIMS", scope: "DESCENDANTS", evidenceRefs: ["LIMS-881"] }, admin, principal);
    expect(hold.holdStatus).toBe("EN_BLOCAGE");
    const object = await apiGetObject(lot.code, "LOT");
    expect(object.qualityStatus).toMatchObject({ onHold: true, cases: [hold.code] });
  });
});
