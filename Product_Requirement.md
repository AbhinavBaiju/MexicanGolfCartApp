# Product Requirements — Private Shopify OS 2.0 Booking System (MexicanGolfCarts)

Build a **date-range booking system** for rentable products on a **single Shopify store** using:
- **Theme App Extension** (OS 2.0) for the storefront booking block
- **Shopify App Proxy** for storefront → backend calls
- **Shopify Webhooks** for order-driven confirmation
- **Cloudflare Workers + D1** for backend + persistence
- **Embedded Admin UI** inside Shopify Admin for bookings visibility and basic management

This document is intentionally **implementation-oriented** (an engineer should be able to build from it).

---

## 1. Summary

Customers book a product for a **start date → end date** on the homepage. The app:
1) checks availability (server-side),
2) creates a short-lived **HOLD**,
3) adds the product to cart with required **line item properties** including a `booking_token`,
4) confirms the booking only after Shopify creates an order (webhook),
5) enforces capacity and minimum-stay rules server-side to prevent overbooking.

---

## 2. Goals

### 2.1 Primary goals
- Book **date ranges** for rentable products directly from the homepage.
- Prevent overbooking with **concurrency-safe** capacity checks.
- Confirm bookings based on **Shopify order events** (webhooks).
- Provide a simple **embedded admin** screen to view bookings and basic analytics.

### 2.2 Non-goals (explicitly out of scope)
- Multi-store / marketplace support
- Multi-currency pricing logic
- Per-time-slot booking (this is **date-range only**)
- Native Shopify checkout UI customizations beyond cart line item properties
- Complex cancellation/refund workflows (optional later)

---

## 3. Products in scope

All rentable products in this store are in scope. Capacity is managed per **product** per **calendar date**.

### 3.1 Deposits
Some products require a **deposit**. Deposits are modeled as a separate Shopify product/variant that must be added to cart alongside the booking line item.

**Enforcement requirement (server-side):**
- On order webhook confirmation, if the booked product requires a deposit, the backend must verify the order contains the required deposit line item(s) that match the same `booking_token` (or another deterministic linkage).
- If the deposit is missing, the booking must NOT be confirmed and should be flagged for review.

---

## 4. Definitions

- **Booking date range**: `start_date` and `end_date` (both inclusive).
- **Duration (days)**: `(end_date - start_date) + 1`.
- **Store timezone**: the timezone configured in Shopify (used for all date rules and reporting).
- **Capacity per day**: max bookable quantity for a product on a specific date.
- **HOLD**: temporary reservation created by the backend to prevent race conditions.
- **CONFIRMED**: booking finalized by webhook after order is created/paid (see §6.2).
- **Booking token**: opaque identifier returned by backend when a HOLD is created; must be attached to the cart item.

---

## 5. Storefront UX Requirements (Homepage)

### 5.1 Placement
- Use a **Theme App Extension block** on the homepage (OS 2.0).
- The booking UI must render only for products that are configured as rentable.

### 5.2 Form fields & validation
Fields:
- Location (dropdown)
- Start date (date picker)
- End date (date picker)
- Quantity (integer; default 1)

Client-side validation (UX only; server is the authority):
- Start date <= end date
- Minimum duration per location:
  - Sayulita: minimum **2 days**
  - Punta Mita: minimum **4 days**
- Lead time: booking start date must be **at least 1 full calendar day after “today”** in store timezone.
  - Example: If today is Jan 14 (store timezone), earliest start date is Jan 15.

### 5.3 Live availability behavior
- When the user edits dates/quantity/location, call the backend to fetch availability.
- The UI should show:
  - `can_book` boolean and (optionally) `remaining` count.
- Default to not exposing exact remaining capacity unless product UX requires it.

### 5.4 Cart integration requirements
Flow:
1. User submits booking form.
2. Frontend calls `POST /proxy/hold` to create a HOLD.
3. Backend returns `booking_token` + verified booking details.
4. Frontend adds the rentable product to cart using Shopify Cart Ajax API (locale-aware):
   - `POST /{locale}/cart/add.js`
5. Attach required line item properties to the cart item:
   - `booking_token`
   - `booking_start_date`
   - `booking_end_date`
   - `booking_location`
   - (optional) a human-friendly label version (Shopify Admin displays these as-is)

If a deposit is required:
- Add deposit variant as a second cart line item, also including:
  - `booking_token` (must match)
  - any required metadata

**Critical anti-bypass requirement:**
- Cart items can be edited after add-to-cart (quantities/properties changed, lines removed).
- Therefore, webhook confirmation MUST re-validate the booking against the order payload (see §6.4).

---

## 6. Booking Lifecycle & Source of Truth

