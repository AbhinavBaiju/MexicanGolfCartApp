# Repository Architecture Map

## 1. Monorepo Structure

The repository uses **npm workspaces** defined in the root `package.json`:

```
workspaces: ["apps/*", "apps/shopify/*", "worker", "shared"]
```

### Top-Level Layout

| Folder | Role |
|--------|------|
| `apps/admin/` | Vite + React + Polaris admin dashboard SPA (the **real** admin UI) |
| `apps/shopify/mexican-golf-cart/` | Shopify Remix app (OAuth host, CLI entry, placeholder routes) |
| `worker/` | Cloudflare Worker backend (D1, API, webhooks, scheduled tasks) |
| `shared/` | Shared TypeScript package (currently only scaffolding — empty `src/index.ts`) |
| `scripts/` | Dev/deploy helper scripts |
| `e2e/` | E2E test folder (likely empty/early) |

### Key Scripts (root `package.json`)

| Script | What It Does |
|--------|--------------|
| `npm run dev` | Runs sync-db, then concurrently: worker, shopify, admin pages |
| `dev:shopify` | `cd apps/shopify/mexican-golf-cart && npm run dev -- --config dev` |
| `dev:worker` | `node scripts/dev-worker-live.mjs` |
| `dev:pages` | `cd apps/admin && vite dev` on port 4173 |

---

## 2. Admin Dashboard (`apps/admin/`)

### Framework
- **Vite 7** + **React 18** + **TypeScript**
- **Shopify Polaris v13** for components
- **App Bridge v4** (via `@shopify/app-bridge-react`) for embedded context
- **React Router DOM v7** for client-side routing
- **pdfjs-dist** for PDF rendering (Agreement feature)
- **recharts** (imported in `package.json` but not used in any component)

### Hosting
- Built output deployed to **Cloudflare Pages** at `master.mexican-golf-cart-admin.pages.dev`
- This URL is set as `application_url` in `shopify.app.toml`
- Served inside Shopify admin iframe as an embedded app

### Entry Points
- `index.html` → Loads App Bridge script tag + `src/main.tsx`
- `main.tsx` → Renders `<App />` in StrictMode
- `App.tsx` → Sets up `PolarisProvider`, `BrowserRouter`, `NavMenu`, `Routes`

### Routing (Client-Side)

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `Dashboard` | Stats + calendar + filtered bookings list |
| `/bookings` | `Bookings` | Tab-based booking list with status filters |
| `/inventory` | `Inventory` | Product configs + monthly availability grid |
| `/locations` | `Locations` | Location CRUD |
| `/agreement` | `Agreement` | Agreement PDF upload + signature placement + signed list |

**Note:** There is NO `/products` route in `App.tsx`, even though `Products.tsx` exists in `pages/`. The Products page is **unreachable** via navigation.

### Components

| Component | File | Used By |
|-----------|------|---------|
| `BookingCard` | `components/BookingCard.tsx` | Dashboard, Bookings |
| `BookingsCalendar` | `components/BookingsCalendar.tsx` | Dashboard, Bookings |
| `DashboardStats` | `components/DashboardStats.tsx` | Dashboard |
| `DashboardChart` | `components/DashboardChart.tsx` | **Not used anywhere** |
| `ProductInventory` | `components/ProductInventory.tsx` | Dashboard |
| `SignedAgreementPdfPreview` | `components/SignedAgreementPdfPreview.tsx` | BookingCard, Agreement |

### API Layer
- `api.ts` → `useAuthenticatedFetch()` hook
  - Gets session token from `window.shopify.idToken()`
  - Adds `Authorization: Bearer <token>` header
  - Prepends `VITE_WORKER_ADMIN_BASE_URL/admin` to all paths
  - Default base URL: `https://mexican-golf-cart-worker.explaincaption.workers.dev`

---

## 3. Shopify Remix App (`apps/shopify/mexican-golf-cart/`)

### Framework
- **Remix** (via `@shopify/shopify-app-remix`)
- Uses Shopify CLI for dev tunneling and OAuth

