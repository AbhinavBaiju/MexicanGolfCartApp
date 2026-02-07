# Endpoints & Data Contracts

Complete inventory of every HTTP endpoint in the Cloudflare Worker, with request/response shapes, authentication, and known gaps.

---

## 1. Top-Level Routing

Defined in [worker/src/index.ts](worker/src/index.ts#L28-L42):

| Path Prefix | Handler | Auth |
|---|---|---|
| `GET /auth` | `handleAuth` | None (initiates OAuth) |
| `GET /auth/callback` | `handleAuthCallback` | HMAC-verified |
| `/webhooks/*` | `handleWebhook` | HMAC header verification |
| `/proxy/*` | `handleProxyRequest` | Shopify App Proxy signature (partially enforced) |
| `/admin/*` | `handleAdminRequest` | JWT Session Token (Bearer) |
| `OPTIONS *` | CORS preflight | None |

Global CORS: `Access-Control-Allow-Origin: *` applied to ALL responses ([index.ts](worker/src/index.ts#L13)).

---

## 2. Admin Endpoints

All prefixed with `/admin`. Auth: JWT session token via `Authorization: Bearer <token>`.

### 2.1 Locations

#### `GET /admin/locations`
- **Handler:** `handleLocationsGet` ([admin.ts](worker/src/admin.ts#L285))
- **Query Params:** None
- **Response:**
```json
{
  "ok": true,
  "locations": [
    {
      "id": 1,
      "code": "PLAYA",
      "name": "Playa del Carmen",
      "lead_time_days": 1,
      "min_duration_days": 1,
      "active": true
    }
  ]
}
```

#### `POST /admin/locations`
- **Handler:** `handleLocationsPost` ([admin.ts](worker/src/admin.ts#L293))
- **Request Body:**
```json
{
  "code": "PLAYA",
  "name": "Playa del Carmen",
  "lead_time_days": 1,        // optional, default 1
  "min_duration_days": 1,     // optional, default 1
  "active": true              // optional, default true
}
```
- **Response:** `{ "ok": true }`
- **Validation:** `code` and `name` required. `lead_time_days >= 0`, `min_duration_days >= 1`.

#### `PATCH /admin/locations/:id`
- **Handler:** `handleLocationsPatch` ([admin.ts](worker/src/admin.ts#L328))
- **Request Body:** Same fields as POST, all optional (merge with existing).
- **Response:** `{ "ok": true }`

### 2.2 Products (D1 Configuration)

#### `GET /admin/products`
- **Handler:** `handleProductsGet` ([admin.ts](worker/src/admin.ts#L380))
- **Query Params:** None
- **Response:**
```json
{
  "ok": true,
  "products": [
    {
      "product_id": 9678432108731,
      "variant_id": 50536218566859,
      "rentable": true,
      "default_capacity": 5,
      "deposit_variant_id": 50536218632395,
      "deposit_multiplier": 1,
      "updated_at": "2025-06-01T00:00:00"
    }
  ]
}
```
- **Note:** Returns D1 product config rows, NOT Shopify product details (title/images). Titles must come from `/admin/shopify-products`.

#### `PATCH /admin/products/:productId`
- **Handler:** `handleProductsPatch` ([admin.ts](worker/src/admin.ts#L392))
- **Request Body:**
```json
{
  "variant_id": 50536218566859,       // optional
  "rentable": true,                    // optional
  "default_capacity": 5,              // optional, integer >= 0
  "deposit_variant_id": 50536218632395, // optional
  "deposit_multiplier": 1             // optional, integer >= 1
}
```
- **Response:** `{ "ok": true }`
- **Behavior:** UPSERT — creates product config if not exists, or updates specific fields.

#### `DELETE /admin/products/:productId`
- **Handler:** `handleProductsDelete` ([admin.ts](worker/src/admin.ts#L442))
- **Response:** `{ "ok": true }`

### 2.3 Shopify Products (Proxy to Shopify Admin API)

#### `GET /admin/shopify-products`
- **Handler:** `handleShopifyProductsGet` ([admin.ts](worker/src/admin.ts#L986))
- **Query Params:** None
- **Response:**
```json
{
  "ok": true,
  "products": [
    {
      "id": 9678432108731,
      "title": "4 Seater Golf Cart",
      "status": "ACTIVE",
      "images": [{ "src": "https://..." }],
      "variants": [
        { "id": 50536218566859, "title": "Default Title" }
      ]
    }
  ]
}
```
- **Notes:**
  - Uses GraphQL API (`2025-10`), fetches first 50 products sorted by title.
  - Converts Shopify GID to numeric ID (`.split('/').pop()`).
  - Requires access token — either from `shops.access_token` or via token exchange.

### 2.4 Inventory

#### `GET /admin/inventory`
- **Handler:** `handleInventoryGet` ([admin.ts](worker/src/admin.ts#L448))
- **Query Params:**
  - `product_id` (required, positive integer)
  - `start_date` (required, `YYYY-MM-DD`)
  - `end_date` (required, `YYYY-MM-DD`)
- **Response:**
```json
{
  "ok": true,
  "inventory": [
    { "date": "2026-02-07", "capacity": 5, "reserved_qty": 2 },
    { "date": "2026-02-08", "capacity": 5, "reserved_qty": 0 }
  ]
}
```
- **Behavior:** Fills gaps with `default_capacity` from products table and `reserved_qty: 0`.

#### `PUT /admin/inventory`
- **Handler:** `handleInventoryPut` ([admin.ts](worker/src/admin.ts#L487))
- **Request Body:**
```json
{
  "product_id": 9678432108731,
  "overrides": [
    { "date": "2026-02-07", "capacity": 3 },
    { "date": "2026-02-08", "capacity": 0 }
  ]
}
```
- **Response:** `{ "ok": true }`
- **Behavior:** Uses D1 batch — INSERT OR IGNORE + conditional UPDATE + assertion SELECT. Fails with 409 if `reserved_qty > new_capacity` (prevents underselling).

### 2.5 Bookings

#### `GET /admin/bookings`
- **Handler:** `handleBookingsGet` ([admin.ts](worker/src/admin.ts#L556))
- **Query Params (all optional):**
  - `status` — `HOLD|CONFIRMED|RELEASED|EXPIRED|INVALID|CANCELLED|WAITLIST`
  - `start_date` — `YYYY-MM-DD` (bookings starting on/after)
  - `end_date` — `YYYY-MM-DD` (bookings ending on/before)
  - `search` — free text (matches `booking_token`, `order_id`, `customer_name`, `customer_email`)
  - `date_preset` — `upcoming` (start_date >= today)
  - `location_code` — filter by location
  - `fulfillment_type` — `Pick Up` or `Delivery`
  - `upsell` — `with_upsell` or `without_upsell`
  - `product_id` — filter bookings containing this product
  - `sort_direction` — `asc` or `desc` (default `desc`)
- **Response:**
```json
{
  "ok": true,
  "bookings": [
    {
      "booking_token": "abc-123",
      "status": "CONFIRMED",
      "location_code": "PLAYA",
      "start_date": "2026-02-07",
      "end_date": "2026-02-10",
      "order_id": 6195830063307,
      "invalid_reason": null,
      "created_at": "2025-06-01T12:00:00",
      "updated_at": "2025-06-01T12:05:00",
      "customer_name": "John Doe",
      "customer_email": "john@example.com",
      "revenue": "350.00",
      "fulfillment_type": "Pick Up",
      "delivery_address": null,
      "signed_agreement_id": "uuid-or-null",
      "service_count": 1,
      "service_product_ids": "9678432108731",
      "has_upsell": 0
    }
  ]
}
```
- **Schema Awareness:** Uses `getBookingQuerySchema()` to dynamically detect which columns exist (handles pre-migration schemas gracefully).

#### `GET /admin/bookings/:token`
- **Handler:** `handleBookingGet` ([admin.ts](worker/src/admin.ts#L766))
- **Response:**
```json
{
  "ok": true,
  "booking": { /* same fields as list + id, expires_at */ },
  "items": [
    { "product_id": 9678432108731, "variant_id": 50536218566859, "qty": 1 }
  ],
  "days": [
    { "product_id": 9678432108731, "date": "2026-02-07", "qty": 1 }
  ]
}
```
- **Audit Status (2026-02-07):** Wired in admin UI during M3; `BookingCard` `Manage` now opens a detail modal backed by this endpoint.

#### `POST /admin/bookings`
- **Handler:** `handleBookingsPost` (`worker/src/admin.ts`)
- **Purpose:** Create manual booking from admin while enforcing backend authority for availability/capacity.
- **Request Body:**
```json
{
  "start_date": "2026-02-10",
  "end_date": "2026-02-12",
  "location": "PLAYA",
  "customer_name": "John Doe",
  "customer_email": "john@example.com",
  "fulfillment_type": "Pick Up",
  "delivery_address": null,
  "items": [
    {
      "product_id": 9678432108731,
      "variant_id": 50536218566859,
      "qty": 1
    }
  ]
}
```
- **Response (success):**
```json
{
  "ok": true,
  "booking_token": "uuid",
  "status": "CONFIRMED"
}
```
- **Validation/Rules enforced:**
  - Validates required fields and item shape (`qty >= 1`, positive ids).
  - Validates dates with store timezone rules (`STORE_TIMEZONE`) and location lead-time/min-duration.
  - Validates location is active and products are rentable/configured.
  - Uses fail-fast SQL reservation strategy on `inventory_day` to prevent overselling.
- **Capacity conflict behavior:** Returns `409` with `"Insufficient capacity"`.
- **Side Effects:**
  1. Creates `bookings` row (`status = CONFIRMED`).
  2. Creates `booking_items` rows.
  3. Creates `booking_days` rows.
  4. Atomically increments `inventory_day.reserved_qty`.
- **Audit Status (2026-02-07):** Re-verified against implementation in `worker/src/admin.ts`; contract is in sync with deployed M2 behavior.

#### `POST /admin/bookings/:token/complete`
- **Handler:** `handleBookingComplete` ([admin.ts](worker/src/admin.ts#L916))
- **Request Body:** None
- **Response:**
```json
{
  "ok": true,
  "fulfillment": { "success": true, "message": "Fulfilled" }
}
```
- **Side Effects:**
  1. Calls Shopify Fulfillment API (`2025-10`) to fulfill the order.
  2. Updates booking status to `RELEASED`.
- **⚠️ Issue:** Sets status to `RELEASED` even if Shopify fulfillment fails (L937–940). The `fulfillment.success` flag in the response may be `false`.
- **Audit Status (2026-02-07):** M3 frontend now shows explicit success/error toast feedback and handles `fulfillment.success=false` as a surfaced failure state for admins.

#### Missing: `PATCH /admin/bookings/:token` (edit)
- **Status:** Not implemented. Read-only management is now available via `GET /admin/bookings/:token`, but edit mutation support is still missing.

### 2.6 Dashboard

#### `GET /admin/dashboard`
- **Handler:** `handleDashboardGet` ([admin.ts](worker/src/admin.ts#L833))
- **Query Params:** None
- **Response:**
```json
{
  "ok": true,
  "todayDate": "2026-02-07",
  "stats": {
    "active_bookings": 12,
    "pending_holds": 3,
    "bookings_count": 45,
    "cancelled_count": 2,
    "revenue": 15000
  },
  "productStats": [
    { "product_id": 9678432108731, "count": 30 }
  ],
  "todayActivity": {
    "pickups": [
      { "booking_token": "...", "location_code": "PLAYA", "order_id": 123, "status": "CONFIRMED" }
    ],
    "dropoffs": [ /* same shape */ ]
  },
  "upcomingBookings": [
    {
      "booking_token": "...", "start_date": "2026-02-08", "end_date": "2026-02-10",
      "location_code": "PLAYA", "status": "CONFIRMED", "order_id": 123, "customer_name": "John"
    }
  ],
  "recentHistory": [
    {
      "booking_token": "...", "start_date": "...", "end_date": "...",
      "status": "CONFIRMED", "created_at": "...", "invalid_reason": null
    }
  ]
}
```

### 2.7 Agreement

#### `GET /admin/agreement/current`
- **Handler:** `handleAgreementCurrent` ([admin.ts](worker/src/admin.ts#L1121))
- **Response:** `{ "ok": true, "agreement": { ... } | null }`
- **Agreement shape:**
```json
{
  "id": "uuid",
  "version": 2,
  "active": true,
  "title": "Rental Agreement v2",
  "pdf_url": "https://files.shopify.com/...",
  "pdf_storage_type": "EXTERNAL",
  "pdf_sha256": "abc123...",
  "page_number": 1,
  "x": 0.1, "y": 0.8, "width": 0.3, "height": 0.1,
  "created_at": "2025-06-01T00:00:00",
  "created_by": "shopify_user_id"
}
```

#### `POST /admin/agreement/upload`
- **Handler:** `handleAgreementUpload` ([admin.ts](worker/src/admin.ts#L1141))
- **Request Body:**
```json
{
  "pdf_url": "https://...",
  "title": "Rental Agreement",       // optional
  "pdf_sha256": "abc...",             // optional
  "pdf_storage_type": "EXTERNAL",    // optional, "EXTERNAL" | "SHOPIFY_FILES"
  "page_number": 1,                   // optional, default 1
  "x": 0.1, "y": 0.8, "width": 0.3, "height": 0.1  // optional defaults
}
```
- **Side Effects:** Deactivates all previous agreements for the shop, creates new one as active.

#### `POST /admin/agreement/placement`
- **Handler:** `handleAgreementPlacement` ([admin.ts](worker/src/admin.ts#L1258))
- **Request Body:**
```json
{
  "agreement_id": "uuid",  // optional — defaults to active agreement
  "page_number": 1,
  "x": 0.15, "y": 0.75, "width": 0.35, "height": 0.12
}
```
- **Response:** `{ "ok": true }`

#### `GET /admin/agreement/signed`
- **Handler:** `handleAgreementSignedList` ([admin.ts](worker/src/admin.ts#L1302))
- **Query Params:**
  - `status` — filter by signed agreement status
  - `order_id` — filter by order
  - `email` — partial match on customer email
  - `start_date`, `end_date` — date range on `signed_at`
  - `limit` (default 25, max 100), `offset` (default 0, max 10000)
- **Response:**
```json
{
  "ok": true,
  "signed_agreements": [
    {
      "id": "uuid",
      "agreement_id": "uuid",
      "agreement_version": 2,
      "agreement_title": "Rental Agreement",
      "cart_token": "shopify_cart_token",
      "order_id": "6195830063307",
      "customer_email": "john@example.com",
      "signed_at": "2025-06-01T12:00:00",
      "status": "completed"
    }
  ]
}
```

#### `GET /admin/agreement/signed/:id`
- **Handler:** `handleAgreementSignedDetail` ([admin.ts](worker/src/admin.ts#L1360))
- **Response:**
```json
{
  "ok": true,
  "signed_agreement": {
    /* same as list item + signature_png_base64 */
    "signature_png_base64": "data:image/png;base64,..."
  },
  "agreement": { /* full agreement shape */ }
}
```

#### `POST /admin/agreement/activate/:agreementId`
- **Handler:** `handleAgreementActivate` ([admin.ts](worker/src/admin.ts#L1424))
- **Response:** `{ "ok": true }`
- **Side Effects:** Deactivates all agreements, then activates the specified one.

---

## 3. Proxy Endpoints (Storefront)

All prefixed with `/proxy`. Auth: Shopify App Proxy signature (only enforced for `/agreement/sign`; see ISS-015).

All proxy endpoints require `?shop=<domain>` query parameter.

### 3.1 Availability Check

#### `GET /proxy/availability`
- **Handler:** `handleAvailability` ([proxy.ts](worker/src/proxy.ts#L137))
- **Query Params:**
  - `shop` (required)
  - `start_date` (required, `YYYY-MM-DD`)
  - `end_date` (required, `YYYY-MM-DD`)
  - `location` (optional, location code)
  - `product_id` (required, numeric)
  - `quantity` (required, integer >= 1)
- **Response:**
```json
{
  "ok": true,
  "available": true,
  "min_available_qty": 3
}
```
- **Business Logic:** Checks all days in range. Returns minimum available quantity. Validates lead time and minimum duration if location provided.

### 3.2 Create Hold

#### `POST /proxy/hold`
- **Handler:** `handleHold` ([proxy.ts](worker/src/proxy.ts#L280))
- **Request Body:**
```json
{
  "start_date": "2026-02-07",
  "end_date": "2026-02-10",
  "location": "PLAYA",
  "items": [
    { "product_id": 9678432108731, "variant_id": 50536218566859, "qty": 1 }
  ]
}
```
- **Response:**
```json
{
  "ok": true,
  "booking_token": "abc-123-def",
  "expires_at": "2025-06-01T12:20:00.000Z"
}
```
- **Side Effects:**
  1. Validates lead time, min duration, product config, and capacity.
  2. Atomically increments `inventory_day.reserved_qty` for each day/product (fail-fast on oversell).
  3. Creates booking (status `HOLD`), booking_items, booking_days.
  4. Hold expires in 20 minutes.

### 3.3 Release Hold

#### `POST /proxy/release`
- **Handler:** `handleRelease` ([proxy.ts](worker/src/proxy.ts))
- **Request Body:**
```json
{
  "booking_token": "abc-123-def"
}
```
- **Response:** `{ "ok": true }`
- **Side Effects:** Decrements `inventory_day.reserved_qty`, sets booking status to `RELEASED`.

### 3.4 Storefront Config

#### `GET /proxy/config`
- **Handler:** `handleConfig` ([proxy.ts](worker/src/proxy.ts))
- **Query Params:** `shop`
- **Response:**
```json
{
  "ok": true,
  "locations": [ { "code": "PLAYA", "name": "Playa del Carmen", ... } ],
  "products": [ { "product_id": ..., "variant_id": ..., ... } ]
}
```

### 3.5 Agreement (Storefront)

#### `GET /proxy/agreement/current`
- **Handler:** `handleAgreementCurrent` (proxy version) ([proxy.ts](worker/src/proxy.ts))
- **Response:** Same shape as admin version but scoped by shop param.

#### `POST /proxy/agreement/sign`
- **Handler:** `handleAgreementSign` ([proxy.ts](worker/src/proxy.ts))
- **Auth:** Shopify App Proxy HMAC signature verified (in production).
- **Request Body:**
```json
{
  "agreement_id": "uuid",
  "cart_token": "shopify_cart_token",
  "customer_email": "john@example.com",
  "signature_png_base64": "data:image/png;base64,..."
}
```
- **Response:** `{ "ok": true, "signed_agreement_id": "uuid" }`

---

## 4. Webhook Endpoints

#### `POST /webhooks/orders-paid`
- **Handler:** `handleWebhook` → processes `ORDERS_PAID` topic ([webhooks.ts](worker/src/webhooks.ts))
- **Auth:** HMAC-SHA256 verification against `X-Shopify-Hmac-SHA256` header.
- **Side Effects:**
  1. Idempotency check via `webhook_events` table.
  2. Calls `confirmBookingFromOrder()` in `bookingService.ts`.
  3. Transitions matching `HOLD` booking → `CONFIRMED`, enriches with customer data and revenue.

#### `POST /webhooks/app-uninstalled`
- **Handler:** `handleWebhook` → processes `APP_UNINSTALLED` topic ([webhooks.ts](worker/src/webhooks.ts))
- **Side Effects:** Sets `shops.uninstalled_at = datetime('now')`.

---

## 5. Auth Endpoints

#### `GET /auth`
- **Handler:** `handleAuth` ([auth.ts](worker/src/auth.ts))
- **Query Params:** `shop`
- **Response:** 302 redirect to Shopify OAuth consent screen.

#### `GET /auth/callback`
- **Handler:** `handleAuthCallback` ([auth.ts](worker/src/auth.ts))
- **Query Params:** `code`, `hmac`, `shop`, `state`, `timestamp`
- **Side Effects:**
  1. Verifies HMAC.
  2. Exchanges code for access token.
  3. Upserts shop in D1 (stores `access_token`, `scope`).
  4. Registers webhooks for `orders/paid` and `app/uninstalled` (API version `2026-04`).
  5. Redirects to Shopify admin for the app.

---

## 6. Scheduled (Cron)

#### `scheduled` event handler
- **Handler:** `handleScheduled` ([scheduled.ts](worker/src/scheduled.ts))
- **Trigger:** Configured in `wrangler.toml` cron triggers.
- **Side Effects:** Expires stale `HOLD` bookings past their `expires_at`, decrements `reserved_qty`.

---

## 7. Data Contract Gaps & Mismatches

### 7.1 Frontend ↔ Backend Mismatches

| Issue | Frontend Expects | Backend Provides |
|---|---|---|
| **Bookings search** | Dashboard and Bookings now send server-side `search` query params (M1) | Server-side `search` supports `booking_token`, `order_id`, `customer_name`, `customer_email` |
| **Service labels** | Dashboard and Bookings now cross-reference product IDs with `/admin/shopify-products` titles (M4) | `GET /admin/products` still returns IDs only; `/admin/shopify-products` remains required for title enrichment |
| **WAITLIST status** | Bookings UI no longer exposes WAITLIST tab/filter (M1) | Backend parser still accepts `WAITLIST` though DB schema disallows writes |
| **Calendar booking count** | M3 now counts full booking spans on the client | Backend returns `start_date` + `end_date`; no dedicated day-aggregation endpoint exists yet |

### 7.2 Missing Endpoints

| Needed Endpoint | Purpose | Why Missing |
|---|---|---|
| `PATCH /admin/bookings/:token` | Edit booking details | Feature not implemented |
| `DELETE /admin/bookings/:token` | Cancel booking from admin | Feature not implemented (only `complete` exists) |
| `GET /admin/calendar-counts` | Day-level booking counts for calendar | UI recalculates from booking list (inefficient) |

### 7.3 Response Shape Inconsistencies

| Endpoint | Issue |
|---|---|
| `GET /admin/products` | Returns `product_id` (numeric) but no `title`. Frontend now cross-references `/shopify-products` (M4), but endpoint shape is still split. |
| `POST /admin/bookings/:token/complete` | Sets booking to `RELEASED` regardless of fulfillment success. Response includes `fulfillment.success: false` but DB state is already changed (frontend now surfaces this with explicit error toast). |
| `GET /admin/dashboard` | `productStats` returns `product_id` + `count` with no title. M4 frontend now enriches labels via `/shopify-products`, but the endpoint itself still omits names. |

### 7.4 API Version Inconsistency

| Context | Version |
|---|---|
| Webhook registration (`auth.ts` L238) | `2026-04` |
| Fulfillment API (`admin.ts` L942) | `2025-10` |
| GraphQL product fetch (`admin.ts` L1005) | `2025-10` |

Should be centralized in `config.ts`.