### 6.1 State machine
- `HOLD` — created when user submits booking from storefront; expires after TTL.
- `CONFIRMED` — set when Shopify order is confirmed via webhook (see §6.2).
- `CANCELLED` — set by admin action (optional) or refund/cancel webhook (optional later).
- `EXPIRED` — hold expired before confirmation.
- `INVALID` — detected during webhook validation (missing token, mismatch, capacity failure, missing deposit, etc.).

### 6.2 When to confirm
Recommended confirmation events (in order of simplicity):
- **Option A: `orders/create`** (simple; can include unpaid orders depending on payment method)
- **Option B: `orders/paid`** (preferred when you only want paid bookings)

This project should implement **orders/create** first unless explicitly changed.

### 6.3 Holds TTL
- Default HOLD TTL: **20 minutes**
- Holds expire server-side (do not rely on client timers).
- Expired holds must not block capacity.
- The backend must periodically purge expired holds (lazy cleanup on reads/writes is acceptable; cron optional).

### 6.4 Source-of-truth & anti-tamper rules (MUST)
Because the cart/order can be modified after a hold is created:
- The storefront UI is never authoritative.
- The backend must confirm bookings using **order payload + backend state**.

On webhook confirmation, the backend MUST:
1) locate the booking line item(s) in the order that contain `booking_token`
2) validate the token exists and is still in `HOLD` state (or a permitted intermediate state)
3) validate product/variant IDs match the hold
4) validate quantity matches the hold (or enforce rules for partials explicitly)
5) validate `start_date`, `end_date`, location match
6) validate lead time / min duration rules
7) validate capacity again at confirmation time
8) validate deposit line presence (if required)
9) then atomically transition to `CONFIRMED`

If any check fails, mark the record `INVALID` and store a clear reason.

---

## 7. Backend Requirements (Cloudflare Workers + D1)

### 7.1 Overview
- Worker serves:
  - Storefront endpoints via **App Proxy** (`/proxy/*`)
  - Webhook endpoints (`/webhooks/*`)
  - Admin endpoints (`/admin/*`)
- D1 stores holds, bookings, and per-day capacity allocations.

### 7.2 Persistence requirement (simple)
- Every booking interaction that affects capacity must be persisted.
- Availability must account for:
  - CONFIRMED bookings
  - non-expired HOLDs

### 7.3 Shopify App Proxy (Storefront → Worker)
- Implement App Proxy routes under `/proxy/*` and validate that requests came from Shopify by verifying the **`signature`** query parameter (HMAC).
- Reject invalid signatures (401).

### 7.4 Shopify Webhooks (Shopify → Worker)
- Subscribe to:
  - `orders/create` (required MVP)
  - (optional later) `orders/paid`, `orders/cancelled`, `refunds/create`, `app/uninstalled`
- Validate webhook signatures using Shopify HMAC header.
- Webhook handling MUST be **idempotent**:
  - Shopify can retry delivery and duplicates may occur.
  - Use a dedupe key (e.g., webhook ID header + topic + order ID) and persist processed events.

### 7.5 API Endpoints (Worker)

#### 7.5.1 Storefront (App Proxy)
- `GET /proxy/availability?product_id=&start_date=&end_date=&quantity=&location=`
  - Returns `can_book` and optional `remaining` per date, but should default to minimal leakage.
- `POST /proxy/hold`
  - Request: product/variant, start/end, location, quantity
  - Behavior:
    - validate business rules
    - validate capacity
    - create HOLD + capacity allocations
    - return `booking_token` + normalized data
- `POST /proxy/release`
  - Release a HOLD early (optional; best-effort)
  - Must be safe if already expired/released (idempotent)

#### 7.5.2 Webhooks
- `POST /webhooks/orders_create`
  - Parse order line items for `booking_token`
  - For each token, run §6.4 validations
  - Confirm booking atomically

#### 7.5.3 Admin (Embedded UI)
- `GET /admin/bookings?start_date=&end_date=&status=`
- `GET /admin/analytics?start_date=&end_date=`
- `POST /admin/bookings/{booking_id}/cancel` (optional MVP)
- Admin routes must require a verified Shopify **session token** JWT.

---

## 8. Data Model (Cloudflare D1)

### 8.1 Tables (recommended)