### Purpose
- **Primary:** Provides OAuth entry, Shopify CLI integration, webhook route registration
- **Secondary:** Defines `shopify.app.toml` configuration (scopes, proxy, webhooks)
- **NOT the admin UI:** The `app/routes/app._index.tsx` still contains the **default Shopify template** ("Generate a product" demo)

### Route Pages (ALL PLACEHOLDERS)

| Route | File | Content |
|-------|------|---------|
| `/app` | `app._index.tsx` | Default template with "Generate a product" demo |
| `/app/bookings` | `app.bookings.tsx` | "Bookings page placeholder." |
| `/app/inventory` | `app.inventory.tsx` | "Inventory page placeholder." |
| `/app/products` | `app.products.tsx` | "Products page placeholder." |
| `/app/locations` | `app.locations.tsx` | "Locations page placeholder." |

### Dev Integration
- `shopify.web.toml` sets `dev` command to `bash ../../../scripts/dev-shopify-admin.sh`
- This script **starts the Vite admin SPA** (`apps/admin`) on the port Shopify CLI tunnels
- So during `shopify app dev`, the Vite admin SPA is served through the Shopify tunnel, not the Remix routes

### Shopify Configuration (`shopify.app.toml`)

| Setting | Value |
|---------|-------|
| `client_id` | `ec7f70d8e7c5f2ec9cb8b6811b23e491` |
| `application_url` | `https://master.mexican-golf-cart-admin.pages.dev` |
| `embedded` | `true` |
| `scopes` | `read_products,write_products,read_orders,write_orders` |
| `app_proxy.url` | `https://mexican-golf-cart-worker.explaincaption.workers.dev/proxy` |
| `app_proxy.prefix` | `apps` |
| `app_proxy.subpath` | `rental` |
| `webhooks.api_version` | `2026-04` |
| Webhook topics | `app/uninstalled`, `app/scopes_update`, `orders/create` |

---

## 4. Worker/Backend (`worker/`)

### Runtime
- **Cloudflare Workers** with **D1** (SQLite) database
- TypeScript, compiled via Wrangler
- No framework (native `fetch` handler, manual routing)

### Entry (`src/index.ts`)
- Routes by URL pathname prefix:
  - `/auth` → `handleAuth` (OAuth install redirect)
  - `/auth/callback` → `handleAuthCallback` (token exchange + DB store)
  - `/webhooks/*` → `handleWebhook` (HMAC verified)
  - `/proxy/*` → `handleProxyRequest` (storefront API)
  - `/admin/*` → `handleAdminRequest` (session token auth)
- Global CORS: `Access-Control-Allow-Origin: *`
- Scheduled handler: `handleScheduled` (cron every 5 min for hold expiry)

### Admin Route Handler (`src/admin.ts`)

