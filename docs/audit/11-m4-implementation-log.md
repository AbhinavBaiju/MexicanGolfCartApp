# Milestone 4 Implementation Log (Dashboard Polishing)

**Date completed:** 2026-02-07  
**Scope:** M4 from `docs/audit/context-milestones.md`  
**Primary files changed:**
- `apps/admin/src/pages/Dashboard.tsx`
- `apps/admin/src/pages/Bookings.tsx`
- `apps/admin/src/App.tsx`
- `apps/admin/package.json`
- `package-lock.json`

## Summary of What Was Implemented

Milestone 4 goals were implemented for ISS-005, ISS-010, ISS-018, ISS-019, and ISS-007:

1. Wired Dashboard `FAQ` and `New service` buttons.
2. Renamed/fixed the Dashboard location filter label from teammates to locations.
3. Replaced numeric service filter labels with Shopify product titles (fallback to `Service <id>` when title is unavailable).
4. Removed confirmed dead code and unused dependencies.
5. Resolved the `/products` route/dead-code decision with a route redirect and page-file removal.

## Detailed Change Log

### 1) ISS-005: Dashboard `FAQ` and `New service` Actions Wired

- `apps/admin/src/pages/Dashboard.tsx`
  - Added `onClick` handler for `FAQ` button to open help content in a new tab (`VITE_DASHBOARD_FAQ_URL` with fallback).
  - Added `onClick` handler for `New service` button to navigate to `/inventory`.
  - Updated footer help/FAQ links from `#` placeholders to real URLs.

### 2) ISS-010: "All teammates" Relabeled to Location Semantics

- `apps/admin/src/pages/Dashboard.tsx`
  - Renamed filter state/options from teammate-oriented naming to location-oriented naming (`selectedLocation`, `locationOptions`).
  - Updated default label to `All locations`.
  - Preserved backend query behavior (`location_code`) and location option source (`GET /admin/locations`).

### 3) ISS-018: Service Labels Use Product Titles

- `apps/admin/src/pages/Dashboard.tsx`
  - Service filter now cross-references `GET /admin/products` IDs with `GET /admin/shopify-products` titles.
- `apps/admin/src/pages/Bookings.tsx`
  - Applied the same service title mapping for Bookings page service filter options.
- Fallback behavior retained for resiliency:
  - If title is unavailable, label falls back to `Service <product_id>`.

### 4) ISS-019: Dead Code and Unused Dependencies Removed

- Removed dead files:
  - `apps/admin/src/components/DashboardChart.tsx`
  - `apps/admin/src/pages/Products.tsx`
- Removed unused dependencies from `apps/admin/package.json`:
  - `recharts`
  - `@shopify/app-bridge-utils`
- Regenerated lockfile entries via uninstall:
  - `package-lock.json`

### 5) ISS-007: Products Route Decision Resolved

- `apps/admin/src/App.tsx`
  - Added explicit route handling:
    - `/products` now redirects to `/inventory` (`<Navigate to="/inventory" replace />`).
- Standalone Products page implementation was removed as dead/unrouted code in favor of the active Inventory-based product configuration flow.

## Validation Performed (Post-M4)

1. `npx tsc -p worker/tsconfig.json`
- Output: none
- Result: **PASS** (exit code 0)

2. `npm --workspace worker run test`
- Result: **PASS**
```text
> worker@0.0.0 test
> node --test --import tsx

✔ signed agreement with signature_png_base64 present should be valid (1.081958ms)
✔ signed agreement with empty signature_png_base64 should be valid (0.053833ms)
✔ signed agreement with missing id should be invalid (0.042875ms)
✔ signed agreement with both id and empty signature should be valid (0.036625ms)
✔ STORE_TIMEZONE is fixed to America/Mazatlan (0.435625ms)
✔ getTodayInTimeZone respects store timezone date boundary (35.285541ms)
✔ getTodayInTimeZone formats dates as YYYY-MM-DD (0.102958ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 181.992709
```

3. `npm --workspace apps/admin run lint`
- Result: **PASS with warning**
```text
> admin@0.0.0 lint
> eslint .

/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/apps/admin/src/pages/Agreement.tsx
  353:6  warning  React Hook useMemo has an unnecessary dependency: 'pdfRendering'. Either exclude it or remove the dependency array  react-hooks/exhaustive-deps

✖ 1 problem (0 errors, 1 warning)
```
- Warning is pre-existing and unchanged from prior milestones.

4. `npm --workspace apps/admin run build`
- Result: **PASS**
```text
> admin@0.0.0 build
> tsc -b && vite build

vite v7.3.1 building client environment for production...
transforming...
✓ 1126 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                              0.83 kB │ gzip:   0.43 kB
dist/assets/pdf.worker.min-LyOxJPrg.mjs  1,072.84 kB
dist/assets/index-MUildqM1.css             441.52 kB │ gzip:  52.26 kB
dist/assets/vendor-N--QU9DW.js             140.91 kB │ gzip:  45.27 kB
dist/assets/polaris-aXngc2rT.js            327.77 kB │ gzip:  75.07 kB
dist/assets/index-BsjEq1W5.js              522.14 kB │ gzip: 154.03 kB
✓ built in 1.27s
```

## Regression/Scope Notes

- No backend booking or inventory reservation logic changed in M4.
- D1 remains source of truth; no client-authoritative booking/inventory logic was added.
- No-overselling protections (fail-fast atomic reservation/override patterns) are unchanged.
- M1/M2/M3 behavior remains intact in worker/admin validation reruns.

## Issues Covered by This Milestone

- ISS-005: fixed
- ISS-010: fixed (location label/behavior alignment path)
- ISS-018: fixed
- ISS-019: fixed
- ISS-007: resolved via dead-code removal + route redirect decision

## Out of Scope / Remaining

- ISS-008 / ISS-009 (Remix placeholder cleanup)
- ISS-014 / ISS-015 / ISS-016 / ISS-020 (security/timezone/API version hardening)
