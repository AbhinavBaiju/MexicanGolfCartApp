# Test & Verification Plan

Manual test checklist and automated test recommendations derived from the audit findings.

## Implementation Status Notes (2026-02-07)

- M1 (Bookings parity) is implemented.
- M2 (Manual booking creation) is implemented.
- M3 (Booking management flow) is implemented.
- M4 (Dashboard polishing) is implemented.
- M5 (Shopify Remix cleanup) is implemented.
- M6 (Security & proxy hardening) is implemented.
- M7 (Testing & regression guardrails) is implemented.

Validation commands executed after M2:
- `npx tsc -p worker/tsconfig.json` (pass)
- `npm --workspace worker run test` (pass)
- `npm --workspace apps/admin run lint` (pass with one pre-existing warning in `apps/admin/src/pages/Agreement.tsx`)
- `npm --workspace apps/admin run build` (pass)

Re-validation executed on 2026-02-07 (post-audit):
- `npx tsc -p worker/tsconfig.json` (pass)
- `npm --workspace worker run test` (pass: 7 passed, 0 failed)
- `npm --workspace apps/admin run lint` (pass with the same pre-existing warning in `apps/admin/src/pages/Agreement.tsx:353`)
- `npm --workspace apps/admin run build` (pass)

M2 verification status: **signed off** (no M2 delta findings).

Validation commands executed after M3 implementation (2026-02-07):
- `npx tsc -p worker/tsconfig.json` (pass)
- `npm --workspace worker run test` (pass: 7 passed, 0 failed)
- `npm --workspace apps/admin run lint` (pass with the same pre-existing warning in `apps/admin/src/pages/Agreement.tsx:353`)
- `npm --workspace apps/admin run build` (pass)

M3 verification status: **implemented and validated** (no M1/M2 regression found in automated reruns).

Validation commands executed after M4 implementation (2026-02-07):
- `npx tsc -p worker/tsconfig.json` (pass)
- `npm --workspace worker run test` (pass: 7 passed, 0 failed)
- `npm --workspace apps/admin run lint` (pass with the same pre-existing warning in `apps/admin/src/pages/Agreement.tsx:353`)
- `npm --workspace apps/admin run build` (pass)

M4 verification status: **implemented and validated** (no M1/M2/M3 regression found in automated reruns).

Validation commands executed after M5 implementation (2026-02-07):
- `npm --workspace apps/shopify/mexican-golf-cart run lint` (pass with pre-existing warning in `extensions/rental-extension/assets/booking-widget.js:278`)
- `npm --workspace apps/shopify/mexican-golf-cart run build` (pass with pre-existing CSS minify warning from Polaris media query output)
- `npx tsc -p worker/tsconfig.json` (pass)
- `npm --workspace worker run test` (pass: 7 passed, 0 failed)
- `npm --workspace apps/admin run lint` (pass with the same pre-existing warning in `apps/admin/src/pages/Agreement.tsx:353`)
- `npm --workspace apps/admin run build` (pass)

M5 verification status: **implemented and validated** (no M1/M2/M3/M4 regression found in automated reruns).

Validation commands executed after M6 implementation (2026-02-07):
- `npx tsc -p worker/tsconfig.json` (pass)
- `npm --workspace worker run test` (pass: 11 passed, 0 failed)
- `npm --workspace apps/admin run lint` (pass with the same pre-existing warning in `apps/admin/src/pages/Agreement.tsx:353`)
- `npm --workspace apps/admin run build` (pass)

M6 verification status: **implemented and validated** (no M1-M5 regression found in automated reruns).

Validation commands executed after M7 implementation (2026-02-08):
- `npx tsc -p worker/tsconfig.json` (pass)
- `npm --workspace worker run test` (pass: 19 passed, 0 failed)
- `npm --workspace apps/admin run test` (pass: 10 passed, 0 failed)
- `npm --workspace apps/admin run lint` (pass with the same pre-existing warning in `apps/admin/src/pages/Agreement.tsx:353`)
- `npm --workspace apps/admin run build` (pass)

M7 verification status: **implemented and validated** (no M1-M6 regression found in automated reruns).

---

## 1. Manual Test Checklist

Organized by page/area. Each test case references the issue it validates.

### 1.1 Bookings Page

| # | Test Case | Steps | Expected Result | Issue Ref |
|---|---|---|---|---|
| M-01 | Filter buttons respond | Click each filter button (Upcoming, All services, All types, All statuses, Sort) | A dropdown or popover appears with selectable options | ISS-001 |
| M-02 | Filters modify booking list | Select a filter value → observe booking list | List updates to show only matching bookings | ISS-001 |
| M-03 | Export generates CSV | Click "Export" on Bookings page | Browser downloads a CSV file with current bookings | ISS-006 |
| M-04 | Manual booking button opens form | Click "+ Manual booking" | A modal or form appears for booking creation | ISS-002 |
| M-05 | Search by customer name | Type a known customer name in search | Matching bookings appear | ISS-004 |
| M-06 | Search by customer email | Type a known customer email in search | Matching bookings appear | ISS-004 |
| M-07 | Waitlist tab shows data | Click "Waitlist" tab | Either shows waitlisted bookings or tab is removed | ISS-021 |
| M-08 | Services availabilities tab | Click "Services availabilities" tab | Either shows availability data or tab is removed | ISS-011 |

