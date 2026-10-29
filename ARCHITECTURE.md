# BIOVOLAILLES — Architecture

Single source of truth for the BIOVOLAILLES MVP: a poultry-production control center covering the full chain **Organization → Cooperative → Producer → Farm → Building → Lot → IoT → KPI → Anomaly → Alert → Action → Traceability → Product → QR Passport**, built with coherent simulated data on an architecture strong enough to evolve into the real industrial system without a rewrite.

This document is the output of the architecture phase only. No UI, no scaffolding, no fake pages have been created yet.

---

## 1. Guiding Principles

1. **One application, one domain model.** Every screen reads/writes through the same repository layer — no screen owns its own data.
2. **Framework-agnostic domain core.** Business rules (status transitions, quantity integrity, anomaly rules) live in a `domain/` + `services/` layer with no Next.js or React imports, so they're testable in isolation and portable if the frontend ever changes.
3. **Replaceable seams, not rewrites.** Three things are explicitly designed as swappable implementations behind interfaces: the **data layer** (SQLite today → Postgres/Supabase later), the **IoT source** (simulator today → MQTT/gateway later), and **auth** (cookie sessions today → managed auth provider later). The UI and services never talk to these directly — only through the interface.
5. **Real persistence, not mock JSON in components.** MVP data is simulated in *content* (coherent fake cooperatives, farms, lots, sensor readings) but real in *mechanism* — it's stored in an actual relational database, flows through the same validation and anomaly-detection code a production system would use, and is queried the same way.
6. **Never let simulated data look like validated data.** `data_status` is a first-class column, not a UI label — see §7.
7. **No over-engineering.** No microservices, no message queue, no separate backend service. One Next.js app, one database, clear internal module boundaries.

---

## 2. Technology Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js (App Router, latest stable) + TypeScript strict** | Server Components give DB-driven pages without a hand-rolled API layer; Server Actions give typed mutations; one codebase serves both the internal control center and the public QR passport. |
| Styling | **Tailwind CSS v4, CSS-first (`@theme` in `globals.css`, no `tailwind.config.js`)** | Matches the design-token approach already proven on other projects in this workspace; zero-runtime, tiny CSS output. |
| UI primitives | **Radix primitives via shadcn/ui pattern (copied into `components/ui`, not a runtime dependency)** | Accessible dialogs/menus/tabs/tables out of the box; source lives in-repo so it can be restyled to the agritech palette without fighting a component library's API. |
| Icons | **lucide-react** | Clean line icons; fits "premium control center," avoids the cartoon-farm look explicitly ruled out. |
| Database | **SQLite via libSQL (`@libsql/client`), accessed through Drizzle ORM** | Real relational integrity, migrations, and foreign keys with zero external services and no native-build friction on Windows (unlike `better-sqlite3`). Drizzle's query builder is close to 1:1 with Postgres, so moving to Postgres/Supabase later is a driver swap, not a rewrite — repositories and schema shape stay the same. |
| Validation | **Zod** | Schema validation at every Server Action boundary; shared between forms and services. |
| Forms | **React Hook Form + Zod resolvers** | Standard pairing, minimal boilerplate for the many data-entry screens (lot creation, events, actions). |
| Client data/cache | **None — deliberately.** Server Components + Server Actions + `router.refresh()` covered every case. | TanStack Query was planned here, but the only client-side polling that actually materialised is one sensor reading on the device page, which a 15-second `setInterval` handles in ~20 lines. Adding a cache layer for that would have been weight without a payer. |
| Charts | **Recharts** | KPI trends and sensor time series. |
| Auth | **iron-session** (encrypted, signed HTTP-only cookie) | Minimal, purpose-built for exactly this (Next.js cookie sessions), no external identity provider needed for an MVP with a handful of seeded demo accounts. Session shape (`userId`, `role`, `scopeType`, `scopeId`) is provider-agnostic so swapping to Supabase Auth/Auth.js later only touches `services/auth`. |
| Dates | **None — native `Date` + `toLocaleDateString("fr-FR")`** | date-fns was planned and installed, but every date need turned out to be formatting or a day-difference, both of which the platform does natively. The dependency was removed in the release-candidate pass rather than left unused. |

