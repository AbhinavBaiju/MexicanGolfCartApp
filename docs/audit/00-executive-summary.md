# Executive Summary — Admin Dashboard UI Audit

**Date:** 2026-02-07  
**Scope:** MexicanGolfCartsApp admin dashboard, Cloudflare Worker backend, Shopify embedded app integration  
**Method:** Static code analysis, UI-to-code tracing, architecture mapping

---

## What's Broken (High-Level)

The admin dashboard (`apps/admin/`) is a **standalone Vite+React SPA** served via Cloudflare Pages, embedded inside the Shopify admin iframe. Core booking/dashboard/inventory flows are now implemented through M1-M6, and major UI dead-end stubs have been removed. Security/timezone/API-version hardening has now been implemented in the worker.

The Shopify Remix app (`apps/shopify/mexican-golf-cart/`) previously contained **default template code** and placeholder route stubs. As of M5, those routes now redirect safely to the real admin SPA paths, and the template "Generate a product" demo behavior has been removed from the embedded app flow.

---

## Most Likely Reasons the Admin UI Appears Non-Functional

1. **Dual-app confusion (historical):** The Shopify Remix app originally linked to `/app/*` placeholders while the real UI lived in the Vite SPA on Cloudflare Pages. M5 resolved this by redirecting Remix `/app/*` routes to real SPA paths.

2. **Stub buttons with no handlers (historical):** Manual Booking, New Service, FAQ, Manage, and Bookings filter controls were previously unwired; these were addressed in M1-M4.

3. **Bookings page filters were cosmetic (historical):** M1 replaced cosmetic controls with server-side filter/query integration.

4. **Bookings search mismatch (historical):** M1 switched Bookings search to backend `search` query support including customer name/email fields.

5. **SHOPIFY_API_SECRET is not in `wrangler.toml`:** It must be set as a Cloudflare secret. If not deployed correctly, all JWT verification and webhook HMAC checks will fail silently, causing 401 errors on every admin API call.

---

## Top 5 Critical Issues Blocking Core Workflows

