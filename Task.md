# task.md — Private Shopify OS 2.0 Booking System (A→Z build)

## Objective
Build a Shopify app + theme integration that:
- Shows real-time availability for rentable products across a date range and locations.
- Creates 20-minute **holds** to prevent double-booking.
- Adds rental line items to cart with required metadata (dates, locations, booking_token).
- Enforces deposits and rejects/cancels invalid orders via **orders/create** webhook.
- Provides an embedded Admin UI for capacity/inventory management.

## Definition of Done (DoD)
✅ Storefront widget (OS 2.0 app block or theme integration) supports:
- Product selection, qty, location, date range
- Live availability & validation (lead time: tomorrow+; min duration)
- Holds (create/release) with 20-minute TTL
- Add-to-cart with line item properties including booking_token

✅ Backend (Cloudflare Worker + D1):
- Multi-tenant by shop
- Proxy endpoints secured via Shopify App Proxy signature
- Webhook endpoint secured via Shopify HMAC
- Idempotent webhook processing
- Concurrency-safe capacity reservation (no overselling)

✅ Admin:
- Embedded (Shopify Admin) inventory/capacity management & booking visibility
- Authenticated via Shopify session token

✅ Ops:
- Basic monitoring/logging
- Error handling, retries, cleanup job for expired holds
- Migrations + seed + rollout checklist

---

# Milestones (recommended order)

## M0 — Foundations
- [x] Create repo structure (apps + worker + shared)
- [x] Decide UI hosting: Cloudflare Pages (recommended) to host the **Embedded Admin UI** (React routes).
- [x] Create environments: dev/staging/prod (Shopify app + Worker + D1)
- [/] Add CI: lint, typecheck, tests, deploy preview

## M1 — Shopify App Setup
- [ ] Create Shopify app (CLI) and configure:
  - [ ] App Proxy path + prefix
  - [ ] Required scopes: read_products, read_orders, write_orders (if auto-cancel), read_themes (if needed), etc.
  - [ ] Webhook subscriptions: orders/create (+ optional orders/cancelled, orders/updated)
- [ ] Store install flow:
  - [ ] On install: create/verify webhooks, store shop + access token
  - [ ] On uninstall: delete shop data (or mark inactive)

## M2 — Data Model + Migrations (D1)
- [x] Create migration framework (wrangler d1 migrations)
- [x] Implement tables:
  - [x] shops
  - [x] products (rentable config + default capacity + deposit mapping)
  - [x] locations (lead time days + min duration)
  - [x] inventory_day (per product/date capacity & reserved)
  - [x] bookings (hold/confirmed/expired/released + dates + location + order_id)
  - [x] booking_items (product + variant + qty)
  - [x] booking_days (expanded per-day allocations per product)
  - [x] webhook_events (idempotency store)
- [x] Add indexes/constraints & foreign keys where feasible

## M3 — Worker Core (Cloudflare Workers)
### 3.1 — Security helpers
- [ ] App Proxy signature verification middleware
- [ ] Webhook HMAC verification middleware (raw body)
- [ ] Admin session token auth middleware (JWT: signature, exp, aud, dest)
- [ ] Rate limiting / abuse guardrails (basic)

### 3.2 — Storefront Proxy API
- [ ] GET /proxy/availability
  - [ ] Validate dates (start <= end) / location / qty
  - [ ] Return min-available qty per product + per-day breakdown (optional)
- [ ] POST /proxy/hold
  - [ ] Validate rules (lead time: today+1 day; min duration)
  - [ ] Transactionally reserve capacity in inventory_day (inclusive range)
  - [ ] Create booking + booking_token + booking_items + booking_days
- [ ] POST /proxy/release
  - [ ] Release capacity and mark booking released
- [ ] GET /proxy/config
  - [ ] Return location + product config needed for widget

### 3.3 — Admin API (for embedded UI)
- [ ] GET /admin/locations
- [ ] POST /admin/locations
- [ ] PATCH /admin/locations/:id
- [ ] GET /admin/products (rentable settings)
- [ ] PATCH /admin/products/:id (default capacity, deposit variant, rentable flag)
- [ ] GET /admin/inventory?productId=&start_date=&end_date=
- [ ] PUT /admin/inventory (set capacity overrides for specific days)
- [ ] GET /admin/bookings?start_date=&end_date=&status=
- [ ] GET /admin/bookings/:booking_token