### 1.2 BookingCard Component

| # | Test Case | Steps | Expected Result | Issue Ref |
|---|---|---|---|---|
| M-09 | Manage button opens detail | Click "Manage" on any booking card | A detail modal/page opens showing full booking info | ISS-003 |
| M-10 | Mark as Completed shows toast | Click "Mark as Completed" → "Yes, Complete" | Success toast appears; booking status updates to RELEASED | ISS-017 |
| M-11 | Mark as Completed failure feedback | Trigger a failure (e.g., network error) | Error toast or message appears | ISS-017 |
| M-12 | Date display correctness | Check a booking with known start_date | Displayed date matches the start_date (no off-by-one) | ISS-013 |

### 1.3 Dashboard Page

| # | Test Case | Steps | Expected Result | Issue Ref |
|---|---|---|---|---|
| M-13 | FAQ button response | Click "FAQ" | Opens FAQ content or navigates to help page | ISS-005 |
| M-14 | New service button response | Click "+ New service" | Opens product config form or navigates to Inventory | ISS-005 |
| M-15 | Service filter labels | Open "All services" filter dropdown | Options show human-readable product titles, not numeric IDs | ISS-018 |
| M-16 | Location filter label | Open the location filter dropdown on Dashboard | Default label is "All locations" and options are locations | ISS-010 |
| M-17 | Calendar multi-day bookings | Create a booking spanning 3+ days → view calendar | All days in range show booking count, not just start date | ISS-012 |
| M-18 | Dashboard export works | Apply filters → click "Export" | CSV downloads with filtered data | — |

### 1.4 Products Page

| # | Test Case | Steps | Expected Result | Issue Ref |
|---|---|---|---|---|
| M-19 | Legacy `/products` route behavior | Navigate to `/products` in admin SPA | Route redirects to `/inventory` | ISS-007 |
| M-20 | No dead standalone Products page | Inspect admin routes/files | No standalone `Products.tsx` page is required for active flow | ISS-007 |

### 1.5 Agreement Page

| # | Test Case | Steps | Expected Result | Issue Ref |
|---|---|---|---|---|
| M-21 | Upload PDF agreement | Upload a PDF file | Agreement saved, preview renders | — |
| M-22 | Set signature placement | Drag signature box on PDF page | Placement saved (x, y, width, height normalized to 0–1) | — |
| M-23 | View signed agreement | Click "View agreement" on a booking with signature | Signed agreement detail shows with signature overlay | — |

### 1.6 Inventory Page

| # | Test Case | Steps | Expected Result | Issue Ref |
|---|---|---|---|---|
| M-24 | Link a Shopify product | Click "Link Product" → select product | Product config created in D1 with default capacity | — |
| M-25 | Edit product capacity | Change capacity → save | Capacity updated; calendar reflects new availability | — |
| M-26 | Set daily overrides | Set specific day capacity → save | Override saved; availability check respects new value | — |

### 1.7 Security

| # | Test Case | Steps | Expected Result | Issue Ref |
|---|---|---|---|---|
| M-27 | CORS restricted | Make XHR from non-admin origin to `/admin/bookings` | Request blocked by CORS (not wildcard `*`) | ISS-014 |
| M-28 | Proxy signature enforced | Call `/proxy/hold` without going through Shopify App Proxy | Request rejected (401/403) | ISS-015 |
| M-29 | JWT required for admin | Call `/admin/bookings` without Bearer token | Response: 401 "Missing session token" | — |
| M-30 | Webhook HMAC enforced | POST to `/webhooks/orders-paid` with invalid HMAC | Response: 401 | — |

### 1.8 Shopify App (Remix)

| # | Test Case | Steps | Expected Result | Issue Ref |
|---|---|---|---|---|
| M-31 | No template demo code | Navigate to Remix `/app` route | Route redirects to `/bookings`; no "Generate a product" action appears | ISS-008 |
| M-32 | Remix routes cleaned up | Navigate to `/app/bookings`, `/app/inventory`, `/app/products`, `/app/locations` | Routes redirect to `/bookings`, `/inventory`, `/inventory`, `/locations` respectively | ISS-009 |

---

## 2. Automated Test Recommendations

### 2.1 Existing Test Coverage

Current test files found:
- [worker/tests/admin.test.ts](worker/tests/admin.test.ts) — Admin endpoint tests
- [worker/tests/bookings-filters.test.ts](worker/tests/bookings-filters.test.ts) — Admin bookings filter/status/timezone query tests
- [worker/tests/capacity-conflicts.test.ts](worker/tests/capacity-conflicts.test.ts) — hold/manual-booking atomic conflict tests
- [worker/tests/date.test.ts](worker/tests/date.test.ts) — Date utility tests
- [worker/tests/proxy-auth.test.ts](worker/tests/proxy-auth.test.ts) — Proxy signature enforcement mode tests
- [worker/tests/webhook-idempotency.test.ts](worker/tests/webhook-idempotency.test.ts) — webhook duplicate-event idempotency test
- [apps/admin/src/components/__tests__/](apps/admin/src/components/__tests__/) — Component tests directory
- [apps/admin/src/pages/__tests__/](apps/admin/src/pages/__tests__/) — Page/query helper regression tests

