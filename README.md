# BIOVOLAILLES

Plateforme de gestion et de traçabilité avicole — production, IoT, qualité, alertes, et passeport
public de traçabilité par QR code.

Built with Next.js 16 (App Router, Server Components + Server Actions), TypeScript, Drizzle ORM on
libSQL/SQLite, Tailwind CSS v4, and `iron-session` cookie auth.

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — layering, data model, and the decisions behind them.
- **[DEMO_RUNBOOK.md](DEMO_RUNBOOK.md)** — running the demo scenario end to end.
- **[BVU_TECH.md](BVU_TECH.md)** — the BVU Tech extension: public site, hatchery chain, quality holds and
  recall, hash-chained ledger, API v1, equipment register, and how each maps to the client's specification.
- **[EXPLOITATION.md](EXPLOITATION.md)** — manuel d'exploitation (en français) : variables, mise en service
  d'une version, tâches planifiées, sauvegardes vérifiées et restauration, surveillance, incidents.

---

## Running locally

Requires **Node.js 20.9+**.

```bash
npm install
cp .env.example .env.local     # then edit .env.local — see below
npm run db:migrate             # creates data/db/biovolailles.db and applies migrations
npm run db:seed                # loads the deterministic demo dataset
npm run dev                    # http://localhost:3000
```

The only value you must edit in `.env.local` is `SESSION_SECRET` (32+ characters):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Demo accounts are created by the seed, which prints the list of addresses (one per role, e.g.
`admin@biovolailles.demo` for SUPER_ADMIN). They all share one password, which the seed deliberately
does *not* print — its output is often on a projector. See [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) §1.

`npm run db:seed` does nothing if the database already holds data; use `npm run db:reset` to rebuild
it from scratch.

### Everyday commands

| Command              | What it does                                                        |
| -------------------- | ------------------------------------------------------------------- |
| `npm run dev`        | Dev server                                                          |
| `npm run build`      | Production build                                                    |
| `npm run start`      | Serve the production build (runs with `NODE_ENV=production`)        |
| `npm test`           | Vitest suite                                                        |
| `npm run typecheck`  | `tsc --noEmit`                                                      |
| `npm run lint`       | ESLint                                                              |
| `npm run db:generate`| Generate a migration from `data/db/schema.ts`                       |
| `npm run db:migrate` | Apply migrations to whatever `DATABASE_URL` points at               |
| `npm run db:seed`    | Load the demo dataset                                               |
| `npm run db:reset`   | Delete the local database file, re-migrate, re-seed (local only)    |
| `npm run db:deploy`  | Migrate **and** seed a hosted database in one step (refuses `file:`) |
| `npm run db:backup`  | Consistent backup + manifest, then a test restore of it (EXPLOITATION.md §5) |
| `npm run db:restore-check -- <file>` | Restore a backup into a scratch copy and prove it |

---

## Deploying to Vercel

Import the repository and deploy. That is the whole procedure for a demo — no database to provision
and **no environment variables required**.

### Zero-config demo (the default)

1. Do **not** create `DATABASE_URL`, `DATABASE_AUTH_TOKEN` or `APP_URL`. (Creating them and leaving
   them blank is treated the same as not creating them.)
2. **Deploy.**

Optionally add `SESSION_SECRET` (any random string of 32+ characters) so sign-ins survive a
redeploy; without it, a key is derived from the deployment's identity and everyone simply signs in
again after each deploy.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Every visitor to the link gets the complete demo dataset — the ten accounts in
[DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) §1, 12 lots, the IoT history, the anomaly scenario, the public QR
passports — and can sign in.

**How it works.** The seeded SQLite database is committed gzipped at `data/demo/snapshot.db.gz`
(about 4 MB; 23 MB once unpacked, mostly telemetry) and traced into every server route
(`next.config.ts`). On a serverless host with no `DATABASE_URL` configured, the app unpacks it into
the function's writable temp directory on cold start and runs from there (`data/db/client.ts`).

**What that means.** Reads are exactly the local experience. Writes — creating a lot, acknowledging
an alert, a sign-in timestamp — land in that instance's copy and last as long as it stays warm;
a cold start begins again from the pristine snapshot. For a demo that is a feature: it resets itself
and no visitor can break it for the next one. It is *not* a persistent database — for that, see the
next section.

**Refreshing the snapshot** after a schema or seed change, then commit the `.gz`:

```bash
npm run demo:snapshot   # fresh database, every migration, full seed, VACUUM, gzip (≈ 40 s)
```

In the snapshot, raw telemetry readings are kept for the last 6 hours only (production keeps 90
days); the 15-minute and hourly buckets cover the whole simulated window. The audit trail says so.

`DEMO_MODE` stays off in production by default; leave it that way. The presenter reset it gates
replays the whole seed, and the snapshot already resets itself for free.

### Persistent database (optional)

When the app must keep what people enter, point it at a hosted libSQL database
([Turso](https://turso.tech)); the schema, SQL and migrations are unchanged.

1. Create the database — **Storage → Browse Marketplace → Turso** in the Vercel dashboard (it
   injects the credentials itself, under whatever variable prefix you choose; the app finds them),
   or `turso db create biovolailles` + `turso db tokens create biovolailles` with the CLI.
2. If you used the CLI, add `DATABASE_URL` (`libsql://…`) and `DATABASE_AUTH_TOKEN` in Vercel.
3. Fill it once, from your machine, with **shell** variables:

   ```powershell
   $env:DATABASE_URL="libsql://biovolailles-<org>.turso.io"
   $env:DATABASE_AUTH_TOKEN="<token>"
   npm run db:deploy
   ```

   `db:deploy` migrates and seeds in one step, prints the host first, and refuses a `file:` URL —
   so it cannot quietly seed your laptop instead of the deployment.
4. Redeploy.

A `file:` `DATABASE_URL` on Vercel fails the build with a clear message: the filesystem there is
ephemeral and read-only, so such a database would be empty on every request.

> **Environment variables are needed at build time, not just at runtime.** `lib/env.ts` validates
> them while `next build` collects page data; a missing `SESSION_SECRET` fails the build with
> `Failed to collect page data`, and no deployment appears.

`APP_URL` is derived from the project's production domain on Vercel, so QR passports encode a
stable URL even when minted from a preview. Set it explicitly only for a custom domain.

### Deploying somewhere else

Any Node.js host works with `npm run build` && `npm run start` and the same variables. A host with a
persistent writable disk (a VM, a container with a volume, Fly.io) can keep the `file:` SQLite
database: point `DATABASE_URL` at a path on the volume and run `npm run db:migrate && npm run db:seed`
there once. The snapshot mode and the `file:`-URL guard are specific to serverless hosts.
