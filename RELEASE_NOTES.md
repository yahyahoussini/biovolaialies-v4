# BIOVOLAILLES — Release Notes (MVP Release Candidate)

**Version:** MVP RC (2026-08-18), since extended to the fifteen development lots of document 3 ·
**Last verified:** 2026-10-29 (§9) · **Status:** ready for external demonstration

BIOVOLAILLES is a functional Agritech MVP: a digital operating, intelligence and traceability
platform for poultry production. It is not a dashboard bolted onto a spreadsheet, and it is
not an AI product — it is one coherent system carrying a flock from the building it lives in
to the QR code a consumer scans.

Every figure in this document was measured against a production build of this codebase. Where
something is simulated or absent, this document says so plainly.

---

## 1. What the MVP includes

| Capability | State |
|---|---|
| Authentication (encrypted cookie sessions) | Implemented |
| 10 roles (incl. the six views of document 3: direction, production, hatchery, veterinarian, farmer, technician) + hierarchical data scoping, enforced server-side | Implemented |
| Organization → cooperative → producer → farm → building → lot | Implemented |
| Structured production data (feed, water, weight, mortality, environment) | Implemented |
| Data-status vocabulary on every value (Real / Simulation / Calculated / Estimated / To confirm / Validated / Missing) | Implemented |
| Provenance on every measurement (source, actor, device, timestamp, method, formula) | Implemented |
| IoT devices, sensors, measurement history | Implemented — **simulated source** |
| KPI engine with explicit eligibility (refuses to compute what it cannot justify) | Implemented |
| Performance trends | Implemented |
| Rule-based anomaly detection with an 8-question explanation | Implemented |
| Alert lifecycle → human acknowledgement → action record → lot event | Implemented |
| Lot-centric traceability graph (upstream / lot / downstream) | Implemented |
| Product lineage: collection → slaughter → transformation → product → destination | Implemented |
| Public QR traceability passport with a single curated boundary | Implemented |
| Audit log of every mutation (actor, before/after, reason) | Implemented |
| Integrity engine — 761 automated checks of 19 types (T01–T27) | Implemented |
| Demo reset + system health screen | Implemented |
| French UI throughout, WCAG AA contrast, keyboard navigable | Implemented |

**Scale of the seeded dataset (2026-10-29):** 1 organization · 3 cooperatives · 7 producers ·
11 farms · 18 buildings · 28 lots · 15 users (10 role accounts, 5 partner farmers) · 13 269 raw
sensor readings (525 on the hero building) and 25 317 aggregates · 16 anomalies, 16 alerts ·
2 products · 3 active public QR passports · 2 751 hash-chained ledger events · 106 purchasing
articles.

## 2. What is simulated

- **All IoT measurements.** Produced by a deterministic simulator (seeded hash noise, never
  `Math.random`). No physical sensor exists. The label "Simulation" is visible in the UI
  wherever such a value is shown.
- **All production data.** The 12 lots, their histories, and the anomalies are demonstration
  content, not records of a real farm. They are, however, **calibrated against the Ross 308
  breed standard** — body-weight curve (42 g at hatch, 943 g at day 21, 2 283 g at day 35),
  feed-intake curve, feed conversion between 1.4 and 2.1 across lots, 70% carcass yield and
  90% deboning yield, with exact mass balance at every processing step. Simulated is not the
  same as invented: a poultry engineer can check these numbers against the breed tables.
- **The downstream chain.** Collection, slaughter, transformation, product and destination
  records are seeded demonstration data.
- **The gateway telemetry, the egg-marking line and the incubator logs.** The farm and hatchery
  gateways, the marking line controller and the exported incubator logs are played by simulators
  that go through the same ingestion services a real device would.

Because the data is simulated, the public passport honestly reports **"Traçabilité non
vérifiée"**. The public verification status is computed from real system state, not decoration.

## 3. What is NOT implemented

- Physical IoT hardware: the gateway ingestion API, the MQTT bridge and the incubator file import
  exist, but no physical sensor, gateway or machine has been connected; every reading is simulated
- Machine learning or statistical anomaly models — detection is explicit rules, by design
- Industrial or multi-tenant deployment; no load testing has been performed
- Full cooperative rollout
- Certification / document entity (passport certifications are therefore always empty)
- A native mobile application: the offline field app (`/terrain`) runs in the phone's browser,
  with no app-store version
- Languages other than French
- Rate limiting on the lot and product passport route (the egg page has its own)
- Age-adjusted environmental setpoints. `TEMPERATURE_OUT_OF_RANGE` is an absolute safety
  envelope (18-33 degC, tolerable at any age), not a brooding-to-finishing setpoint curve, so
  it cannot flag "28 degC is too warm for a five-week flock". Stated as such in the rule text.