All routes require JWT session token verification. The path prefix `/admin` is stripped before routing.

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/locations` | `handleLocationsGet` | List locations |
| POST | `/locations` | `handleLocationsPost` | Create location |
| PATCH | `/locations/:id` | `handleLocationsPatch` | Update location |
| GET | `/products` | `handleProductsGet` | List product configs |
| PATCH | `/products/:id` | `handleProductsPatch` | Upsert product config |
| DELETE | `/products/:id` | `handleProductsDelete` | Delete product config |
| GET | `/inventory` | `handleInventoryGet` | Get inventory for product/date range |
| PUT | `/inventory` | `handleInventoryPut` | Set capacity overrides |
| GET | `/bookings` | `handleBookingsGet` | List bookings with filters |
| GET | `/bookings/:token` | `handleBookingGet` | Single booking detail |
| POST | `/bookings/:token/complete` | `handleBookingComplete` | Mark as RELEASED + fulfill |
| GET | `/dashboard` | `handleDashboardGet` | Dashboard stats aggregate |
| GET | `/agreement/current` | `handleAgreementCurrent` | Active agreement |
| POST | `/agreement/upload` | `handleAgreementUpload` | Upload new agreement |
| POST | `/agreement/placement` | `handleAgreementPlacement` | Update signature rect |
| GET | `/agreement/signed` | `handleAgreementSignedList` | List signed agreements |
| GET | `/agreement/signed/:id` | `handleAgreementSignedDetail` | Signed agreement detail |
| POST | `/agreement/activate/:id` | `handleAgreementActivate` | Activate agreement version |
| GET | `/shopify-products` | `handleShopifyProductsGet` | Proxy Shopify GraphQL product list |

### Missing Admin Endpoints (needed by UI but don't exist)

| Needed For | Expected Endpoint | Status |
|------------|-------------------|--------|
| Manual booking creation | `POST /bookings` | **Does not exist** |
| Booking edit/manage | `PATCH /bookings/:token` | **Does not exist** |
| Service/product creation from dashboard | `POST /products` (full) | Partially exists (PATCH only) |
| FAQ content | Any | **Does not exist** |

---

## 5. Auth/Session Model

### OAuth Install Flow
1. `/auth?shop=...` → Redirect to Shopify OAuth authorize URL
2. `/auth/callback` → Verify HMAC, exchange code for access token, store in `shops` table, register webhooks
3. Webhooks registered: `orders/create`, `app/uninstalled`

### Session Token Auth (Admin API)
1. Admin SPA calls `window.shopify.idToken()` (App Bridge v4)
2. Token sent as `Authorization: Bearer <token>`
3. Worker verifies JWT signature (RS256 via Shopify JWKS, or HS256 via API secret)
4. Checks `exp`, `nbf`, `aud` (matches `SHOPIFY_API_KEY`), `iss`/`dest` host match
5. Extracts `shopDomain` from `dest`, looks up `shops` table for `shop_id`
6. Auto-provisions shop row if not found (trusts verified JWT)

### Token Exchange (for Shopify API calls)
- `getShopAccessToken()` checks `shops.access_token` first
- If empty, performs Shopify token exchange (session token → offline access token)
- Persists the access token for future requests

### Security Gaps
- `SHOPIFY_API_SECRET` is a Cloudflare secret, not in `wrangler.toml` — must be deployed via `wrangler secret put`
- No `SHOPIFY_JWKS_URL` set in wrangler.toml vars (falls back to `https://shopify.dev/.well-known/jwks.json`)
- CORS `*` is overly permissive for an authenticated API

---

## 6. Data Layer

### Database: Cloudflare D1 (SQLite)
- Production DB: `mexican-golf-cart-db-prod` (ID: `61380274-...`)
- Dev DB: `mexican-golf-cart-db-dev` (ID: `73603dc3-...`)

### Schema (6 migrations applied)

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `shops` | `id`, `shop_domain` (unique), `access_token`, `installed_at`, `uninstalled_at`, `timezone` | `timezone` defaults to `'UTC'`, never populated with actual store TZ |
| `locations` | `id`, `shop_id`, `code` (unique per shop), `name`, `lead_time_days`, `min_duration_days`, `active` | |
| `products` | `shop_id` + `product_id` (PK), `variant_id`, `rentable`, `default_capacity`, `deposit_variant_id`, `deposit_multiplier` | |
| `inventory_day` | `shop_id` + `product_id` + `date` (PK), `capacity`, `reserved_qty` | FK to products |
| `bookings` | `id` (UUID), `shop_id`, `booking_token` (unique), `status`, `location_code`, `start_date`, `end_date`, `expires_at`, `order_id`, `invalid_reason`, `customer_name`, `customer_email`, `revenue`, `fulfillment_type`, `delivery_address` | Status: HOLD/CONFIRMED/RELEASED/EXPIRED/INVALID/CANCELLED |
| `booking_items` | `booking_id` + `product_id` (PK), `variant_id`, `qty` | |
| `booking_days` | `booking_id` + `product_id` + `date` (PK), `qty` | Expanded allocation |
| `webhook_events` | `shop_id` + `event_id` (PK), `topic` | Idempotency |
| `agreements` | `id` (UUID), `shop_domain`, `version`, `active`, `title`, `pdf_storage_type`, `pdf_storage_key`, `pdf_sha256`, `page_number`, `x`/`y`/`width`/`height` | Signature placement rect |
| `signed_agreements` | `id` (UUID), `shop_domain`, `agreement_id`, `cart_token`, `order_id`, `customer_email`, `signature_png_base64`, `signed_at`, `status` | Status: pending/linked_to_order/expired |

