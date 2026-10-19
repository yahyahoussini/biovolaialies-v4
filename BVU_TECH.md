# BVU Tech — extension of the BIOVOLAILLES platform

What was added to answer the client's specification (`bvu_tech_site.py`, `BVU_TECH_ARCHITECTURE_MASTER.py`,
`BVU_TECH_MASTER_SOURCE_UNIQUE_V2_3.py`, `BVU_EQUIPEMENTS_PAR_UNITE.xlsx`), and where it lives.

**Status, stated plainly:** a tested software proof of concept on simulated data. No real sensor, PLC,
ERP or label printer is connected; no factory or site acceptance test (FAT/SAT) has been run. The
client's own documents set production go-live at **NO-GO at this stage**, and nothing here changes that.
The `/programme` screen shows, test by test, what is automated, partial, or can only be proven on site.

## Modules

| Module | Route | Spec | Notes |
|---|---|---|---|
| Public B2B site + contact form | `/`, `/mentions-legales`, `/confidentialite` | Flask draft | Same copy and palette as the client's draft. Spam trap, per-IP and per-e-mail limits, consent stored with its wording version. Legal pages mark every company-specific field `[À compléter]`. |
| Prospects | `/prospects` | — | Pipeline status, internal notes, CSV export. Optional e-mail alert (Resend). A demo reset never deletes leads. |
| Hatchery & upstream | `/couvoir` | A03–A07, T31 | Parent flock (genetic origin fixed at creation) → egg lots → incubation cycle (candling, hatch) → chick lots → farm lot. Every egg and chick is accounted for. |
| Quality & recall | `/qualite` | A21–A22, R09–R10, T03–T07 | HOLD on any object, spread to its descendants; every derivation from a held object is refused. Release needs the **Responsable qualité** role, a different person from the opener, a justification and evidence; refusals are logged. Recall report: upstream, downstream, packaged / shipped / on-hand quantities, destinations, CSV. |
| Products & shipments | `/expeditions` | Phase 13 | Stock per packaged product; a held product cannot ship, nor more than remains. |
| Hash-chained ledger | `/journal` | A23–A24, R07–R08, T08 | Every audited mutation is mirrored into an append-only journal where each entry hashes the previous one. Signed anchors, kept outside the platform, expose a full rewrite. |
| API v1 | `/api/v1/*`, `/acces-api` | API-01…API-10 | Bearer keys stored as hashes, per-key scopes, error policy 400/401/403/404/409/413/422/429/5xx, `X-Correlation-ID`, `Idempotency-Key` replay. OpenAPI 3.1 at `/api/v1/openapi.json`. **API-06 (release) is deliberately refused**: a release is a human decision. A key works only while the administrator who issued it still holds that role. Creating calls (API-01, API-05) require `Idempotency-Key`. `GET /api/v1/sites` lists building and sensor ids. |
| Equipment register | `/equipements` | xlsx | The 87 lines of the client's workbook, live summary per unit (same indicators as its "Synthese" sheet), post-audit edits audited, CSV export. |
| Commissioning | `/equipements/recette` | Commissioning table | 20 procedures; a result exists only once recorded with evidence. |
| Programme | `/programme` | Roadmap, gates, risks, R01–R15, T01–T40 | Client's tables plus an honest coverage status for each rule and test. |
| Telemetry | `/telemetrie` | Documents 2 and 3 | See the next section. |

## Telemetry (client documents 2 and 3)