Nothing here requires signup, API keys, or cloud provisioning — the project runs fully offline (`npm run dev` + a local `.db` file), which matches "MVP demo" better than provisioning Supabase for a prototype that may later move there anyway.

---

## 3. Folder Structure

```
biovolailles/
├── ARCHITECTURE.md
├── package.json
├── next.config.ts
├── tsconfig.json
├── drizzle.config.ts
├── .env.local                      # SESSION_SECRET, DATABASE_URL (gitignored)
│
├── app/
│   ├── layout.tsx                  # root layout, fonts, globals.css
│   ├── globals.css                 # @theme tokens (§11)
│   │
│   ├── (public)/                   # unauthenticated, lean, fast
│   │   ├── layout.tsx
│   │   ├── page.tsx                 # minimal landing
│   │   └── tracabilite/[token]/page.tsx   # public QR passport
│   │
│   ├── (auth)/
│   │   └── login/page.tsx
│   │
│   └── (app)/                      # authenticated control center, guarded by proxy.ts
│       ├── layout.tsx               # shell: sidebar + topbar + session provider
│       ├── dashboard/page.tsx
│       ├── organisation/**
│       ├── cooperatives/**
│       ├── producteurs/**
│       ├── fermes/[farmId]/batiments/[buildingId]/page.tsx
│       ├── lots/[lotId]/{page.tsx, tracabilite/page.tsx}
│       ├── iot/[deviceId]/page.tsx
│       ├── anomalies/page.tsx
│       ├── alertes/page.tsx
│       ├── actions/page.tsx
│       ├── evenements/page.tsx
│       ├── produits/page.tsx
│       ├── sanitaire/page.tsx
│       ├── audit/page.tsx
│       ├── utilisateurs/page.tsx
│       └── parametres/page.tsx
│
├── proxy.ts                        # route guard: no (app) route reachable without session + role check
│
├── domain/                         # framework-agnostic: types, enums, zod schemas, pure business rules
│   ├── shared/                     # DataStatus, LotStatus, RelationType, Provenance, Role enums
│   ├── identity/                   # Organization, Cooperative, Producer, Farm, Building, User
│   ├── production/                 # Lot, LotEvent, Collection, SlaughterBatch, TransformationBatch
│   ├── iot/                        # Device, Sensor, Measurement
│   ├── intelligence/               # KpiDefinition, Rule, Anomaly, Alert, Action
│   ├── traceability/               # Relation edges, Product, Destination, QrToken
│   ├── sanitary/                   # SanitaryObservation
│   └── audit/                      # AuditLogEntry
│
├── data/
│   ├── db/
│   │   ├── schema.ts                # Drizzle schema (mirrors domain/ 1:1)
│   │   ├── client.ts                # libSQL client singleton
│   │   └── migrations/
│   ├── repositories/                # one per aggregate; implements domain repository interfaces
│   └── seed/
│       ├── generators/              # deterministic fake-but-coherent org→lot→event trees
│       ├── iot-simulator.ts         # §9
│       └── run.ts                   # `npm run db:seed`
│
├── services/                        # use-case / application layer, orchestrates repositories + domain rules
│   ├── auth/                        # session (iron-session), permissions matrix, can()
│   ├── production/                  # lot lifecycle, quantity-integrity validators
│   ├── iot/                         # SensorDataSource interface + simulator implementation
│   ├── intelligence/                # rules engine, KPI computation
│   ├── traceability/                # relation graph builder, QR token resolution
│   └── audit/                       # change-logging helper used by Server Actions
│
├── components/
│   ├── ui/                          # Button, Card, Badge, StatusPill, Table, Tabs, Dialog, Sheet, Toast
│   ├── charts/                      # KPI trend, sensor time series, population funnel
│   ├── layout/                      # Sidebar, Topbar, Shell, RoleSwitcher (demo aid)
│   └── domain/                      # LotCard, BuildingZoneGrid, TraceabilityChainGraph, SensorGauge,
│                                     # DataStatusTag, AlertSeverityBadge, PopulationBalanceBar
│
└── lib/                             # cn(), formatters, constants, RNG helpers for seeding
```