### Dynamic Schema Detection
- `admin.ts` uses `getBookingQuerySchema()` to check which columns exist via `PRAGMA table_info`
- Conditionally includes `invalid_reason`, `customer_name`, `customer_email`, `revenue`, `fulfillment_type`, `delivery_address`, `signed_agreements` join
- Results are cached in-memory per Worker instance

---

## 7. Shopify Integration

### App Bridge
- **Version:** v4 (`@shopify/app-bridge-react` ^4.2.8)
- **Loaded via:** Script tag in `index.html` with `data-api-key`
- **Usage:** `NavMenu` for navigation, `window.shopify.idToken()` for auth, `shopify.resourcePicker()` in Inventory page

### Polaris
- **Version:** v13.9.5
- **Usage:** Extensive — Page, Layout, Card, Button, Modal, TextField, IndexTable, Badge, Tabs, etc.

### Scopes
- `read_products`, `write_products`, `read_orders`, `write_orders`
- Missing: `read_customers` (would be needed for richer booking search)

### Webhooks
- Registered via `shopify.app.toml` and during OAuth callback
- Topics: `app/uninstalled`, `app/scopes_update`, `orders/create`
- Note: Webhook API version in code is `2026-04` but fulfillment REST API version is `2025-10`

### App Proxy
- URL: `https://mexican-golf-cart-worker.explaincaption.workers.dev/proxy`
- Path: `/apps/rental/*`

---

## 8. Key Configuration

### Environment Variables (Worker)

| Variable | Source | Notes |
|----------|--------|-------|
| `SHOPIFY_API_KEY` | `wrangler.toml` [vars] | Same as `client_id` |
| `SHOPIFY_API_SECRET` | Cloudflare Secrets | **NOT in wrangler.toml** — must be set via `wrangler secret put` |
| `SHOPIFY_APP_URL` | `wrangler.toml` [vars] | Worker's own URL |
| `SHOPIFY_JWKS_URL` | Not set | Falls back to `https://shopify.dev/.well-known/jwks.json` |
| `ENVIRONMENT` | `wrangler.toml` [vars] | `production` / `dev` |
| `DB` | D1 binding | |

### Environment Variables (Admin SPA)

| Variable | Source | Notes |
|----------|--------|-------|
| `VITE_SHOPIFY_API_KEY` | Build-time env | Injected into `index.html` meta tag |
| `VITE_WORKER_ADMIN_BASE_URL` | Build-time env | Default: production worker URL |

---

## 9. Notable Concerns

1. **Products page is unreachable:** `Products.tsx` exists but is not wired in `App.tsx` routes. The Products route was likely removed intentionally (Inventory page subsumes product config), but the file remains as dead code.

2. **Remix index page has demo code:** `app._index.tsx` contains a "Generate a product" mutation that creates random snowboard products. This is a leftover from the Shopify template.

3. **`DashboardChart.tsx` is unused:** The component exists but is not imported anywhere.

4. **`recharts` dependency is unused:** Listed in `package.json` but not imported in any component.

5. **`@shopify/app-bridge-utils` v3 is imported:** This is the legacy v3 utils package alongside App Bridge React v4. Likely unused but adds bundle bloat.

6. **Bookings page and Dashboard have duplicated booking listing logic:** Dashboard has full server-side filter/search/export; Bookings page has a simpler implementation with mostly-stub filters.

7. **Calendar booking count is start-date only:** `BookingsCalendar` counts bookings where `start_date` matches a given day. Multi-day bookings don't appear on intervening days.
