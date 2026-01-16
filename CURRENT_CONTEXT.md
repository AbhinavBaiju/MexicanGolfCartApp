# Current Implementation Context (MexicanGolfCarts)

This file summarizes the current state of the codebase and highlights deviations from `Gemini.md`, `Implementation_Plan.md`, `Task.md`, and `Product_Requirement.md`.

## 1) High-level architecture in the repo
- Cloudflare Worker backend (`worker/`) with D1 schema + migrations.
- Shopify app (Remix template) in `apps/shopify/mexican-golf-cart/`.
- Theme App Extension (Liquid + JS + CSS) in `apps/shopify/mexican-golf-cart/extensions/product-booking-widget/`.
- Separate Vite React admin app scaffold in `apps/admin/` (unused template).
- Shared workspace package `shared/` (empty scaffolding).

## 2) Backend (Cloudflare Worker) implementation
### 2.1 Entry + routing
- `worker/src/index.ts` routes:
  - `/auth` and `/auth/callback` for OAuth install.
  - `/webhooks/*` for Shopify webhooks.
  - `/proxy/*` for storefront booking APIs.
  - `/admin/*` for embedded admin APIs (session token auth).
  - `scheduled()` triggers hold cleanup.
- Global OPTIONS CORS response with permissive `Access-Control-Allow-Origin: *`.

### 2.2 Auth + install
- `worker/src/auth.ts`:
  - OAuth install flow with `handleAuth` and `handleAuthCallback`.
  - Stores shop domain + access token in `shops`.
  - Registers webhooks for `orders/create` and `app/uninstalled`.
  - Session token verification via Shopify JWKS (RS256) or HMAC (HS256).

### 2.3 Storefront proxy APIs
- `worker/src/proxy.ts` routes:
  - `GET /proxy/config`: returns active locations + rentable products.
  - `GET /proxy/availability`: validates dates/location/qty and checks `inventory_day`.
  - `POST /proxy/hold`: validates rules, reserves capacity, writes booking + items + days.
  - `POST /proxy/release`: releases a hold and decrements `inventory_day`.
- Uses shop timezone from `shops.timezone` with `getTodayInTimeZone()` for lead time + min duration checks.
- Capacity reservation uses atomic guarded updates + `SELECT CASE WHEN changes() = 1 THEN 1 ELSE 1/0 END;` for fail-fast rollback.

### 2.4 Webhooks
- `worker/src/webhooks.ts`:
  - Verifies HMAC header for all webhooks.
  - Handles `orders/create` via `confirmBookingsFromOrder`.
  - Handles `app/uninstalled` by nulling access_token and setting uninstalled_at.
- `worker/src/bookingService.ts`:
  - Idempotency via `webhook_events`.
  - Validates booking token, line item metadata, quantities, product/variant match.
  - Validates deposit presence by variant + expected quantity.
  - Confirms booking by setting status to `CONFIRMED` and attaching order_id.
  - Cancels invalid orders via Shopify Admin REST API when possible.

### 2.5 Admin APIs
- `worker/src/admin.ts` routes (JWT session token auth):
  - Locations: GET/POST/PATCH
  - Products: GET/PATCH
  - Inventory: GET/PUT (capacity overrides with guard against lowering below reserved_qty)
  - Bookings: list + detail

### 2.6 Scheduled cleanup
- `worker/src/scheduled.ts`: cron every 5 minutes releases expired HOLDs.
- `worker/wrangler.toml` sets cron and environment bindings.

## 3) Database schema (D1)
Implemented in `worker/migrations/`:
- `shops`, `locations`, `products`, `inventory_day`, `bookings`, `booking_items`, `booking_days`, `webhook_events`.
- `bookings.invalid_reason` added in migration 0003.
- Indexes for booking lookup, inventory date ranges, and hold expiry.

## 4) Storefront widget (Theme App Extension)
Files:
- `apps/shopify/mexican-golf-cart/extensions/product-booking-widget/blocks/booking-widget.liquid`
- `apps/shopify/mexican-golf-cart/extensions/product-booking-widget/assets/booking-widget.js`
- `apps/shopify/mexican-golf-cart/extensions/product-booking-widget/assets/booking-widget.css`

Behavior:
- Renders a date-range + location + quantity form.
- Fetches `/proxy/config` to populate location options.
- Debounced availability checks via `/proxy/availability`.
- On submit:
  - Calls `/proxy/hold` to create a HOLD.
  - Adds rental variant to cart via `/cart/add.js` with line item properties:
    `booking_token`, `booking_start_date`, `booking_end_date`, `booking_location`.
  - Redirects to `/cart`.
- Client-side hold release via `navigator.sendBeacon` on `pagehide`.
- Shows countdown timer based on `expires_at` returned by the Worker.

## 5) Shopify app (Remix) + Admin UI status
- `apps/shopify/mexican-golf-cart/` is the default Shopify Remix app template.
  - Uses Polaris and App Bridge but still has template content and demo actions.
  - No integration with Worker `/admin/*` endpoints yet.
- `apps/admin/` is a default Vite React template (not connected to Shopify or Worker).

## 6) Deviations vs plans and requirements

### 6.1 Security and routing
- App Proxy signature verification is disabled in `worker/src/proxy.ts` (commented out).
- Widget calls the Worker directly via absolute `data-api-base` URL instead of using `/apps/rental` App Proxy path.
- Result: `/proxy/*` endpoints currently do not enforce Shopify App Proxy signature validation.

### 6.2 Store timezone handling
- Date rules use `shops.timezone`, but `timezone` is never populated during OAuth install.
- `shops.timezone` defaults to `UTC`, so store timezone is not actually enforced yet.

### 6.3 Webhook re-validation gaps
Webhook confirmation does validate token, line items, dates, location, and deposit quantity, but does not:
- Re-check lead time or minimum duration rules at confirmation time.
- Re-check capacity against `inventory_day` (only checks that `booking_days` rows exist).
- Enforce that deposit line items carry the same `booking_token` property.
- Reject expired HOLDs based on `expires_at` (status check only).

### 6.4 Deposits in storefront flow
- Widget does not add deposit line items to cart.
- Deposit enforcement is only server-side, so orders with required deposits will be marked invalid.

### 6.5 Admin UI milestone
- M7 (embedded admin UI) is not implemented. Both admin UIs are scaffolds/templates.
- No screens for inventory calendar, locations, products, or bookings yet.

### 6.6 App proxy and availability
- Availability response only returns `min_available_qty` and `available`; no per-day breakdown.
- Widget does not check if product is rentable before rendering.

### 6.7 Testing and ops
- No unit/integration/webhook tests added yet.
- Rate limiting is in-memory only (`worker/src/rateLimit.ts`) and not durable across instances.

## 7) What matches the plan/requirements
- D1 schema aligns with `Implementation_Plan.md` (tables, indexes, status fields).
- Concurrency-safe reservation implemented using guarded updates in `inventory_day`.
- HOLD creation + release + scheduled expiration implemented.
- Webhook idempotency via `webhook_events`.
- Admin endpoints exist and enforce session token auth.

