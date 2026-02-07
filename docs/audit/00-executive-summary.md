# Executive Summary — Admin Dashboard UI Audit

**Date:** 2026-02-08  
**Scope:** MexicanGolfCartsApp admin dashboard, Cloudflare Worker backend, Shopify embedded app integration  
**Method:** Static code analysis, UI-to-code tracing, architecture mapping

---

## What's Broken (High-Level)

The admin dashboard (`apps/admin/`) is a **standalone Vite+React SPA** served via Cloudflare Pages, embedded inside the Shopify admin iframe. While core data flows (booking listing, dashboard stats, inventory management) **do function** when the backend is reachable and authenticated, a significant number of **UI elements are visual stubs with no wired handlers**, several **filters on the Bookings page are non-functional**, and key administrative workflows like **manual booking creation** and **booking management** are entirely unimplemented.

The Shopify Remix app (`apps/shopify/mexican-golf-cart/`) still contains **default template code** (e.g., "Generate a product" demo action on the index page) and its own route pages for Bookings/Inventory/Products/Locations are **all placeholder stubs** — the real admin UI is served from `apps/admin/` via Cloudflare Pages, not from Remix routes.

---

## Most Likely Reasons the Admin UI Appears Non-Functional

1. **Dual-app confusion:** The Shopify Remix app defines nav links to `/app/bookings`, `/app/inventory`, etc., but these are **placeholder pages**. The _real_ admin UI is a separate Vite app deployed to Cloudflare Pages (`master.mexican-golf-cart-admin.pages.dev`). If a user lands on the Remix routes, they see empty stubs.

2. **Stub buttons with no handlers:** Multiple prominent buttons (Manual Booking, New Service, FAQ, Manage, filter dropdowns on Bookings page) render in the UI but have **no `onClick` handler or execute no logic**.

3. **Bookings page filters are cosmetic:** The filter bar in `Bookings.tsx` renders buttons labeled "Upcoming", "All services", "All types", "All statuses" but they are **static `<Button>` components with no state management, no filter application logic, and no API query parameter integration**. They are purely decorative.

4. **Search on Bookings page is client-side only:** The search field filters already-fetched bookings on `booking_token`, `location_code`, and `order_id` — it does **not** search by customer name/email because those fields aren't included in the client-side filter logic, despite the placeholder text saying "Filter by customer name or email".

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
- **Medium Risk:** The "Mark as Completed" action transitions bookings to `RELEASED` status and attempts Shopify order fulfillment. This works correctly but lacks a confirmation of _success_ feedback to the user beyond the modal closing.
- **Low Risk:** Inventory capacity overrides use guarded SQL updates preventing overselling.

### Auth/Security
- **High Risk:** `SHOPIFY_API_SECRET` is managed as a Cloudflare secret (not in `wrangler.toml`). If misconfigured, all admin API calls fail with 401. The app has no graceful recovery UI for auth failures.
- **Medium Risk:** App Proxy signature verification is only enforced for `/agreement/sign` in production; all other proxy routes skip verification.
- **Low Risk:** CORS is set to `Access-Control-Allow-Origin: *` globally, which is overly permissive.

### UX Dead Ends
- **High:** Multiple prominent buttons (Manual Booking, Manage, New Service, FAQ, Bookings page filters) lead to dead ends.
- **Medium:** The Bookings page search says "Filter by customer name or email" but only searches booking_token, location_code, and order_id client-side.
- **Medium:** "Services availabilities" tab displays "coming soon" placeholder.
- **Low:** Calendar counts bookings by `start_date` only; bookings spanning multiple days appear only on the start day.

---

## Architecture Summary

The application is a **three-part system**:

1. **Cloudflare Worker** (`worker/`): The backend API and source of truth, using D1 (SQLite) with 6 migrations applied. Handles auth, webhooks, proxy (storefront), admin, and scheduled tasks.

2. **Vite React Admin SPA** (`apps/admin/`): The real admin dashboard, deployed to Cloudflare Pages. Embeds inside Shopify admin iframe. Uses App Bridge for session tokens, Polaris for UI. Talks to Worker via `VITE_WORKER_ADMIN_BASE_URL/admin/*`.

3. **Shopify Remix App** (`apps/shopify/mexican-golf-cart/`): OAuth entry point and Shopify CLI host. During `shopify app dev`, it serves the Vite admin SPA via the `dev-shopify-admin.sh` script. Its own route pages are all placeholders.

The admin SPA on the Dashboard page has **more advanced filter/search/export** functionality than the Bookings page, which lags behind significantly.

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

Milestone 3 (Booking Management Flow) is now the next implementation target.