- Sanitary observation was a modelled table only in this release. It has since become a
  capability: vaccinations, treatments with withdrawal periods and reviewed observations on
  every lot page (see BVU_TECH.md, "Santé").
- Sign-in had no throttle and left no trace. It now has both: an authentication journal, and a
  refusal after 5 failures per account or 20 per device in 15 minutes (see BVU_TECH.md).
- Exports are now registered with their SHA-256 in the chained ledger and can be verified later
  ("Exports" page), as document 3 asks of an export that must be opposable.
- Egg marking was absent from this release. It has since been built (document 3, lot 15): code
  sequence per line, camera read-back guard that stops the line, trays with their own identifier
  and QR, candling rejects named by their code, and a public egg page with its own rate limit.
  It runs on a simulated line controller until the supplier documents the machine's command set
  (see BVU_TECH.md, "Marquage").
- Incubators could only be read by the gateway. Their exported log can now be imported (document 3,
  lot 13): previewed with the same reader as the server, refused if already imported, anchored in
  the ledger, and compared hour by hour with the independent probes (see BVU_TECH.md, "Incubator logs").
  The vendor API remains unknown until the machines' plates are read.
- Equipment stopped at the client's register. Document 2's purchasing nomenclature is now in the
  platform (106 articles, the fifteen-field sheet, the budget computed by origin) along with its
  commissioning tests recorded building by building (see BVU_TECH.md, "Purchasing nomenclature" and
  "Commissioning"). Two gaps in the document are shown rather than smoothed over: its ch. 11 totals do
  not follow from its ch. 09 table for the Moroccan and European blocks, and cabling weighs less than
  the share it calls usual.
- There was no operations manual and no backup that had ever been restored. EXPLOITATION.md now covers
  variables, release procedure, scheduled jobs, monitoring, incidents and secret rotation;
  `npm run db:backup` copies the database consistently and restores the copy at once, and
  `npm run db:restore-check` proves any backup later (fingerprint, SQLite integrity, references,
  rows, hash-chained ledger, current migrations). Administration → Exploitation shows what has
  quietly stopped: schema behind, ledger broken, rules lagging the readings, purge not running.

## 4. Known limitations

| Limitation | Impact |
|---|---|
| The FCR (feed conversion) KPI reports "Donnée insuffisante" on the hero lot | Deliberate: the engine refuses to publish an indicator it cannot justify. 5 of 6 KPIs compute. |
| The seeded scenario is anchored to fixed dates: telemetry and the hero lots around 2026-08-16, the production flow (field app, health, marking, laboratory) up to 2026-10-28 | Guarantees determinism, but the dataset ages as real time passes. Closed lots are read at their closing, and in a demo database the integrity and operations screens judge freshness against its newest reading; active lots still show "nothing entered today". Re-dating means moving about 180 date literals and the codes built from them (OEB-20261018, MQ-FA-…) through one scenario clock; not done yet. |
| The hero farm shows "0 active lots" | Correct, not a bug — the hero lot is `CLOTURE`, which is *why* it has a product and a passport. See `DEMO_RUNBOOK.md` §2 for how to open the demo. |
| `notFound()` pages return HTTP 200 with correct "Introuvable" content | Next.js streams after the shell starts; content and UX are correct, the status code is not. |
| `npm run db:reset` fails with `EBUSY` while the server is running | Windows file lock. Use the in-app reset during a demo. Documented. |
| A demo reset invalidates all open sessions | The users table is recreated. Log in again. Documented. |
| Client JS is ~680–735 KB uncompressed per route | Acceptable for an authenticated internal tool; not optimised to a public-site budget. |
| `/integrite` takes ~1.5 s | It runs 761 real checks across the whole database. Admin screen, not a hot path. |
| Integrity reports 11 warnings | Expected — one quality defect seeded so the engine has something true to find, and ten register devices the simulation leaves offline (cameras, GSM alarms, mechanical thermostats, access control, one degraded sensor). **Zero critical issues.** |
| The hero lot's feed conversion ratio is ~2.0 (poor) | Deliberate and coherent: the lot is flagged for eating 25% above pattern while its growth falls 33% short. A good FCR would contradict its own alert. |

## 5. How to start the application

Requires Node.js 20+. No account, API key, cloud service or internet connection is needed.

```bash
npm install
cp .env.example .env.local      # then set SESSION_SECRET (32+ chars)
npm run db:migrate
npm run db:seed
npm run build
npm run start                   # http://localhost:3000
```

For development: `npm run dev`.

**The application runs fully offline.** There are no outbound HTTP calls in application code,
and the Inter font is self-hosted at build time.

## 6. How to seed / reset demo data