## M4 — Capacity Reservation Algorithm (no overselling)
- [ ] Implement reservation using **inventory_day** with atomic conditional updates:
  - [ ] Ensure row exists for each (product, date) with capacity
  - [ ] UPDATE reserved_qty with a WHERE guard (reserved+req <= capacity)
  - [ ] Abort transaction if any day fails
- [ ] Implement release path (decrement reserved_qty) based on booking_days
- [ ] Implement cleanup job:
  - [ ] Cron-triggered Worker scheduled() handler
  - [ ] Find expired holds and release their reservations

## M5 — Storefront Widget (Theme App Extension)
- [ ] Create theme app extension
- [ ] App block schema:
  - [ ] Settings: default location, UI labels, style options
- [ ] Frontend widget:
  - [ ] Date picker (range)
  - [ ] Location dropdown
  - [ ] Quantity selector
  - [ ] Live availability check (debounced)
  - [ ] Hold creation on “Reserve” or on “Add to Cart” (start_date <= end_date)
  - [ ] Cart add using Ajax API with keys: booking_token, booking_start_date, booking_end_date, booking_location
  - [ ] Show hold countdown + release on abandon (best effort)
- [ ] Graceful fallbacks:
  - [ ] If proxy fails, show clear error state
  - [ ] If hold expires, prompt to re-check availability

## M6 — Order Webhook (Confirm / Enforce)
- [ ] POST /webhooks/orders_create
  - [ ] Verify HMAC
  - [ ] Idempotency using event id header
  - [ ] Parse line items and extract booking_token + required properties
  - [ ] Validate:
    - [ ] Booking exists, not expired, matches shop
    - [ ] Dates/location match booking
    - [ ] Deposit line item present (matching token and quantity)
    - [ ] Capacity reserved (booking_days exists)
  - [ ] Confirm booking:
    - [ ] Mark booking CONFIRMED
    - [ ] Attach order_id
    - [ ] Extend reservation: keep reserved_qty
  - [ ] Reject invalid orders:
    - [ ] If permitted: cancel order via Admin API
    - [ ] Otherwise: mark booking INVALID and alert in Admin UI

## M7 — Embedded Admin UI
- [ ] Build Shopify Admin embedded UI (React + Polaris + App Bridge)
- [ ] Pages:
  - [ ] Dashboard: today’s pickups/dropoffs & upcoming bookings
  - [ ] Inventory calendar: per product, per day capacity & reserved
  - [ ] Locations: edit lead time (days) + min duration
  - [ ] Products: mark rentable + set default capacity + deposit variant
  - [ ] Bookings list: search by date/status/token
- [ ] Auth:
  - [ ] Fetch session token and call Worker /admin endpoints
  - [ ] Handle token refresh and 401s

## M8 — Quality & Testing
- [ ] Unit tests (date math, validation, reservation algorithm)
- [ ] Integration tests (D1 + Worker routes)
- [ ] Webhook tests (HMAC verification, idempotency, malformed payloads)
- [ ] Storefront E2E (Playwright): availability → hold → cart → order confirmation
- [ ] Load testing: concurrent holds on same date/product
- [ ] Security review: signature verification, token validation, data isolation

## M9 — Launch Readiness
- [ ] Merchant setup guide
  - [ ] How to add the app block to theme
  - [ ] How to configure locations/products/capacity/deposit variants
- [ ] Rollout checklist
  - [ ] Env vars, secrets, webhook health, cron enabled
- [ ] Monitoring dashboard (basic)
  - [ ] Webhook failure alerts, overloaded D1 alerts, error rate
- [ ] “Break glass” switches
  - [ ] Disable holds, disable cancellations, read-only mode

---

# Acceptance Criteria (global)
- Holds expire automatically (<=20 min) and inventory is released.
- Concurrency safe: two shoppers cannot reserve the last unit for same product/date (inclusive).
- Orders without valid booking metadata (token, dates, location, deposit) are blocked.
- Multi-tenant: shops cannot read/write each other’s bookings/inventory.
