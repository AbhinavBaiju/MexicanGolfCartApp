# Milestone 5 Implementation Log (Shopify Remix Cleanup)

**Date completed:** 2026-02-07  
**Scope:** M5 from `docs/audit/context-milestones.md`  
**Primary files changed:**
- `apps/shopify/mexican-golf-cart/app/routes/app.tsx`
- `apps/shopify/mexican-golf-cart/app/routes/app._index.tsx`
- `apps/shopify/mexican-golf-cart/app/routes/app.bookings.tsx`
- `apps/shopify/mexican-golf-cart/app/routes/app.inventory.tsx`
- `apps/shopify/mexican-golf-cart/app/routes/app.products.tsx`
- `apps/shopify/mexican-golf-cart/app/routes/app.locations.tsx`
- `apps/shopify/mexican-golf-cart/app/utils/adminSpaRedirect.server.ts` (new)

## Summary of What Was Implemented

Milestone 5 goals were implemented for ISS-008 and ISS-009:

1. Removed the Shopify Remix template demo action ("Generate a product") from `app._index`.
2. Replaced placeholder Remix routes with production-safe redirects to real admin SPA paths.
3. Updated Remix `NavMenu` links to align with actual admin SPA route paths.
4. Preserved existing architecture where the Cloudflare Pages SPA is the admin UI and Worker/D1 remains source of truth.

## Detailed Change Log

### 1) ISS-008: Template Demo Behavior Removed from `app._index`

- File: `apps/shopify/mexican-golf-cart/app/routes/app._index.tsx`
- Changes:
  - Removed the template GraphQL product creation action and all demo UI content.
  - Route now exports a loader that redirects to admin SPA entry path (`/bookings`).
  - Redirect target intentionally avoids `/` to prevent Remix root-route redirect loops when `shop` query params are present.

### 2) ISS-009: Placeholder Remix Routes Replaced with Redirects

- Files:
  - `app.bookings.tsx`
  - `app.inventory.tsx`
  - `app.products.tsx`
  - `app.locations.tsx`
- Changes:
  - Replaced placeholder Polaris pages with loader-based redirects:
    - `/app/bookings` -> `/bookings`
    - `/app/inventory` -> `/inventory`
    - `/app/products` -> `/inventory` (matches existing admin SPA `/products` legacy redirect)
    - `/app/locations` -> `/locations`

### 3) Remix Nav Alignment to Real SPA Paths

- File: `apps/shopify/mexican-golf-cart/app/routes/app.tsx`
- Changes:
  - Updated `NavMenu` links from `/app/*` placeholders to real SPA paths:
    - `/` (Dashboard)
    - `/bookings`
    - `/inventory`
    - `/locations`
    - `/agreement`

### 4) Redirect Utility Added for Safe Consistency

- New file: `apps/shopify/mexican-golf-cart/app/utils/adminSpaRedirect.server.ts`
- Purpose:
  - Centralize SPA redirect behavior for all Remix app routes.
  - Preserve embedded query params while dropping Remix internal params (`_data`, `index`).
  - Support optional environment base URL (`ADMIN_SPA_BASE_URL` fallback to `SHOPIFY_APP_URL`, then request origin).

## Validation Performed (Post-M5)

1. `npm --workspace apps/shopify/mexican-golf-cart run lint`
- Result: **PASS with warning**
```text
> lint
> eslint --cache --cache-location ./node_modules/.cache/eslint .

⚠️ REMIX FUTURE CHANGE: The `@remix-run/eslint-config` package is deprecated and will not be included in React Router v7.  We recommend moving towards a streamlined ESLint config such as the ones included in the Remix templates. See https://github.com/remix-run/remix/blob/v2/templates/remix/.eslintrc.cjs.

/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/apps/shopify/mexican-golf-cart/extensions/rental-extension/assets/booking-widget.js
  278:18  warning  'showFatalError' is defined but never used  no-unused-vars

✖ 1 problem (0 errors, 1 warning)
```
- Warning is outside M5 route cleanup scope and pre-existing.

2. `npm --workspace apps/shopify/mexican-golf-cart run build`
- Result: **PASS with warning**
```text
> build
> remix vite:build

vite v6.4.1 building for production...
transforming...
✓ 2472 modules transformed.
Generated an empty chunk: "webhooks.app.scopes_update".
Generated an empty chunk: "webhooks.app.uninstalled".
Generated an empty chunk: "auth._".
rendering chunks...
[esbuild css minify]
▲ [WARNING] Expected "(" but found "print" [css-syntax-error]

    <stdin>:8293:35:
      8293 │ @media (--p-breakpoints-md-up) and print{
           │                                    ~~~~~
           ╵                                    (

... (client bundle output omitted for brevity in this log section)

✓ built in 1.41s
vite v6.4.1 building SSR bundle for production...
transforming...
✓ 24 modules transformed.
[esbuild css minify]
▲ [WARNING] Expected "(" but found "print" [css-syntax-error]
... 
✓ built in 66ms
```
- CSS warning is pre-existing and did not block build output.

3. `npx tsc -p worker/tsconfig.json`
- Result: **PASS** (no output, exit code 0)

4. `npm --workspace worker run test`
- Result: **PASS** (7 passed, 0 failed)
```text
> worker@0.0.0 test
> node --test --import tsx

✔ signed agreement with signature_png_base64 present should be valid (1.120209ms)
✔ signed agreement with empty signature_png_base64 should be valid (0.052125ms)
✔ signed agreement with missing id should be invalid (0.043292ms)
✔ signed agreement with both id and empty signature should be valid (0.036792ms)
✔ STORE_TIMEZONE is fixed to America/Mazatlan (0.43325ms)
✔ getTodayInTimeZone respects store timezone date boundary (13.203584ms)
✔ getTodayInTimeZone formats dates as YYYY-MM-DD (0.110625ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 163.410084
```

5. `npm --workspace apps/admin run lint`
- Result: **PASS with warning**
```text
> admin@0.0.0 lint
> eslint .

/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/apps/admin/src/pages/Agreement.tsx
  353:6  warning  React Hook useMemo has an unnecessary dependency: 'pdfRendering'. Either exclude it or remove the dependency array  react-hooks/exhaustive-deps

✖ 1 problem (0 errors, 1 warning)
```
- Warning is pre-existing and unchanged from earlier milestones.

6. `npm --workspace apps/admin run build`
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
✓ built in 1.14s
```

## Additional Delta Finding

Diagnostic command:
- `npx tsc -p apps/shopify/mexican-golf-cart/tsconfig.json --noEmit`

Result:
- **FAIL** with a pre-existing Vite plugin type mismatch between root and nested workspace Vite type packages in `apps/shopify/mexican-golf-cart/vite.config.ts`.
- This was not introduced by M5 route changes (no `vite.config.ts` changes in this milestone), but should be tracked as a tooling consistency follow-up.

## Regression/Scope Notes

- No worker booking/inventory logic changed in M5.
- D1 remains source of truth.
- No-overselling and atomic reservation patterns are unchanged.
- M1-M4 behaviors remained intact in post-M5 validation reruns.

## Issues Covered by This Milestone

- ISS-008: fixed
- ISS-009: fixed

## Remaining Milestone Scope

- M6 security/timezone/API-version hardening remains:
  - ISS-014, ISS-015, ISS-016, ISS-020