---

## 4. Domain Boundaries

Seven bounded contexts, each owning its own tables and pure logic; `services/` is the only layer allowed to orchestrate *across* contexts (e.g., an alert in `intelligence` referencing a `lot` in `production`).

| Context | Owns | Depends on |
|---|---|---|
| **identity** | Org/Coop/Producer/Farm/Building hierarchy, Users, roles/scope | — |
| **production** | Lot, lifecycle events, collection/slaughter/transformation batches | identity |
| **iot** | Device, Sensor, Measurement | identity, production (measurements may attach to a lot) |
| **intelligence** | KPI definitions/values, Rules, Anomalies, Alerts, Actions | production, iot |
| **traceability** | Relation graph edges, Product, Destination, QR tokens | production |
| **sanitary** | Sanitary observations | production, identity |
| **audit** | Audit log | all (read-only consumer) |

This mirrors the target chain in the brief; nothing upstream (genetics/hatchery) or transversal (feed/certification/documents) is modeled yet — the `relations` edge table (§6) is generic enough that those can be added as new node/edge types later without schema surgery.

---

## 5. Data Layer Approach

**Repository pattern**, one interface + implementation per aggregate root:

```ts
// domain/production/lot.repository.ts
export interface LotRepository {
  findById(id: string): Promise<Lot | null>;
  findByBuilding(buildingId: string): Promise<Lot[]>;
  create(input: NewLot): Promise<Lot>;
  updateStatus(id: string, status: LotStatus, actor: ActorContext): Promise<Lot>;
}
```

```ts
// data/repositories/lot.repository.drizzle.ts
export class DrizzleLotRepository implements LotRepository { /* Drizzle queries against data/db/schema.ts */ }
```

Server Components and Server Actions depend only on the **interface**, resolved via a small factory (`data/repositories/index.ts`). Swapping SQLite→Postgres later means writing a new implementation of the same interfaces against the same schema shape — nothing in `app/` or `services/` changes.

Mutations go through **Server Actions** in each route's `actions.ts`, which: validate with Zod → call a `services/*` use case → the use case calls the repository + writes an `audit_log` row via `services/audit`. No component talks to Drizzle directly.

---

## 6. Domain Entities & Relationships

Compact notation: `table[field, field CHECK(enum), field→fk]`. MVP-scoped fields only; the shape is designed to extend, not to be exhaustive.

**Identity**
```
organizations[id, name, type CHECK(cooperative|producer_group|internal)]
cooperatives[id, org_id→organizations, name, region]
producers[id, cooperative_id→cooperatives, name, contact_phone, contact_email]
farms[id, producer_id→producers, name, city, region, geo_lat, geo_lng]
buildings[id, farm_id→farms, code, name, capacity, zone_type CHECK(elevage|couvoir|stockage|autre)]
users[id, email, password_hash, full_name, role CHECK(super_admin|coop_manager|producer|farm_manager|technician|auditor),
      scope_type CHECK(global|organization|cooperative|producer|farm), scope_id, active]
```

**Production / Traceability core**
```
lots[id, building_id→buildings, code, species, breed, status CHECK(lot_status §7),
     initial_population, current_population, planned_start_at, started_at, ended_at, data_status]

lot_events[id, lot_id→lots, event_type CHECK(mise_en_place|mortalite|pesee|alimentation|transfert|
           vaccination|traitement|observation_sanitaire|abattage|autre), payload jsonb, occurred_at,
           actor_id→users, data_status, source_type, source_id, device_id, measurement_method, validation_status]

collections[id, lot_id→lots, quantity, unit, destination_id→destinations, collected_at, data_status]
slaughter_batches[id, source_lot_id→lots, quantity_in, quantity_out, losses, slaughtered_at, data_status]
transformation_batches[id, source_type CHECK(slaughter_batch|transformation_batch), source_id,
                        process_type, input_quantity, output_quantity, losses, occurred_at, data_status]
products[id, code, name, category, transformation_batch_id→transformation_batches,
         packaging_date, expiry_date, data_status]
destinations[id, name, type CHECK(marche|grossiste|export|point_vente|autre), city]

relations[id, from_type, from_id, relation_type CHECK(§6b), to_type, to_id, metadata jsonb, created_at]
```