| # | Issue | Severity | Impact |
|---|-------|----------|--------|
| 1 | **Bookings page filters are non-functional stubs** — "Upcoming", "All services", "All types", "All statuses" buttons have no `onClick`, no state, no query params. Only the tab-based status filter works. | Blocker | Admin cannot filter bookings by service, type, or date range on the Bookings page. |
| 2 | **"Manual booking" button has no handler** — renders `<Button>` without `onClick`. No backend endpoint exists for creating bookings from admin. | Blocker | Admin cannot create bookings manually, a core workflow for phone/walk-in customers. |
| 3 | **"Manage" button on BookingCard has no handler** — renders `<Button variant="secondary">Manage</Button>` with no `onClick` or navigation. No booking detail/edit page exists. | Blocker | Admin cannot view or edit individual booking details. |
| 4 | **"New service" / "FAQ" buttons on Dashboard have no handlers** — purely decorative. No service creation flow or FAQ page exists. | Critical | Buttons create false affordance; clicking them does nothing. |
| 5 | **Export on Bookings page does nothing** — the `<Button icon={ExportIcon}>Export</Button>` in `Bookings.tsx` has no `onClick` handler. (Note: Dashboard page's Export _does_ work.) | Critical | Admin cannot export booking data from the Bookings page. |

---

## Risk Assessment

### Data Integrity
- **Medium Risk:** The "Mark as Completed" action transitions bookings to `RELEASED` status and attempts Shopify order fulfillment. M3 added explicit success/error feedback, but backend still sets `RELEASED` even when fulfillment fails.
- **Low Risk:** Inventory capacity overrides use guarded SQL updates preventing overselling.

### Auth/Security
- **High Risk:** `SHOPIFY_API_SECRET` is managed as a Cloudflare secret (not in `wrangler.toml`). If misconfigured, all admin API calls fail with 401. The app has no graceful recovery UI for auth failures.
- **Low Risk (remaining):** Admin CORS is now origin-restricted in production/staging; keep `ADMIN_ALLOWED_ORIGINS` aligned with active admin deployment origins.
- **Low Risk (remaining):** Proxy signature checks are now enforced for all `/proxy/*` in production/staging; dev intentionally remains permissive for local/tunnel compatibility.

### UX Dead Ends
- **Low:** M1-M5 removed the major dead-ends, including Remix template/placeholder routes (ISS-008/ISS-009).
- **Low (remaining):** No major UX dead-end stubs remain; primary next work is M7 test coverage depth.

---

## Architecture Summary

The application is a **three-part system**:

1. **Cloudflare Worker** (`worker/`): The backend API and source of truth, using D1 (SQLite) with 6 migrations applied. Handles auth, webhooks, proxy (storefront), admin, and scheduled tasks.

2. **Vite React Admin SPA** (`apps/admin/`): The real admin dashboard, deployed to Cloudflare Pages. Embeds inside Shopify admin iframe. Uses App Bridge for session tokens, Polaris for UI. Talks to Worker via `VITE_WORKER_ADMIN_BASE_URL/admin/*`.

3. **Shopify Remix App** (`apps/shopify/mexican-golf-cart/`): OAuth entry point and Shopify CLI host. During `shopify app dev`, it serves the Vite admin SPA via the `dev-shopify-admin.sh` script. Legacy Remix `/app/*` routes now redirect to SPA routes to avoid dead-end placeholder UX.

Post-M1 through M6, the admin SPA now has aligned filter/search/export and management behavior across Dashboard/Bookings, and the worker now includes the planned M6 security/timezone/API-version hardening.

---

## Implementation Status Update (2026-02-07)

Milestone 1 (Bookings Page Parity) has been implemented in the admin SPA:

- `apps/admin/src/pages/Bookings.tsx` now uses server-side query params for booking search/filter/sort.
- Search now sends backend `search` and supports customer name/email via worker-side search.
- Former stub controls now execute logic: Upcoming, All services, All types, All statuses, sort direction toggle, and Export.
- Bookings export now generates CSV for currently loaded results.
- WAITLIST tab was removed (schema does not allow `WAITLIST` status).
- "Services availabilities" placeholder tab was removed (dead-end UI removed).

Milestone 2 (Manual Booking Creation) has now also been implemented:

- Worker now supports `POST /admin/bookings`.
- Manual booking creation uses hold-style validations and fail-fast atomic capacity reservation updates.
- Bookings page now opens a functional manual booking modal from `+ Manual booking`.
- Modal supports location, date range, product/variant, quantity, fulfillment, and optional customer fields.
- Submission is wired to backend with success/error toast feedback.

Post-implementation re-audit (2026-02-07):

- Re-checked `worker/src/admin.ts` and `apps/admin/src/pages/Bookings.tsx` against M2 requirements.
- No M2 scope gaps or M1 regressions were found.
- Validation re-run passed (`tsc`, worker tests, admin lint/build), with one pre-existing lint warning in `apps/admin/src/pages/Agreement.tsx`.

Milestone 3 (Booking Management Flow) has now also been implemented:

- `BookingCard` now wires `Manage` to a booking detail modal that loads live data from `GET /admin/bookings/:token`.
- Completion flow now shows App Bridge toasts for success and error outcomes in both Bookings and Dashboard views.
- Completion flow now explicitly surfaces Shopify fulfillment failure (`fulfillment.success=false`) as an error toast while still refreshing booking state from backend.
- Booking date rendering now uses timezone-safe date parsing for `YYYY-MM-DD` values.
- `BookingsCalendar` now counts bookings across full day spans (`start_date` through `end_date`) and uses timezone-safe date keys.

Post-M3 validation re-run (2026-02-07):

- `npx tsc -p worker/tsconfig.json`: **PASS**
- `npm --workspace worker run test`: **PASS** (7 passed, 0 failed)
- `npm --workspace apps/admin run lint`: **PASS with warning** (`apps/admin/src/pages/Agreement.tsx:353`, pre-existing `react-hooks/exhaustive-deps`)
- `npm --workspace apps/admin run build`: **PASS**

Milestone 4 (Dashboard Polishing) has now also been implemented:

- Dashboard `FAQ` now opens help content and `New service` now routes to Inventory.
- Dashboard filter label now uses location semantics (`All locations`) instead of teammate semantics.
- Dashboard and Bookings service filters now show Shopify product titles by cross-referencing `/admin/shopify-products`.
- Dead code/deps cleanup completed:
  - removed `apps/admin/src/components/DashboardChart.tsx`
  - removed `apps/admin/src/pages/Products.tsx`
  - removed admin dependencies `recharts` and `@shopify/app-bridge-utils`
- Legacy `/products` URL now redirects to `/inventory`.

Post-M4 validation re-run (2026-02-07):

- `npx tsc -p worker/tsconfig.json`: **PASS**
- `npm --workspace worker run test`: **PASS** (7 passed, 0 failed)
- `npm --workspace apps/admin run lint`: **PASS with warning** (`apps/admin/src/pages/Agreement.tsx:353`, pre-existing `react-hooks/exhaustive-deps`)
- `npm --workspace apps/admin run build`: **PASS**

Milestone 5 (Shopify Remix Cleanup) has now also been implemented:

- Removed template product-generation action from `apps/shopify/mexican-golf-cart/app/routes/app._index.tsx`.
- Replaced Remix placeholder route components with redirects to real SPA paths:
  - `/app/bookings` -> `/bookings`
  - `/app/inventory` -> `/inventory`
  - `/app/products` -> `/inventory`
  - `/app/locations` -> `/locations`
- Updated Remix `NavMenu` links to align with real SPA paths (`/`, `/bookings`, `/inventory`, `/locations`, `/agreement`).
- Preserved dev tunnel behavior (`scripts/dev-shopify-admin.sh`) unchanged.

Post-M5 validation re-run (2026-02-07):

- `npm --workspace apps/shopify/mexican-golf-cart run lint`: **PASS with warning** (`extensions/rental-extension/assets/booking-widget.js:278`, pre-existing `no-unused-vars`)
- `npm --workspace apps/shopify/mexican-golf-cart run build`: **PASS with warning** (pre-existing CSS minify warning from Polaris media query output)
- `npx tsc -p worker/tsconfig.json`: **PASS**
- `npm --workspace worker run test`: **PASS** (7 passed, 0 failed)
- `npm --workspace apps/admin run lint`: **PASS with warning** (`apps/admin/src/pages/Agreement.tsx:353`, pre-existing `react-hooks/exhaustive-deps`)
- `npm --workspace apps/admin run build`: **PASS**

Milestone 6 (Security & Proxy Hardening) has now also been implemented:

- Admin CORS in `worker/src/index.ts` is route-aware and restricted to trusted admin origin(s) outside dev mode.
- Proxy signature verification in `worker/src/proxy.ts` now applies to all `/proxy/*` routes in production/staging.
- OAuth callback in `worker/src/auth.ts` now fetches and persists `shop.iana_timezone` to `shops.timezone`.
- Worker date-rule logic now uses per-shop timezone in admin, proxy, and webhook confirmation flows.
- Shopify API version usage is centralized in `worker/src/config.ts` and consumed consistently across webhook registration, fulfillment, GraphQL, and order-cancel paths.

Post-M6 validation re-run (2026-02-07):

- `npx tsc -p worker/tsconfig.json`: **PASS**
- `npm --workspace worker run test`: **PASS** (11 passed, 0 failed)
- `npm --workspace apps/admin run lint`: **PASS with warning** (`apps/admin/src/pages/Agreement.tsx:353`, pre-existing `react-hooks/exhaustive-deps`)
- `npm --workspace apps/admin run build`: **PASS**