| | Command / location | Server state |
|---|---|---|
| Full reset (drops the file, re-migrates, re-seeds) | `npm run db:reset` | **Must be stopped** |
| In-app reset (truncates rows, re-seeds) | `/administration/demo` → Réinitialiser | **Must be running** |

The in-app reset is guarded three ways: `DEMO_MODE` must be on, the caller needs
`EDIT`/`SETTINGS` permission, and the database must contain the seeded demo admin — so it
cannot be pointed at a non-demo database.

Both paths run the *same* `seedDatabase()`, so both produce the same scenario: two consecutive
resets give the same lots, users, anomalies, marking runs (down to the unreadable eggs) and
sensor values (`services/demo/reset.test.ts`), and two independent snapshot builds give the same
number of rows in every table. Internal ids, and the time stamped on seed-time audit entries,
differ.

**Public passport URLs are stable across resets** (a printed QR keeps working):

- Lot: `/tracabilite/qj3nAI3lfRg_k6BlmfLU8OKcVejnTjMd`
- Product: `/tracabilite/8y7Vt4vG0tZKO6aRW_vJiBSMFr_qCdyF`

Internal UUIDs (lot, farm, device URLs) **do** change on reseed — navigate by clicking.

## 7. Demo accounts

All demo accounts share the password `Demo1234!`. Internal document — do not distribute publicly.

| Role | Email | Scope |
|---|---|---|
| Administrateur | `admin@biovolailles.demo` | Global |
| Responsable coopérative | `coop.manager@biovolailles.demo` | Coopérative Al Baraka |
| Producteur | `producteur@biovolailles.demo` | Producer |
| Responsable ferme | `ferme.manager@biovolailles.demo` | Ferme Al Baraka |
| Technicien | `technicien@biovolailles.demo` | Ferme Al Baraka |
| Auditeur | `auditeur@biovolailles.demo` | Global, read-only |
| Responsable qualité | `qualite@biovolailles.demo` | Global — releases quality holds |
| Direction | `direction@biovolailles.demo` | Global |
| Responsable couvoir | `couvoir@biovolailles.demo` | The hatchery |
| Vétérinaire | `veterinaire@biovolailles.demo` | Global |

Five partner-farmer accounts (`partenaire.fassi`, `partenaire.elamrani`, `partenaire.cherkaoui`,
`partenaire.ouazzani`, `aide.ouazzani`, all `@biovolailles.demo`) carry the production flow.

Role switching from the top bar performs a **real re-authentication**, not a UI toggle.

## 8. Demo flow

The hero scenario is `BU-2026-001`. Full script, timings (3/5/10 min) and troubleshooting
are in **`DEMO_RUNBOOK.md`**. In short:

```
Dashboard → Farm → Building → Lot → IoT → Performance/KPI
   → Anomaly → Alert → Acknowledge → Event
   → Traceability → Product → QR passport → what the public cannot see
```

Verified end to end against a production server, for every role.

## 9. Verification summary (2026-10-29)

Measured on a fresh clone of the branch and on a production build serving the demo snapshot.

| Gate | Result |
|---|---|
| `npm ci` on a fresh clone | Pass (the lockfile was re-synced that day: `npm ci` had been refusing it) |
| `npm run lint` | Pass, 0 problems |
| `npm run typecheck` | Pass |
| `npm test` | 640 passing / 87 files |
| `npm run build` | Pass, 104 routes |
| `npm run check:contrast` | 32/32 WCAG pairings pass |
| Role pass, production build | 10 roles · 226 menu pages · 0 failures · 0 browser errors; the 3 admin pages refused to all 9 other roles (27/27) |
| Public pages at phone width | site, lot passport, product passport, egg page: 200, no horizontal overflow |
| Integrity | 750/761 checks · **0 critical** · 11 expected warnings |
| System health screen | 13/13 Conforme · hero lot 5/6 KPIs |
| Operations page | 8 normal · 1 to watch (the demo's open alerts) · 0 blocking |
| Determinism | 2 consecutive resets identical (test) · 2 independent snapshot builds with the same rows in every table |
| Production dependency audit | 0 vulnerabilities (dev tooling: 4 moderate, all in drizzle-kit's bundled esbuild) |

The cross-scope security matrix (31/31 at the release candidate) was not re-run as such; the role
pass and the isolation tests (`services/identity/isolation.test.ts`) cover its ground.

## 10. What this product may and may not claim

**May claim:** multi-role operational management · farm and lot management · data quality and
provenance · simulated IoT integration · KPI and performance monitoring · explainable anomaly
detection · alert/action workflow · lot-centric traceability · product lineage · QR digital
traceability passport · audit and integrity controls.

**May not claim:** real IoT hardware integration · production machine learning · industrial
deployment · validated veterinary diagnosis · real production data.