`lot_events` is one typed-payload table rather than ten narrow tables — it's the "Events" node from the brief, extensible by adding `event_type` values instead of migrations, appropriate for MVP scope while staying auditable (each row already carries actor/timestamp/provenance).

**§6b — Relation graph.** Rather than one join table per relation type (`PROVIENT_DE`, `PRODUIT`, `ALIMENTE`, `RECOIT`, `TRANSFERE_VERS`, `COLLECTE_DE`, `ABATTU_DEPUIS`, `TRANSFORME_DEPUIS`, `DECOUPE_DEPUIS`, `CONDITIONNE_DEPUIS`, `DESTINE_A`, `CONTIENT`, `ASSOCIE_A`, `DOCUMENTE_PAR`, `CERTIFIE_PAR`), all of them are edges in one generic `relations` table (`from_type/id → relation_type → to_type/id`). `services/traceability/chain.ts` walks this table to build the full upstream/downstream chain for a lot or product. This is what lets the traceability graph grow (genetics, feed, documents, certification) without new tables per edge type.

**IoT**
```
devices[id, building_id→buildings, code, type CHECK(capteur_multi|passerelle), status CHECK(online|offline|fault), installed_at]
sensors[id, device_id→devices, sensor_type CHECK(temperature|humidite|co2|eau|aliment|poids|lumiere), unit]
measurements[id, sensor_id→sensors, lot_id→lots?, value, captured_at, data_status,
             source_type CHECK(simulateur|manuel|capteur)]
```

**Intelligence**
```
kpi_definitions[id, code, label, unit, formula_desc]
kpi_values[id, kpi_definition_id→kpi_definitions, lot_id?, building_id?, period, value, data_status, calculated_at]
rules[id, name, target CHECK(sensor:<type>|kpi:<code>), condition jsonb, severity CHECK(info|warning|critical), active]
anomalies[id, rule_id→rules, measurement_id?, kpi_value_id?, lot_id?, building_id?, severity,
          explanation, detected_at, status CHECK(open|reviewed|dismissed)]
alerts[id, anomaly_id→anomalies, status CHECK(open|acknowledged|resolved|dismissed),
       assigned_to→users, raised_at, resolved_at]
actions[id, alert_id→alerts?, lot_id?, action_type, description, actor_id→users, performed_at]
```

**Sanitary**
```
sanitary_observations[id, lot_id→lots, status CHECK(normal|surveillance|alerte), notes,
                       observed_by→users, observed_at, validated_by→users?, validation_status]
```

**Traceability / QR**
```
qr_tokens[id, token (public random slug), scope CHECK(lot|product), lot_id→lots?, product_id→products?,
          active, created_at, expires_at?]
```
The public token is a separate random identifier, never the internal UUID — resolving it returns a curated public DTO (§10), not a raw row.

**Audit**
```
audit_log[id, actor_id→users, entity_type, entity_id, field, old_value, new_value, reason,
          related_lot_id?, related_event_id?, created_at]
```

---

## 7. Business Invariants

**`data_status`** (every measurement, event, KPI value, batch carries one):
`REEL | TEST | SIMULATION | CALCULE | ESTIME | A_CONFIRMER | VALIDE | MANQUANT`
Rendered via a dedicated `DataStatusTag` component (§11) so simulated/estimated data is visually distinct from validated data everywhere it appears — never a bare value with no status.

**`lot_status`**:
`PLANIFIE | CREE | ACTIF | EN_TRANSFERT | SUSPENDU | BLOQUE | LIBERE | ABATTU | TRANSFORME | CLOTURE | ARCHIVE`
Transitions are enforced in `services/production/lot-lifecycle.ts` (a table of allowed `from → to` pairs), not left to the UI to police.

