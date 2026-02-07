# Milestone 2 Implementation Log (Manual Booking Creation)

**Date completed:** 2026-02-07  
**Scope:** M2 from `docs/audit/context-milestones.md`  
**Primary files changed:**
- `worker/src/admin.ts`
- `apps/admin/src/pages/Bookings.tsx`

## Summary of What Was Implemented

Milestone 2 goals from the audit docs were implemented end-to-end:

1. Added backend `POST /admin/bookings` for manual booking creation.
2. Reused/ported hold-style validation and fail-fast inventory reservation logic from proxy flow.
3. Added a manual-booking modal form to the Bookings page.
4. Wired frontend submission to the new endpoint with success/error toast feedback.

## Detailed Change Log

### 1) Backend: `POST /admin/bookings` Added

In `worker/src/admin.ts`, the `/admin/bookings` route now supports `POST`:

- New handler: `handleBookingsPost(...)`.
- New parsing/normalization helpers:
  - `parseManualBookingBody(...)`
  - `normalizeManualBookingItems(...)`

### 2) Backend Validation & Business Rules

The new endpoint enforces:

- Required fields: `start_date`, `end_date`, `location`, `items[]`.
- Item validation: `product_id`, `variant_id` (if provided), `qty >= 1`.
- Fulfillment validation:
  - `fulfillment_type` is `Pick Up` or `Delivery`.
  - `delivery_address` is required when `fulfillment_type = Delivery`.
- Date validation in store timezone (`America/Mazatlan` via existing config usage):
  - `start_date <= end_date`
  - lead time rules from `locations.lead_time_days`
  - minimum duration rules from `locations.min_duration_days`

### 3) Backend Atomic Reservation (Fail-Fast SQL)

Manual booking creation now uses the same atomic reservation strategy as proxy holds:

- `INSERT OR IGNORE` for `inventory_day` rows.
- Guarded `UPDATE inventory_day ... reserved_qty + qty <= capacity`.
- Immediate assertion `SELECT CASE WHEN changes() = 1 THEN 1 ELSE 1/0 END`.
- On any capacity conflict, the batch fails and no partial reservation is persisted.
- Conflict path returns `409` with `"Insufficient capacity"`.

On success, the endpoint creates:

- `bookings` row (`status = 'CONFIRMED'`)
- `booking_items` rows
- `booking_days` rows

### 4) Frontend: Manual Booking Modal Wired in `Bookings.tsx`

The `+ Manual booking` button is now functional:

- Opens a modal form.
- Loads required options from backend APIs:
  - `GET /admin/products`
  - `GET /admin/locations`
  - `GET /admin/shopify-products`
- Supports selection/input for:
  - customer name/email (optional)
  - location
  - start/end dates
  - product
  - variant
  - quantity
  - fulfillment type + delivery address

Submit action:

- Calls `POST /admin/bookings`.
- Shows success/error toast feedback via Shopify App Bridge global toast API.
- Refreshes bookings list after successful creation.

## Validation Performed

Executed:

- `npx tsc -p worker/tsconfig.json` (pass)
- `npm --workspace worker run test` (pass)
- `npm --workspace apps/admin run lint` (pass with one pre-existing warning in `apps/admin/src/pages/Agreement.tsx`)
- `npm --workspace apps/admin run build` (pass)

Pre-existing lint warning (not introduced by M2 changes):

- `Agreement.tsx` React Hook dependency warning (`react-hooks/exhaustive-deps`).

## Issues Covered by This Milestone

- ISS-002: fixed

## Out of Scope / Remaining

- ISS-003 (`Manage` flow), ISS-017 (completion toast), ISS-013 (timezone-safe date rendering in BookingCard), and other M3+ items remain.

## Next Milestone Start Point (M3)

1. Add booking detail management flow and wire `Manage` button.
2. Add completion success/error toast handling for `POST /admin/bookings/:token/complete`.
3. Improve date rendering/calendar span behavior for timezone-safe display and multi-day counts.