| Piece | Where | What it does |
|---|---|---|
| Sensor catalogue | `domain/telemetry/catalog.ts`, `/telemetrie/catalogue` | The 23 sensors of document 2 (A01–O01): placement, classic error, frequency, the decision each feeds. Physical ranges are marked as an assumption to replace with the model actually bought. |
| Building equipment | `services/telemetry/provisioning.ts` | Equips a building as document 2's reference case: three rearing zones, gateway, sensors at their placement and height, the climate controller read-only; hatchery: independent probes per incubator (top, middle, bottom, return air), egg room, door, GSM alarm. |
| Gateway ingestion | `POST /api/v1/telemetry/gateway`, `services/telemetry/ingest.ts` | One message per 2-minute report, or up to 250 buffered messages at once. A resent message is recognised (gateway + seq + content); a stored reading (channel + instant) is never written twice. Odd readings are kept and flagged (clock, physical range, sensor out of service, calibration overdue, non-physical jump) and kept out of averages and rules. Each message's stored readings are hashed into the chained ledger; `/telemetrie/ingestion` re-checks the hash. Keys can be bound to one gateway. |
| MQTT bridge | `scripts/mqtt-bridge.ts` | Subscribes `bvu/<gateway>/up`, forwards to the API, acknowledges on `bvu/<gateway>/ack` only what the platform accepted — no ack, the gateway keeps the message in its 30-day buffer. Tested against an in-process broker. |
| Occupation table | `/telemetrie/occupation` | Which lot occupied which zone, when. Readings are tied to a lot only through it; one lot per zone at a time; an occupation recorded late re-attributes the readings already received. |
| Retention tiers | `services/telemetry/aggregate.ts` | Raw 90 days, 15-minute buckets 2 years, hourly forever; buckets keep count, sum and sum of squares, so min, max, mean, standard deviation and availability survive the purge. Purges are audited. |
| Rules | `domain/telemetry/rules/*`, `/telemetrie/regles` | 17 data rules + a silence check: learned band by age and season, zone drift, CO₂ × ventilation, NH₃ cumulative exposure, H₂S presence, pressure × command, light programme, run availability, water profile with pressure and water-temperature diagnosis, line imbalance, tank autonomy, silo stock and delivery detection, screw commanded without rotation, weighing uniformity with control-scale bias, incubator probes vs machine, egg-room gap, access out of hours. Only changes of state are written; a backlog is replayed step by step, so alerts carry the instant they would have fired live (tested). Every threshold is editable from the screen and says where its default comes from. |
| Reference bands | `/telemetrie/bandes` | Wide starting bands (to be replaced by the poultry technician's), learned bands proposed from finished lots (5th–95th percentiles, ≥ 3 lots, hours of justified alerts excluded), put in force only by a technician; every version kept. |
| Alerts and escalation | `/alertes/[id]` | Level 1 at once, then up the policy if nobody acknowledges; a level with nobody in scope is recorded and skipped. Closing a sensor alert requires the intervention and whether the alert was right. E-mail through Resend if configured; no SMS/voice provider — each notification says so. |
| Calibration register | `/telemetrie/etalonnage` | Result computed against the tolerance; non-conforming sensor out of service; drift over successive checks flagged. |
| Simulators | `services/telemetry/simulator.ts`, `npm run gateway:simulate` | A gateway, simulated, posting to a running platform over HTTP, with an outage and its catch-up. Every reading it sends is stored as SIMULATION. |
| Scheduled jobs | `GET /api/cron/telemetry` (with `CRON_SECRET`), `npm run telemetry:jobs` | Rules left behind by a backlog, silence check, escalation, retention. |

The public QR passport now also shows the strain and the hatchery's city, and stops reading as
verified while a quality hold applies to the product or its lot.

## Known gaps (also listed on `/programme`)

- No offline mobile app: the server side (idempotent replay) is ready, the client app is not.
- No PLC / Modbus / OPC UA connectors: they depend on the machines actually installed (K01).
- A transformation has a single source; multi-parent products (T34) are not modelled.
- No versioned multi-site template (T35): buildings are equipped from the reference case, not from a versioned configuration.
- Telemetry runs on simulated gateway traffic. No real gateway, PLC or sensor has been connected; the
  incubators' own protocol (Modbus, vendor API or none) is still unknown (document 2, ch. 4 and 7).
- Rule evaluation and the in-memory series cache work per server instance; a multi-instance
  deployment keeps correctness (the watermark only moves forward by compare-and-set) but each
  instance reloads its own cache.
- In the demo snapshot, raw telemetry is kept for 6 hours (production: 90 days); the aggregates cover the whole window.
- Rate limits, and the locks that serialise stock-consuming writes (eggs, chicks, shipments),
  hold per server instance. On a single instance (and on the demo) they are exact; a
  multi-instance deployment should move those balance checks into conditional SQL.
- Business tables (quantities, statuses) are not themselves hashed: the ledger proves the audit
  trail, and `/journal` reconciles the audit trail against it, but a direct database edit of a
  quantity is not detected (T08 partial).
- Strict multi-client (tenant) isolation beyond the organisation scope is not proven (R12, T24).

## Configuration

See `.env.example`: `RESEND_API_KEY`, `LEADS_NOTIFY_TO`, `LEADS_NOTIFY_FROM` (optional lead
e-mails) and `LEDGER_ANCHOR_KEY` (anchor signing; set it in production). On Vercel without a
database, the site runs from the demo snapshot and **contact requests are not kept**: connect a
Turso database for real use (README → "Deploying to Vercel").
