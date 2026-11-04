# Architecture

## Multi-tenancy

- One PostgreSQL database, one shared schema. Every business table has `tenant_id`.
- Row-level security (RLS) is enabled and **forced** on every tenant table. Policies compare
  `tenant_id` with `current_tenant_id()`, which reads the transaction setting `app.tenant_id`.
- The web app connects as `tapserve_app`, a role that cannot bypass RLS. Migrations run as the owner.
- `withTenant(sql, { tenantId, userId }, fn)` opens a transaction and sets `app.tenant_id` and
  `app.user_id` with `set_config(..., true)`, so the setting ends with the transaction and never
  leaks to another request on a pooled connection.
- RLS decides *what a tenant can see*; membership decides *which tenant a user may open*.
  `getTenantAccess` checks membership on every request before `withTenant` is used.
- Users can read their own memberships (and those tenants' names) before choosing a business,
  but writes only ever reach the current tenant.
- `audit_logs` is append-only for the app role (no UPDATE or DELETE grant).
- Tests in `tests/tenant-isolation.test.ts` prove tenant A cannot read, insert, update, delete
  or move rows into tenant B.

## Billing-ready, free for now

`plans`, `subscriptions` and `tenant_features` exist from the first migration. Onboarding puts
every business on the `free` plan. Paid plans later mean new rows and a payment provider, not a
schema rewrite.

## Money

All amounts are integer santim (1 birr = 100 santim). `computeBill` in `packages/core`:

1. Sums lines after discounts (gross).
2. If prices include tax, splits the net subtotal out of the gross (`gross / (1 + rate)`).
3. Service charge = rate × net subtotal (when enabled).
4. Tax (VAT or TOT) applies to subtotal + service charge.
5. Rounds once per bill, half up, to the santim.

## Dates and time

Stored as `timestamptz` (UTC). Displayed in the Ethiopian calendar via
`packages/ethiopian-calendar`, using Addis Ababa time (UTC+3) to pick the day. Pagume has
6 days when `year % 4 === 3`. Ethiopian local time (12-hour cycle from 6:00) is optional per user.

## Auth

- Email + password: scrypt hashes, minimum 8 characters.
- Phone: 6-digit one-time code, hashed at rest, 5-minute expiry, 3 codes per 10 minutes per phone,
  locked after 5 wrong tries. SMS goes through a pluggable `SmsProvider` (console in development).
- Sessions: random 256-bit token in an httpOnly cookie; only its SHA-256 hash is stored.

## Integrations (pluggable, not built yet)

SMS gateways, payment providers (Chapa, Telebirr) and fiscal printers get interfaces so they can
be added without touching the core.

## Hotel (hotel and hotel + restaurant businesses only)

- `rooms`, `room_types` (resident and foreigner rates, weekend rates) and `rate_seasons`. A night's
  price is: agreed rate on the booking, else a season covering the night, else the weekend rate
  (Friday and Saturday nights), else the normal rate (`nightlyRate` in `packages/core`).
- `bookings` cannot double-book a room: an exclusion constraint (`btree_gist`) refuses two live
  bookings whose `[arrival, departure)` ranges overlap on the same room.
- The guest folio is `folio_charges` (room nights, restaurant bills, extras, discounts, refunds)
  minus `payments` with a `booking_id`. Deposits and folio payments share the `payments` table with
  restaurant bills, so the payments register, statement checks and the drawer count include them.
- A restaurant bill paid with the "Charge to room" method (`room_charge`) adds a `restaurant`
  charge to the in-house guest's folio. Its tax is already on the restaurant bill.
- Room nights are charged by the night audit (once per branch and day) and at check-out; a night
  is never charged twice (unique index on booking and night). Check-out needs a zero balance.
- Check-in needs the guest's ID type and number; foreign guests register with a passport.