#### `bookings`
- `id` (uuid)
- `shop_domain` (text)
- `booking_token` (text, unique)
- `status` (text: HOLD | CONFIRMED | CANCELLED | EXPIRED | INVALID)
- `product_id` (int)
- `variant_id` (int)
- `start_date` (date)
- `end_date` (date)
- `location` (text)
- `quantity` (int)
- `order_id` (bigint, nullable)
- `order_name` (text, nullable)
- `financial_status` (text, nullable)
- `currency` (text, nullable)
- `booking_revenue` (numeric, nullable)  // optional attribution
- `order_total_price` (numeric, nullable)
- `invalid_reason` (text, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `expires_at` (timestamp, nullable; only for HOLD)

#### `booking_allocations`
Represents per-day capacity reservations.
- `id` (uuid)
- `booking_id` (uuid)
- `date` (date)
- `quantity` (int)

#### `webhook_dedupe`
- `id` (text, primary key) // e.g., `${topic}:${webhook_id}` or `${topic}:${order_id}:${delivery_attempt}`
- `received_at` (timestamp)

### 8.2 Concurrency-safe capacity enforcement (MUST)
Capacity must be enforced without overselling under concurrent requests.

Recommended pattern:
- Wrap hold creation and confirmation in a transaction.
- Compute used capacity for each date:
  - sum(CONFIRMED allocations) + sum(non-expired HOLD allocations)
- Reject if remaining < requested.
- Insert allocations atomically.

**Must-pass test:** Two simultaneous HOLD requests for the last remaining capacity must result in:
- one succeeds
- one fails deterministically with a clear error

---

## 9. Embedded Admin UI (Shopify Admin)

### 9.1 Requirements
An embedded page “Bookings” showing:
- analytics header for a selected date range
- bookings table with drill-down to line items / details
- minimal admin actions (cancel optional)

### 9.2 Analytics summary (admin-only)
Show for selected date range:
- Total confirmed bookings (count)
- Revenue:
  - **Approach A (preferred):** sum of `booking_revenue` (if computed)
  - **Approach B (fallback):** sum of `order_total_price` (coarse but simple)

Default range:
- current calendar month in store timezone

### 9.3 Bookings table
Columns:
- status
- start_date / end_date (inclusive)
- duration (days)
- product / variant
- quantity
- location
- revenue (booking-attributed if available, else order_total_price)
- Shopify order name + link (if available)
- created_at

### 9.4 Admin actions
- Cancel booking (sets status CANCELLED; releases capacity allocations)
- Optional later:
  - manual booking creation
  - blackout blocks
  - per-date capacity overrides

### 9.5 Authentication (MUST)
Use Shopify embedded app auth (App Bridge session tokens) to call Worker Admin APIs.

Backend must validate session token JWT:
- verify signature against Shopify keys (JWKS)
- verify token is not expired
- verify `aud` matches the app’s API key
- verify `dest` matches the shop domain

---

## 10. Security & Compliance

- Storefront endpoints must be protected via App Proxy signature verification.
- Webhooks must validate Shopify HMAC signature.
- Admin endpoints require verified Shopify session token JWT.
- Never trust client-provided availability, price, dates, or quantity.
- Do not log unnecessary PII. Customer contact can be pulled from Shopify order if needed.

---

## 11. Error Handling & UX Messages

Storefront errors should be friendly and specific:
- invalid date range
- minimum duration not met
- lead time not met
- insufficient availability
- hold expired (ask user to retry)
- add-to-cart failed (retry)

Backend error responses should include:
- machine-readable code
- human-friendly message

---

## 12. Observability

- Log key events:
  - hold created / expired / released
  - webhook received / validated / deduped
  - booking confirmed / invalid
- Include correlation IDs:
  - booking_token
  - order_id
- Track basic metrics:
  - holds created
  - holds expired
  - confirmation success rate
  - invalid reasons distribution

---

## 13. Testing Requirements

### 13.1 Unit tests
- Duration calc inclusive
- Minimum durations by location
- Lead time enforcement (store timezone)
- Capacity calculations with holds and expiry
- Token validation logic for webhook confirmation

### 13.2 Integration tests
- Create hold → add to cart → simulate webhook → booking confirmed
- Cart manipulation attempt (change qty/remove properties) → webhook should mark INVALID
- Concurrency: two holds competing for last remaining capacity
- Webhook dedupe: same webhook delivered twice → no double booking

### 13.3 Manual QA checklist
- Booking UI renders correctly in OS 2.0 theme block
- Locale-aware cart endpoint works on localized storefront paths
- Holds expire after TTL and no longer block availability
- Admin bookings page loads and filters correctly

---

## 14. Rollout Plan
- Deploy Worker + D1
- Install app on store
- Add Theme App Extension block to homepage
- Enable webhooks
- Run staging test order(s)
- Monitor logs and metrics for first week

---

## 15. Configuration (env vars)
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOP_DOMAIN`
- `APP_PROXY_PREFIX`
- `WEBHOOK_SECRET` (if separate; often same app secret)
- `HOLD_TTL_MINUTES` (default 20)
- `STORE_TIMEZONE`
- `D1_DB_BINDING`
- `ADMIN_BASE_URL` (embedded app URL)

---

## 16. References (primary sources)
- Shopify App Proxies authentication (signature verification): https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
- Shopify Session Tokens (embedded app auth): https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens/set-up-session-tokens
- Shopify Cart Ajax API (locale-aware URLs): https://shopify.dev/docs/api/ajax/reference/cart
- Shopify Webhooks best practices (idempotency): https://shopify.dev/docs/apps/build/webhooks/best-practices
