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
| API v1 | `/api/v1/*`, `/acces-api` | API-01…API-10 | Bearer keys stored as hashes, per-key scopes, error policy 400/401/403/404/409/413/422/429/5xx, `X-Correlation-ID`, `Idempotency-Key` replay. OpenAPI 3.1 at `/api/v1/openapi.json`. **API-06 (release) is deliberately refused**: a release is a human decision. |
| Equipment register | `/equipements` | xlsx | The 87 lines of the client's workbook, live summary per unit (same indicators as its "Synthese" sheet), post-audit edits audited, CSV export. |
| Commissioning | `/equipements/recette` | Commissioning table | 20 procedures; a result exists only once recorded with evidence. |
| Programme | `/programme` | Roadmap, gates, risks, R01–R15, T01–T40 | Client's tables plus an honest coverage status for each rule and test. |

The public QR passport now also shows the strain and the hatchery's city, and stops reading as
verified while a quality hold applies to the product or its lot.

## Known gaps (also listed on `/programme`)

- No offline mobile app: the server side (idempotent replay) is ready, the client app is not.
- No PLC / Modbus / OPC UA connectors: they depend on the machines actually installed (K01).
- A transformation has a single source; multi-parent products (T34) are not modelled.
- No calibration register (R06), no versioned multi-site template (T35).
- Rate limits are per server instance, not global.
- Strict multi-client (tenant) isolation beyond the organisation scope is not proven (R12, T24).

## Configuration

See `.env.example`: `RESEND_API_KEY`, `LEADS_NOTIFY_TO`, `LEADS_NOTIFY_FROM` (optional lead
e-mails) and `LEDGER_ANCHOR_KEY` (anchor signing; set it in production). On Vercel without a
database, the site runs from the demo snapshot and **contact requests are not kept**: connect a
Turso database for real use (README → "Deploying to Vercel").
