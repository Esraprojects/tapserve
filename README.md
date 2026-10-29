# Tapserve

Hotel and restaurant management for Ethiopia, offered as a multi-tenant service.
Restaurants, cafés, bars and hotels sign up, set up their business, and use it privately:
one business can never see another's data.

## What works today (foundation)

- Sign-up and login with an Ethiopian phone number (one-time code) or email and password
- Self-service onboarding: business details, first branch, VAT/TOT and service charge
- Every new business starts on the Free plan, with 9 default staff roles and editable permissions
- Tenant isolation enforced by PostgreSQL row-level security, with automated tests
- Amharic and English throughout, with Ethiopian calendar dates beside Gregorian ones
- Tested money logic: VAT/TOT, service charge, tax-inclusive prices, rounding to the santim

## Project layout

```text
apps/web                  Next.js app (installable PWA)
packages/core             Business rules: money, bills and tax, phone numbers, permissions
packages/db               SQL migrations with RLS, database access, auth and onboarding
packages/ethiopian-calendar  EC <-> GC conversion, Pagume, Ethiopian local time
packages/i18n             Amharic and English text
tests                     Database tests: tenant isolation, auth
docs                      Architecture and deployment notes
```

## Run it locally

Requirements: Node.js 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
cp .env.example .env                # then edit if your Postgres differs
cp .env.example apps/web/.env.local
createdb tapserve
set -a; . ./.env; set +a
pnpm db:migrate                     # creates tables, RLS policies and the tapserve_app role
pnpm db:seed                        # demo owner: demo@tapserve.et / demo-pass-123
pnpm dev                            # http://localhost:3000
```

Phone login codes are printed in the server log while `SMS_PROVIDER=console`.

## Tests

```bash
createdb tapserve_test              # tests rebuild this database from scratch on every run
pnpm test                           # unit + database tests
pnpm typecheck
```

Set `TEST_DATABASE_ADMIN_URL` if your test database is not
`postgres://postgres:postgres@localhost:5432/tapserve_test`.

See [docs/architecture.md](docs/architecture.md) and [docs/deployment.md](docs/deployment.md).
