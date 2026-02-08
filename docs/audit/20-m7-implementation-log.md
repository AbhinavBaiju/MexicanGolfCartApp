# Milestone 7 Implementation Log (Testing & Regression Guardrails)

**Date completed:** 2026-02-08  
**Scope:** M7 from `docs/audit/context-milestones.md`  
**Primary files changed:**
- `worker/tests/bookings-filters.test.ts` (new)
- `worker/tests/capacity-conflicts.test.ts` (new)
- `worker/tests/webhook-idempotency.test.ts` (new)
- `worker/tests/proxy-auth.test.ts`
- `worker/tests/helpers/mockD1.ts` (new)
- `worker/src/admin.ts`
- `apps/admin/package.json`
- `apps/admin/vitest.config.ts` (new)
- `apps/admin/src/test/setup.ts` (new)
- `apps/admin/src/components/__tests__/BookingCard.test.tsx` (new)
- `apps/admin/src/components/__tests__/BookingsCalendar.test.ts` (new)
- `apps/admin/src/components/bookingsCalendarUtils.ts` (new)
- `apps/admin/src/pages/__tests__/Bookings.query.test.ts` (new)
- `apps/admin/src/pages/__tests__/Dashboard.query.test.ts` (new)
- `apps/admin/src/pages/bookingsQuery.ts` (new)
- `apps/admin/src/pages/dashboardQuery.ts` (new)
- `apps/admin/src/components/BookingsCalendar.tsx`
- `apps/admin/src/pages/Bookings.tsx`
- `apps/admin/src/pages/Dashboard.tsx`
- `package-lock.json`

## Summary of What Was Implemented

Milestone 7 backlog items were implemented across backend and frontend with practical integration-level guardrails:

1. Added targeted backend P0 tests for bookings filter/status handling, proxy signature behavior, inventory conflict behavior, and timezone-driven booking date filters.
2. Added focused frontend P1 regression tests (Vitest + Testing Library) for Bookings query mapping, Dashboard query/service-label mapping, BookingCard manage flow/date display, and BookingsCalendar multi-day counting.
3. Added practical P2 integration-style regression paths in current workspace constraints:
   - webhook idempotency duplicate-event path via `confirmBookingsFromOrder(...)`
   - route-level atomic conflict behavior for hold/manual-booking flows.

## Detailed Change Log

### 1) Backend P0 Coverage Added

- `worker/tests/bookings-filters.test.ts`
  - verifies invalid status rejection (`400`)
  - verifies `status=WAITLIST` is accepted by parser and bound into SQL
  - verifies `date_preset=upcoming` binds `getTodayInTimeZone(auth.shopTimezone)` (per-shop timezone behavior)

- `worker/tests/proxy-auth.test.ts`
  - kept existing all-route missing-signature enforcement checks
  - added explicit invalid-signature rejection check
  - added valid-signature acceptance check (request proceeds past auth gate in production mode)

- `worker/tests/capacity-conflicts.test.ts`
  - verifies `POST /proxy/hold` returns `409` + `"Insufficient capacity"` when atomic reservation batch fails
  - verifies `POST /admin/bookings` returns `409` + `"Insufficient capacity"` on the same fail-fast pattern

- `worker/src/admin.ts`
  - added test-only exports:
    - `__testHandleBookingsGet(...)`
    - `__testHandleBookingsPost(...)`
    - `__resetAdminSchemaCache()`
  - these are thin wrappers around existing logic; runtime business behavior unchanged

- `worker/tests/helpers/mockD1.ts`
  - added reusable deterministic D1 mock controller for statement-level assertions and error-path simulation

### 2) Frontend P1 Coverage Added

- Added test runner/config:
  - `apps/admin/package.json` (`test` script + Vitest/testing deps)
  - `apps/admin/vitest.config.ts`
  - `apps/admin/src/test/setup.ts` (DOM/polyfill setup for Polaris/jsdom)

- Added regression tests:
  - `apps/admin/src/pages/__tests__/Bookings.query.test.ts`
    - validates Bookings tab/status mapping and query-param construction behavior
  - `apps/admin/src/pages/__tests__/Dashboard.query.test.ts`
    - validates Dashboard bookings query-param mapping
    - validates service label mapping with Shopify-title fallback behavior
  - `apps/admin/src/components/__tests__/BookingCard.test.tsx`
    - verifies Manage action fetches `/bookings/:token`
    - verifies timezone-safe display date rendering
  - `apps/admin/src/components/__tests__/BookingsCalendar.test.ts`
    - verifies inclusive day-span counting and month overlap counting

- Refactors to enable stable testing without behavior changes:
  - extracted Bookings query construction logic to `apps/admin/src/pages/bookingsQuery.ts`
  - extracted Dashboard query/service-option mapping to `apps/admin/src/pages/dashboardQuery.ts`
  - extracted BookingsCalendar range helpers to `apps/admin/src/components/bookingsCalendarUtils.ts`

### 3) Practical P2 Integration Paths Added

- `worker/tests/webhook-idempotency.test.ts`
  - verifies duplicate webhook event IDs short-circuit as idempotent (`Duplicate webhook event`)
  - verifies duplicate path does not attempt a new insert into `webhook_events`

- Route-level integration-style checks:
  - hold/manual-booking conflict tests execute handler entry points and validate expected HTTP contract on atomic-failure paths.

## Validation Performed (Post-M7)

1. `npx tsc -p worker/tsconfig.json`
- Result: **PASS** (no output, exit code `0`)

2. `npm --workspace worker run test`
- Result: **PASS** (`19 passed, 0 failed`)
```text
> worker@0.0.0 test
> node --test --import tsx
...
✔ tests 19
✔ pass 19
✔ fail 0
```

3. `npm --workspace apps/admin run test`
- Result: **PASS** (`10 passed, 0 failed`)
```text
> admin@0.0.0 test
> vitest run
...
Test Files  4 passed (4)
Tests  10 passed (10)
```

4. `npm --workspace apps/admin run lint`
- Result: **PASS with warning**
```text
apps/admin/src/pages/Agreement.tsx
353:6 warning react-hooks/exhaustive-deps
```
- Warning is pre-existing and unchanged.

5. `npm --workspace apps/admin run build`
- Result: **PASS**
```text
> admin@0.0.0 build
> tsc -b && vite build
...
✓ built in 6.67s
```

## Regression/Constraint Notes

- Backend D1 remains source of truth.
- No client-authoritative business logic was added.
- No-overselling fail-fast atomic reservation behavior remains unchanged and now has direct conflict-path tests.
- Webhook idempotency guarantees are preserved and now explicitly regression-tested.
- Strict TypeScript maintained in new code (no new `any` added).

## Delta Findings

- No new functional regressions found in M1-M6 scope during M7 validation runs.
- Full browser/Shopify embedded E2E (Playwright inside Shopify admin iframe) is still not wired in this workspace; M7 adds practical handler-level integration guardrails as the current high-value feasible path.
