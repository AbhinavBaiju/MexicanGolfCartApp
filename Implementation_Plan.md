# implementation_plan.md — Private Shopify OS 2.0 Booking System

## 1) Product goal (what “done” looks like)
A private Shopify app that turns standard products into **rentable inventory** with:
- Date-range availability per product
- Location-based lead-time & min-duration rules
- A 20-minute hold flow to prevent double-booking
- Cart + checkout metadata enforced via webhook
- Admin tooling to manage capacity and view bookings

## 2) High-level architecture

### Components
1. **Storefront widget**
   - Delivered via **Theme App Extension** (OS 2.0 app block)
   - Calls backend through **Shopify App Proxy** endpoints (same origin to storefront)

2. **Backend**
   - Cloudflare Worker (TypeScript) handling:
     - /proxy/* storefront endpoints (signed via app proxy)
     - /webhooks/* Shopify webhooks (HMAC verification)
     - /admin/* embedded admin APIs (session token)
   - Cloudflare D1 (SQLite) for all booking/inventory state

3. **Shopify Admin embedded UI**
   - React + Polaris + App Bridge
   - Calls /admin/* endpoints with session token

### Core flows

#### A) Availability (read)
Widget → App Proxy → Worker → D1 queries → response to widget

#### B) Hold (write)
Widget → App Proxy → Worker → D1 transaction:
- Reserve capacity for each product/day
- Create booking_token + booking record
Worker → response with booking_token + expiry

#### C) Add-to-cart
Widget uses Ajax Cart API:
- Adds rental variant(s) with required line item properties
- Adds deposit variant (if configured) with same booking_token

#### D) Confirm booking (webhook)
Shopify → orders/create webhook → Worker:
- Verify HMAC
- Idempotency check
- Validate booking_token + deposit presence + rules
- Mark booking CONFIRMED + attach order_id
- Optionally cancel invalid order

#### E) Cleanup
Cron trigger → Worker scheduled() → expire holds + release reservations

---

## 3) Data model (D1)

### 3.1 Tables

#### shops
- id (PK)
- shop_domain (UNIQUE)
- access_token (encrypted at rest if possible)
- installed_at, uninstalled_at
- timezone

#### products
Per-shop rentable configuration.
- shop_id (FK)
- product_id (Shopify product id, BIGINT)
- variant_id (primary rental variant if needed)
- rentable (boolean)
- default_capacity (int)
- deposit_variant_id (BIGINT nullable)
- deposit_multiplier (int default 1)  # usually equals rental qty
- created_at, updated_at
UNIQUE(shop_id, product_id)

#### locations
- id (PK)
- shop_id (FK)
- code (string key like "sayulita_downtown")
- name
- lead_time_days (int)        # minimum calendar days from today
- min_duration_days (int)    # minimum rental length
- active (boolean)
UNIQUE(shop_id, code)

#### inventory_day
Single source of truth for capacity + reserved totals per day.
- shop_id (FK)
- product_id (BIGINT)
- date (YYYY-MM-DD text)
- capacity (int)
- reserved_qty (int)
PRIMARY KEY (shop_id, product_id, date)

> Why this table exists:
> - It enables atomic “decrement availability” style updates to avoid overselling.

#### bookings
- id (PK)
- shop_id (FK)
- booking_token (UNIQUE)
- status ENUM('HOLD','CONFIRMED','RELEASED','EXPIRED','INVALID')
- location_code
- start_date (YYYY-MM-DD)   # inclusive
- end_date (YYYY-MM-DD)     # inclusive
- expires_at (timestamp)    # set for HOLD only
- order_id (BIGINT nullable)
- created_at, updated_at

#### booking_items
- booking_id (FK)
- product_id (BIGINT)
- variant_id (BIGINT)
- qty (int)
PRIMARY KEY (booking_id, product_id)

#### booking_days
Expanded per-day allocation for release + audits.
- booking_id (FK)
- product_id (BIGINT)
- date (YYYY-MM-DD)
- qty (int)
PRIMARY KEY (booking_id, product_id, date)

#### webhook_events
Idempotency store.
- shop_id
- event_id (string)
- topic (string)
- received_at
PRIMARY KEY (shop_id, event_id)

### 3.2 Indexes (minimum)
- bookings(shop_id, start_date)
- bookings(shop_id, status)
- booking_days(shop_id, product_id, date)  # if denormalized; else join
- products(shop_id, rentable)

---

## 4) Booking rules & date math

### 4.1 Date conventions
- Treat `start_date` as the first bookable day (inclusive).
- Treat `end_date` as the last bookable day (inclusive).
- Rental duration (days) = (end_date - start_date) + 1.

### 4.2 Validation rules
On /availability and /hold:
- start_date <= end_date
- duration >= min_duration_days for location
- start_date must be at least 1 full calendar day after today (store timezone)
- qty >= 1
- product must be rentable

---

## 5) Capacity reservation algorithm (concurrency-safe)

### Key idea
Use `inventory_day.reserved_qty` as the atomic counter, updated with a guarded UPDATE.

### Hold creation (per product/day)
For each day in the inclusive range [start_date, end_date]:
1) Ensure row exists:
   - Insert (capacity=override-or-default, reserved_qty=0) if missing

2) Atomic reserve:
   UPDATE inventory_day
   SET reserved_qty = reserved_qty + :qty
   WHERE shop_id=:shop_id AND product_id=:product_id AND date=:date
     AND reserved_qty + :qty <= capacity;

3) Fail fast if not reserved:
   Use `SELECT CASE WHEN changes()=1 THEN 1 ELSE 1/0 END;`
   so the SQL batch errors and the whole transaction rolls back.

4) Write booking_days rows so we can release exactly what we reserved.

### Release / expire
- Load booking_days for token
- For each booking_day: decrement reserved_qty accordingly
- Mark booking RELEASED or EXPIRED

### Why this works
- It is serializable at the row level because each update is conditional.
- The transaction aborts fully if any day fails, preventing partial reservation.

---

## 6) API contracts

## 6.1 Storefront (App Proxy) endpoints

### GET /proxy/config
Returns:
- locations[] {code,name,lead_time_days,min_duration_days}
- rentable_products[] {product_id, deposit_variant_id, default_capacity, ...}
- widget settings needed for UI copy/formatting

### GET /proxy/availability
Query:
- shop (from app proxy)
- start_date, end_date, location
- items[]: product_id + qty (or productIds + qty map)

Response (example):
{
  "ok": true,
  "items": [
    {
      "product_id": 123,
      "requested_qty": 2,
      "min_available_qty": 3,
      "fully_available": true,
      "by_day": [
        {"date":"2026-01-20","available_qty":3},
        {"date":"2026-01-21","available_qty":4}
      ]
    }
  ],
  "rule_violations": []
}

### POST /proxy/hold
Body:
{
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "location": "code",
  "items": [
    {"product_id": 123, "variant_id": 456, "qty": 2}
  ]
}

Response:
{
  "ok": true,
  "booking_token": "tok_...",
  "expires_at": "ISO8601",
  "hold_minutes": 20
}

### POST /proxy/release
Body: { "booking_token": "tok_..." }

Response: { "ok": true }

---

## 6.2 Webhooks

### POST /webhooks/orders_create
Headers:
- X-Shopify-Hmac-Sha256 (verify)
- X-Shopify-Event-Id (idempotency)
- X-Shopify-Shop-Domain (shop routing)
Payload: Order JSON.

Validation steps:
1) Verify HMAC against raw body
2) Check event_id not processed
3) Extract booking_token(s) from line_items.properties
4) For each token:
   - booking exists and status=HOLD
   - not expired
    - order dates/location match
    - deposit present if required (must use SAME booking_token and match quantity)
5) Confirm booking:
   - status=CONFIRMED
   - order_id set

Invalid order policy:
- If token missing for rentable product → INVALID
- If deposit missing → INVALID
- Action:
  - Preferred: cancel order via Admin API + reason
  - Always: record INVALID + visible in Admin UI

---

## 6.3 Admin endpoints (embedded UI)

All require session token auth.
- GET /admin/locations
- POST /admin/locations
- PATCH /admin/locations/:code
- GET /admin/products
- PATCH /admin/products/:product_id
- GET /admin/inventory?product_id&start_date&end_date
- PUT /admin/inventory (bulk upsert capacity overrides)
- GET /admin/bookings?start_date&end_date&status
- GET /admin/bookings/:booking_token

---

## 7) Storefront widget (Theme App Extension)

### App block strategy
- Provide an app block “Booking widget”
- Merchants add it to:
  - Product template (in a section supporting @app)
  - Home page (in an “Apps” section)

### Frontend behavior (recommended)
1) On load: fetch /proxy/config (cache in session)
2) When user changes dates/qty/location:
   - debounce → /proxy/availability
3) On “Reserve/Add to cart”:
   - POST /proxy/hold
   - Add rental variant(s) to cart with properties:
      - booking_token, booking_start_date, booking_end_date, booking_location
   - Add deposit variant with same token (if configured)
4) Show countdown to expiry; if expires, disable checkout and prompt re-hold

### Cart properties format
Use stable keys (prefixed) so they’re easy to detect in webhook filters and parsing:
- booking_token
- booking_start_date
- booking_end_date
- booking_location

---

## 8) Admin embedded UI

### Minimal UX scope (v1)
- Products: toggle rentable, set default capacity, deposit variant
- Locations: lead time + min duration
- Inventory calendar: set capacity overrides by day
- Bookings list: status + date + product + location + order link
- Admin Session Token Auth:
  - verify signature against Shopify keys (JWKS)
  - verify token not expired
  - verify aud matches app API key
  - verify dest matches shop domain

---

## 9) Observability & ops

- Structured logs: request_id, shop_domain, booking_token, event_id
- Metrics (at least counters):
  - holds_created, holds_failed_capacity, holds_expired
  - webhook_orders_processed, webhook_duplicates_skipped, webhook_invalid
  - d1_overloaded_errors
- Alerts:
  - webhook failures > threshold
  - invalid order rate spike
  - d1 overloaded

---

## 10) Rollout & safety levers

- Feature flags (env or per shop):
  - enable_holds
  - enable_auto_cancel_orders
  - enable_deposit_enforcement
- Migration plan:
  - Backfill products config from Shopify products tagged “rentable” (optional)
- Launch checklist:
  - Webhooks live and verified
  - Cron trigger enabled
  - App proxy path configured
  - Theme block published and added to templates
  - Test: 2 concurrent holds for last unit (must allow only 1)

---

## Appendix A — SQL migration sketch (illustrative)
(Write actual migrations in /migrations with incremental versions.)
