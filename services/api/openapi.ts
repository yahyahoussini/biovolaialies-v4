import { API_SCOPE, DATA_STATUS, QUALITY_REASON } from "../../domain/shared/enums";
import { ENTITY_TYPE } from "../../domain/traceability/entity-types";
import { API_VERSION } from "./http";

const error = { $ref: "#/components/schemas/Error" };
const errors = (codes: number[]) =>
  Object.fromEntries(
    codes.map((c) => [
      String(c),
      {
        description: {
          400: "Payload invalide ou champ obligatoire absent — ne pas réessayer sans correction",
          401: "Clé absente ou invalide",
          403: "Droit (scope) non accordé",
          404: "Objet introuvable ou non visible",
          409: "Conflit : doublon non idempotent ou version concurrente",
          413: "Corps trop volumineux",
          422: "Données valides syntaxiquement mais incohérentes métier",
          429: "Quota dépassé — respecter Retry-After",
          500: "Erreur interne — réessai borné avec backoff",
        }[c],
        content: { "application/json": { schema: error } },
      },
    ])
  );

const objectRef = {
  objectType: { type: "string", enum: [...ENTITY_TYPE] },
  objectId: { type: "string" },
  objectCode: { type: "string", description: "Alternative à objectId : code métier." },
};

/** OpenAPI 3.1 contract for /api/v1 — the client's API-01…API-10, as implemented. */
export function buildOpenApiDocument(serverUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "BVU Tech — API de traçabilité",
      version: API_VERSION,
      description:
        "Contrats API-01 à API-10 du dossier BVU Tech. Authentification par clé Bearer émise dans l'application (Gouvernance → Accès API). " +
        "Chaque réponse porte un en-tête X-Correlation-ID. Quota : 120 requêtes/minute/client (par instance serveur). " +
        "La levée d'un blocage qualité (API-06) est volontairement réservée à une décision humaine dans l'application.",
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: `Clé « bvu_… ». Droits possibles : ${API_SCOPE.join(", ")}.` } },
      schemas: {
        Error: {
          type: "object",
          required: ["error", "correlationId"],
          properties: {
            error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, details: {} } },
            correlationId: { type: "string" },
          },
        },
        Event: {
          type: "object",
          required: ["eventType", "objectType", "occurredAt"],
          properties: {
            eventType: { type: "string", pattern: "^[A-Z0-9_:.-]+$", examples: ["EGG_MOVEMENT_EVENT"] },
            ...objectRef,
            occurredAt: { type: "string", format: "date-time", description: "Heure métier (source) ; l'heure de réception est ajoutée par la plateforme (R13)." },
            payload: { type: "object", additionalProperties: true },
            idempotencyKey: { type: "string", minLength: 8, description: "Clé de rejeu hors ligne (R08). Aussi acceptée en en-tête Idempotency-Key." },
            schemaVersion: { type: "integer", default: 1 },
            correctsEventId: { type: "string", description: "Correction : nouvel événement lié, jamais d'écrasement (R07)." },
          },
        },
      },
    },
    paths: {
      "/lots": {
        post: {
          operationId: "createLot",
          summary: "API-01 — Créer un lot (œufs, poussins ou élevage)",
          "x-scope": "lots:write",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { type: "object", required: ["lotType", "code", "parentFlockCode", "collectedAt", "quantity"], properties: { lotType: { const: "EGG_LOT" }, code: { type: "string" }, parentFlockCode: { type: "string" }, collectedAt: { type: "string", format: "date-time" }, quantity: { type: "integer" }, dataStatus: { enum: [...DATA_STATUS] } } },
                    { type: "object", required: ["lotType", "code", "hatchCycleCode", "quantity", "dispatchedAt"], properties: { lotType: { const: "CHICK_LOT" }, code: { type: "string" }, hatchCycleCode: { type: "string" }, quantity: { type: "integer" }, grade: { enum: ["A", "B"] }, dispatchedAt: { type: "string", format: "date-time" } } },
                    { type: "object", required: ["lotType", "code", "buildingId", "species", "breed", "initialPopulation"], properties: { lotType: { const: "LOT" }, code: { type: "string" }, buildingId: { type: "string" }, species: { type: "string" }, breed: { type: "string" }, initialPopulation: { type: "integer" } } },
                  ],
                },
              },
            },
          },
          responses: { "201": { description: "Lot créé : { lotType, lotId, code }" }, ...errors([400, 401, 403, 409, 422, 429, 500]) },
        },
      },
      "/lots/{id}": {
        get: {
          operationId: "getObject",
          summary: "API-02 — Identité, statut qualité et résumé de lignée",
          "x-scope": "lots:read",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Identifiant, ou code si `type` est fourni." },
            { name: "type", in: "query", schema: { type: "string", enum: [...ENTITY_TYPE] } },
          ],
          responses: { "200": { description: "Objet" }, ...errors([400, 401, 403, 404, 429, 500]) },
        },
      },
      "/lots/{id}/lineage": {
        get: {
          operationId: "getLineage",
          summary: "API-04 — Ascendants / descendants, troncature explicite",
          "x-scope": "lineage:read",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "type", in: "query", schema: { type: "string", enum: [...ENTITY_TYPE] } },
            { name: "direction", in: "query", schema: { type: "string", enum: ["up", "down", "both"], default: "both" } },
          ],
          responses: { "200": { description: "Lignée { ancestors, descendants, destinations, truncated, computedAt }" }, ...errors([400, 401, 403, 404, 429, 500]) },
        },
      },
      "/events": {
        post: {
          operationId: "appendEvent",
          summary: "API-03 — Événement de traçabilité en ajout seul (journal chaîné)",
          "x-scope": "events:write",
          parameters: [{ name: "Idempotency-Key", in: "header", schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Event" } } } },
          responses: { "201": { description: "Accepté : { eventId, seq, hash, duplicate:false }" }, "200": { description: "Rejeu idempotent : événement original, duplicate:true" }, ...errors([400, 401, 403, 404, 409, 422, 429, 500]) },
        },
      },
      "/integration/ingest": {
        post: {
          operationId: "ingest",
          summary: "API-08 — Lot d'enregistrements normalisés (ERP/MES/WMS/Edge), résultat par enregistrement",
          "x-scope": "ingest:write",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["sourceSystem", "schemaVersion", "batchId", "records"], properties: { sourceSystem: { type: "string" }, schemaVersion: { type: "integer" }, batchId: { type: "string" }, records: { type: "array", maxItems: 500, items: { $ref: "#/components/schemas/Event" } } } } } },
          },
          responses: { "207": { description: "Résultat par enregistrement { accepted, duplicates, rejected, results[] }" }, "422": { description: "Tous les enregistrements rejetés", content: { "application/json": { schema: error } } }, ...errors([400, 401, 403, 429, 500]) },
        },
      },
      "/quality/holds": {
        post: {
          operationId: "openHold",
          summary: "API-05 — Placer un objet en HOLD (propagé aux descendants par défaut)",
          "x-scope": "quality:hold",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["objectType", "reason", "description"], properties: { ...objectRef, reason: { type: "string", enum: [...QUALITY_REASON] }, description: { type: "string", minLength: 10 }, scope: { type: "string", enum: ["OBJET_SEUL", "DESCENDANTS"] }, evidenceRefs: { type: "array", items: { type: "string" } } } } } },
          },
          responses: { "201": { description: "{ caseId, code, holdStatus, affectedObjects }" }, ...errors([400, 401, 403, 404, 422, 429, 500]) },
        },
      },
      "/quality/releases": {
        post: { operationId: "releaseHold", summary: "API-06 — Non disponible par API : décision humaine requise (R10)", responses: errors([401, 403]) },
      },
      "/measurements": {
        post: {
          operationId: "recordMeasurement",
          summary: "API-07 — Mesure capteur avec provenance et contrôle qualité",
          "x-scope": "measurements:write",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["sensorId", "value", "capturedAt"], properties: { sensorId: { type: "string" }, value: { type: "number" }, capturedAt: { type: "string", format: "date-time" }, lotId: { type: "string" }, dataStatus: { enum: [...DATA_STATUS] } } } } } },
          responses: { "201": { description: "{ measurementId, accepted, quality }" }, ...errors([400, 401, 403, 404, 422, 429, 500]) },
        },
      },
      "/exports/recall/{caseId}": {
        get: {
          operationId: "exportRecall",
          summary: "API-10 — Périmètre de rappel d'un dossier qualité",
          "x-scope": "recall:export",
          parameters: [
            { name: "caseId", in: "path", required: true, schema: { type: "string" } },
            { name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"] } },
          ],
          responses: { "200": { description: "Rapport : amont, aval, produits, expéditions, totaux, limites" }, ...errors([401, 403, 404, 429, 500]) },
        },
      },
      "/health/ready": {
        get: { operationId: "ready", summary: "API-09 — Disponibilité (sans authentification, sans donnée métier)", security: [], responses: { "200": { description: "Prêt" }, "503": { description: "Dégradé" } } },
      },
    },
  };
}