**Quantity integrity** — enforced in `services/production` as pre-mutation validators (not DB triggers, to keep SQLite simple):
- `initial_population − mortality − exits = available_population`
- `transferred_quantity ≤ available_quantity`
- `incoming_material = processed_products + losses + rejects`
- `stock_initial + entries − consumption = stock_final`

Each validator returns a typed result (`{ ok } | { ok: false, reason }`) that Server Actions surface as form errors — invariant violations are rejected before they reach the database, not cleaned up after.

---

## 8. Auth & RBAC

- **Session**: `iron-session` encrypted cookie holding `{ userId, role, scopeType, scopeId }`. Set on login (`services/auth/login.ts`, credentials checked against seeded demo users), cleared on logout.
- **Route guard**: `proxy.ts` checks for a valid session on every `(app)/*` request and redirects to `/login` otherwise — mirrors the "no admin route reachable without a session" rule from this workspace's other projects, applied here to the control center.
- **Permission matrix**: `domain/shared/permissions.ts` is a data table, not scattered `if (role === ...)` checks:
  ```ts
  export const PERMISSIONS: Record<Role, Record<Module, Access>> = { ... };
  export function can(session: Session, action: Action, resource: Module): boolean { ... }
  ```
  Consumed both server-side (Server Actions reject unauthorized mutations) and in layout/nav (hide links the role can't use). `scope_type/scope_id` on `users` additionally restricts *which rows* (which cooperative/farm) a non-global role can see — enforced as a `WHERE` clause built once in the repository layer, not repeated per query.
- Roles: `SUPER_ADMIN, COOP_MANAGER, PRODUCER, FARM_MANAGER, TECHNICIAN, AUDITOR` are authenticated; `PUBLIC` is simply the absence of a session, scoped to the `(public)/tracabilite` route only.
- A `RoleSwitcher` dev aid (`components/layout/RoleSwitcher.tsx`, visible only in the seeded demo) lets the reviewer log in as any seeded role to see the RBAC boundaries in action — this is a demo convenience, not part of the permission model itself.

---

## 9. IoT Simulation Abstraction

```ts
// services/iot/sensor-data-source.ts
export interface SensorDataSource {
  generate(sensor: Sensor, range: { from: Date; to: Date }): NewMeasurement[];
}
```

`services/iot/simulator.ts` implements this with a deterministic generator seeded by the device's code, the sensor type and the timestamp (diurnal curve per sensor type + bounded noise), so a reseed draws the same values, including a few intentionally injected anomaly windows (e.g., a CO2 spike in one building on one day) so the anomaly/alert pipeline has something real to demonstrate. The seed script writes the output as genuine `measurements` rows through the normal repository — IoT data is not special-cased, it flows through the same `measurements` table and the same rules engine (§6, §intelligence) that real sensor ingestion would use.

Because everything downstream (rules engine, anomaly detection, dashboards) depends only on `SensorDataSource` and the `measurements` table, replacing the simulator with a real MQTT/gateway ingestion path later is: write a new `SensorDataSource` implementation that pushes rows via the same repository, no UI or intelligence code changes.

---

## 10. Traceability & QR Passport

- `services/traceability/chain.ts` walks the `relations` edge table from a given lot or product to build the full upstream/downstream chain (farm → building → lot → collection → slaughter → transformation → product → destination), rendered by `TraceabilityChainGraph`.
- `qr_tokens` maps a public, unguessable token to a lot or product. `app/(public)/tracabilite/[token]/page.tsx` resolves the token via `services/traceability/resolvePublicPassport(token)`, which returns a **curated DTO** — product identity, authorized lot code, authorized origin/farm (city-level, not GPS+internal id), authorized period, public status, validated certifications — never internal UUIDs, costs, notes, or technician identity. This mapping function is the single choke point for what's public; no public page queries repositories directly.

---

## 11. Design System Architecture

- **Tokens** in `app/globals.css` via Tailwind v4 `@theme`, using the palette from the brief exactly:
  - Primary greens `#12372A → #6FAF5B` (surface/brand scale), neutrals `#14201A → #FFFFFF`, semantic `#2E8B57` (success/normal/valide), `#D99A2B` (warning/surveillance/à confirmer), `#C94A4A` (critical/alerte/bloqué), `#3D78A8` (info), accent `#E8C66A` (certification/premium highlight only, used sparingly).
  - Font: **Inter** via `next/font/google`, `display: swap`.
- **Status color mapping is centralized** in `lib/status-colors.ts` — `LotStatus`, `DataStatus`, `AlertSeverity`, `SanitaryStatus` each map to one of the four semantic colors, so a status never gets an ad-hoc color chosen per screen.
- **Primitives** (`components/ui`) are shadcn/ui-pattern (Radix + Tailwind, owned as source) restyled to these tokens: Button, Card, Badge, Table, Tabs, Dialog, Sheet, Toast, Select.
- **Domain components** (`components/domain`) compose primitives with domain meaning: `DataStatusTag`, `LotStatusBadge`, `AlertSeverityBadge`, `SensorGauge`, `PopulationBalanceBar`, `TraceabilityChainGraph`, `BuildingZoneGrid`.
- Internal control-center screens are dense/data-forward (enterprise SaaS); the public QR passport route uses the same tokens but a lighter, single-column layout tuned for a phone camera scan.

---

## 12. Routing / Information Architecture

```
/                                    public, minimal
/login                               public
/tracabilite/[token]                 public — QR passport (PUBLIC scope only)

/dashboard                           all authenticated roles (scoped view)
/organisation, /cooperatives, /producteurs      SUPER_ADMIN, COOP_MANAGER
/fermes, /fermes/[id]/batiments/[id]            + FARM_MANAGER, TECHNICIAN (own scope)
/lots, /lots/[id], /lots/[id]/tracabilite        all roles (scoped), edit gated by role
/iot, /iot/[deviceId]                            FARM_MANAGER, TECHNICIAN, SUPER_ADMIN
/anomalies, /alertes                             TECHNICIAN, FARM_MANAGER, COOP_MANAGER, SUPER_ADMIN
/actions, /evenements                            same as above
/produits                                        COOP_MANAGER, SUPER_ADMIN, AUDITOR (read)
/sanitaire                                       TECHNICIAN (write), others (read within scope)
/audit                                            AUDITOR, SUPER_ADMIN
/utilisateurs, /parametres                        SUPER_ADMIN
```

Visibility and edit rights are enforced by `can()` (§8) in both `proxy.ts` (route-level) and the layout nav (link visibility) — never by hiding a link while leaving the underlying action reachable.

---

## 13. Audit & Integrity

Every mutation that changes a tracked field goes through `services/audit/record.ts`, called from within the same Server Action/service call as the mutation itself (not a separate cron or trigger), writing `{ actor, timestamp, entity_type, entity_id, field, old_value, new_value, reason, related_lot_id, related_event_id }` to `audit_log`. The `/audit` screen is a filtered read view over this table — no separate audit subsystem.

---

## 14. Implementation Phases

| Phase | Scope |
|---|---|
| **0** | This document. ✅ |
| **1 — Foundations** | Next.js scaffold, `globals.css` tokens, Drizzle schema + migrations, seed script skeleton, `iron-session` auth, permission matrix, app shell (sidebar/topbar/RoleSwitcher). |
| **2 — Core hierarchy** | Organization/Cooperative/Producer/Farm/Building screens (list + detail), Lot list/detail, Lot event timeline, quantity-integrity validators. |
| **3 — IoT** | Device/Sensor model, simulator + historical seed, building IoT dashboard, sensor detail charts. |
| **4 — Intelligence** | KPI computation, rules engine, anomaly list, alert workflow (ack/resolve), action log. |
| **5 — Traceability** | Relation graph builder, Lot traceability chain view, Product model, QR token generation + public passport page. |
| **6 — Governance** | Audit log viewer, sanitary observations, full RBAC pass across every route. |
| **7 — Polish** | Dashboard KPI overview/home, empty states, responsive pass (375/768/1024/1440), accessibility pass. |

---

**Not built yet, by design:** genetics/hatchery chain, feed/water/certification/document domains, real IoT gateway integration, multi-language i18n. The `relations` edge model and the per-context repository/service split mean each can be added as new entities + services later without touching the existing chain.
