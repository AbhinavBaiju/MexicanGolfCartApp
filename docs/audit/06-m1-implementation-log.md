# Milestone 1 Implementation Log (Bookings Page Parity)

**Date completed:** 2026-02-08  
**Scope:** M1 from `docs/audit/context-milestones.md`  
**Primary file changed:** `apps/admin/src/pages/Bookings.tsx`

## Summary of What Was Implemented

Milestone 1 goals from the audit docs were completed on the Bookings page:

1. Replaced non-functional filter controls with working controls.
2. Migrated search from client-only filtering to backend `search` query usage.
3. Wired sort and export actions.
4. Removed dead tabs (`Waitlist`, `Services availabilities`) to align with backend/schema reality.

## Detailed Change Log

### 1) Functional Filter Bar Added

The Bookings page now uses an in-file `FilterPopover` component (Polaris `Popover + ActionList`) and persistent state for:

- `upcomingOnly` (maps to `date_preset=upcoming`)
- `selectedService` (maps to `product_id`)
- `selectedType` (maps to `fulfillment_type`)
- `selectedStatus` (maps to `status`)
- `sortDirection` (maps to `sort_direction=asc|desc`)

Service filter options are loaded from `GET /admin/products` through `useAuthenticatedFetch('/products')`.

### 2) Search Converted to Server-Side Query Param

Added `debouncedSearch` (350ms debounce) and passed it to `loadBookings(search)` which sends:

- `search=<trimmedQuery>`

This resolves the previous mismatch where the UI claimed name/email search but only filtered local fields.

### 3) Bookings Fetch Logic Reworked

`loadBookings` now constructs URL params from tab + filter state and sends one backend request to `/admin/bookings`.

Tab → status mapping:

- Bookings: `CONFIRMED`
- Canceled: `CANCELLED`
- Pre-payment: `HOLD`
- Abandoned: `EXPIRED`
- Calendar tab: no status restriction (for broader calendar data), still sorted.

### 4) Export Button Implemented

Export now generates CSV from currently loaded Bookings page rows with columns:

- booking_token
- status
- customer_name
- customer_email
- location_code
- start_date
- end_date
- order_id
- fulfillment_type
- service_product_ids
- service_count
- has_upsell
- revenue

### 5) WAITLIST Decision Applied

Per ISS-021 and M1 instructions, WAITLIST was dropped from UI:

- Removed `Waitlist` tab.
- Removed `WAITLIST` tab-to-status mapping in Bookings page.

Reason: `bookings` schema CHECK constraint (migration `worker/migrations/0001_schema.sql`) does not allow `WAITLIST`.

### 6) Services Availability Placeholder Removed

Per ISS-011 and M1 instructions, removed:

- `Services availabilities` tab.
- "coming soon" placeholder view.

## Validation Performed

Executed:

- `npm --workspace apps/admin run build` (pass)
- `npm --workspace apps/admin run lint` (pass with one pre-existing warning in `apps/admin/src/pages/Agreement.tsx`)

Warning observed (not introduced by M1 changes):

- `Agreement.tsx` React Hook dependency warning (`react-hooks/exhaustive-deps`).

## Issues Covered by This Milestone

- ISS-001: fixed
- ISS-004: fixed
- ISS-006: fixed
- ISS-011: resolved by removal of placeholder tab
- ISS-021: resolved on UI path by removing WAITLIST tab (no DB migration added)

## Out of Scope / Remaining

- ISS-002 (Manual booking): not implemented yet. `+ Manual booking` button still has no `onClick`.
- ISS-003 / ISS-017 / ISS-013 / ISS-012: not part of M1.
- Service labels still use numeric IDs (`Service <id>`), tracked by ISS-018 (M4 scope).

## Next Milestone Start Point (M2)

Implement manual booking creation end-to-end:

1. Worker: add `POST /admin/bookings` endpoint.
2. Reuse hold/capacity validation logic from `worker/src/proxy.ts` (`handleHold` flow).
3. Ensure atomic `inventory_day` reservation updates and store-timezone validation.
4. Admin SPA: wire `+ Manual booking` to open modal/form and submit to new endpoint.
5. Add success/error toast behavior after creation.