### 2.2 Priority Test Additions

#### P0: Backend Endpoint Tests (Worker)

| Test File | What to Test | Why |
|---|---|---|
| `tests/bookings.test.ts` | `GET /admin/bookings` with all filter combinations | Filters are the #1 broken feature — backend works but frontend doesn't use it. Tests ensure backend stays correct during frontend fixes. |
| `tests/bookings.test.ts` | `GET /admin/bookings?status=WAITLIST` | Verify behavior when DB doesn't support WAITLIST status. |
| `tests/bookings.test.ts` | `POST /admin/bookings/:token/complete` when fulfillment fails | Verify response shape and DB state consistency. |
| `tests/inventory.test.ts` | `PUT /admin/inventory` with `reserved_qty > new_capacity` | Verify 409 conflict response. |
| `tests/proxy.test.ts` | `POST /proxy/hold` atomic capacity check | Verify no overselling under concurrent holds. |
| `tests/proxy.test.ts` | Proxy signature verification | Verify all proxy routes check HMAC in production mode. |

#### P1: Frontend Component Tests (Admin)

| Test File | What to Test | Why |
|---|---|---|
| `BookingCard.test.tsx` | "Manage" button opens detail modal and fetches `/admin/bookings/:token` | Prevents regression in the M3 booking management flow. |
| `BookingCard.test.tsx` | Date formatting for timezone safety | Verify dates don't shift by one day. |
| `BookingsCalendar.test.tsx` | Multi-day booking counting | Verify all days in range show counts. |
| `Bookings.test.tsx` | Filter buttons render with handlers | Verify each filter button has an `onClick`. |
| `Dashboard.test.tsx` | Service filter shows product titles | Verify labels are human-readable. |

#### P2: Integration/E2E Tests

| Test | What to Test | Why |
|---|---|---|
| Hold → Confirm flow | Create hold via proxy → trigger `orders/paid` webhook → verify `CONFIRMED` | Core business flow end-to-end. |
| Hold expiry | Create hold → wait → verify cron expires it → verify `reserved_qty` decremented | Critical for inventory correctness. |
| Agreement signing | Upload agreement → set placement → sign via proxy → verify in admin | Full agreement lifecycle. |
| Embedded admin SPA | Load admin SPA inside Shopify admin iframe | Verify App Bridge initialization, JWT auth, and API calls work. |

### 2.3 Test Infrastructure Gaps

| Gap | Recommendation |
|---|---|
| No D1 test doubles | Use Miniflare's D1 support for worker integration tests, or maintain an in-memory SQLite fixture. |
| D1 mock fidelity is limited | Consider Miniflare D1 or local SQLite-backed integration fixtures for full SQL behavior assertions. |
| No E2E framework | The `e2e/` directory exists but is empty. Consider Playwright for testing the embedded admin SPA flow. |
| No CI pipeline visible | Add GitHub Actions workflow: `lint → type-check → unit tests → build → deploy preview`. |

---

## 3. Regression Test Matrix

After each issue fix, run these verification tests:

| Issue Fixed | Regression Tests |
|---|---|
| ISS-001 (Bookings filters) | M-01, M-02 + verify Dashboard filters still work |
| ISS-002 (Manual booking) | M-04 + verify booking appears in list + inventory decremented |
| ISS-003 (Manage button) | M-09 + verify no impact on "Mark as Completed" |
| ISS-004 (Search) | M-05, M-06 + verify existing `booking_token` search still works |
| ISS-012 (Calendar counts) | M-17 + verify Dashboard stats unchanged |
| ISS-008/ISS-009 (Remix cleanup) | M-31, M-32 + verify `NavMenu` links open real SPA paths |
| ISS-014 (CORS) | M-27 + verify admin SPA still works from allowed origin |
| ISS-015 (Proxy signatures) | M-28 + verify storefront widget still works through App Proxy |
| ISS-016 (Per-shop timezone) | M-04, M-17 + confirm lead-time/date rules match each shop timezone |
| ISS-020 (API version consistency) | Run worker tests + spot-check webhook registration/fulfillment/graphql endpoints use centralized version constant |
| ISS-021 (WAITLIST) | M-07 + verify other status tabs unaffected |

---

## 4. Smoke Test Script (Post-Deploy)

Quick verification after each deployment:

```
1. Open admin SPA in Shopify admin
2. Verify Dashboard loads (stats, calendar, recent bookings)
3. Navigate to Bookings → verify booking list loads
4. Navigate to Inventory → verify product config loads
5. Navigate to Locations → verify location list loads
6. Open storefront → verify date picker widget loads
7. Select dates → verify availability check returns
8. Complete a hold → verify booking appears in admin
```

Estimated time: 5–8 minutes manual, or automate with Playwright.
