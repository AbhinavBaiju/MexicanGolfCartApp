# Milestone 6 Implementation Log (Security & Proxy Hardening)

**Date completed:** 2026-02-07  
**Scope:** M6 from `docs/audit/context-milestones.md`  
**Primary files changed:**
- `worker/src/index.ts`
- `worker/src/proxy.ts`
- `worker/src/auth.ts`
- `worker/src/admin.ts`
- `worker/src/bookingService.ts`
- `worker/src/config.ts`
- `worker/src/types.ts`
- `worker/wrangler.toml`
- `worker/tests/date.test.ts`
- `worker/tests/proxy-auth.test.ts` (new)

## Summary of What Was Implemented

Milestone 6 goals were implemented for ISS-014, ISS-015, ISS-016, and ISS-020:

1. Restricted admin API CORS in production-like environments to trusted admin origin(s), with explicit dev compatibility behavior.
2. Enforced Shopify App Proxy signature verification for all `/proxy/*` routes in production-like environments.
3. Persisted shop timezone during OAuth (`shop.iana_timezone`) and switched business date rules to per-shop timezone resolution.
4. Centralized Shopify API version usage in `worker/src/config.ts` and removed worker-side hardcoded version drift.

## Detailed Change Log

### 1) ISS-014: Restrict CORS on Authenticated Admin API

- `worker/src/index.ts`
  - Replaced unconditional global `Access-Control-Allow-Origin: *` behavior with route-aware CORS policy.
  - For `/admin/*`:
    - **Production/staging:** only allows origins from `ADMIN_ALLOWED_ORIGINS` (comma-separated), defaulting to `https://master.mexican-golf-cart-admin.pages.dev`.
    - **Dev (`ENVIRONMENT=dev`):** remains permissive (`*`) for tunnel-origin compatibility.
  - OPTIONS preflight to `/admin/*` with non-allowed origin now returns `403`.
  - Non-admin routes retain wildcard CORS behavior.

- `worker/src/types.ts`
  - Added optional env typing: `ADMIN_ALLOWED_ORIGINS?: string`.

- `worker/wrangler.toml`
  - Added `ADMIN_ALLOWED_ORIGINS` defaults for production/dev/staging vars.

### 2) ISS-015: Proxy Signature Verification for All `/proxy/*` Routes

- `worker/src/proxy.ts`
  - Removed route exception behavior that previously only verified `/agreement/sign`.
  - Signature verification now runs for every `/proxy/*` request when `ENVIRONMENT !== dev`.
  - Dev mode keeps signature enforcement off for local/tunnel compatibility.

- `worker/tests/proxy-auth.test.ts` (new)
  - Added coverage asserting all proxy routes reject missing signatures in production mode.
  - Added dev-mode compatibility assertion (signature bypass remains active in dev).

### 3) ISS-016: Persist and Use Per-Shop Timezone

- `worker/src/auth.ts`
  - During OAuth callback, fetches `shop.iana_timezone` via Shopify Admin API (`/shop.json`).
  - Persists timezone into `shops.timezone` during upsert.
  - Uses normalized fallback (`America/Mazatlan`) when Shopify timezone lookup fails or is invalid.

- `worker/src/config.ts`
  - Added `DEFAULT_STORE_TIMEZONE`.
  - Added `normalizeStoreTimezone(...)` helper for safe IANA normalization/fallback.

- `worker/src/admin.ts`
  - Admin auth context now carries `shopTimezone`.
  - Date rules in `POST /admin/bookings`, `GET /admin/bookings` (`date_preset=upcoming`), and `GET /admin/dashboard` now use per-shop timezone from auth context.
  - Auto-provisioned shop rows now initialize timezone fallback to avoid UTC drift in worker-only provisioning paths.

- `worker/src/proxy.ts`
  - `GET /proxy/availability` and `POST /proxy/hold` now read `shops.timezone` and apply per-shop timezone for lead-time/min-duration checks.

- `worker/src/bookingService.ts`
  - Webhook confirmation date-rule validation now resolves timezone from `shops.timezone` by `shop_id`.

- `worker/tests/date.test.ts`
  - Updated timezone tests to assert fallback/default and normalization behavior.

### 4) ISS-020: Centralize Shopify API Versions

- `worker/src/config.ts`
  - Added `SHOPIFY_ADMIN_API_VERSION = '2026-04'`.

- Replaced worker-side hardcoded API versions with the constant in:
  - `worker/src/auth.ts` (webhook registration + shop timezone fetch)
  - `worker/src/admin.ts` (fulfillment REST + admin GraphQL product fetch)
  - `worker/src/proxy.ts` (storefront config GraphQL product enrichment)
  - `worker/src/bookingService.ts` (order cancellation endpoint)

## Dev vs Production Compatibility Notes

- **Admin CORS**
  - Dev (`ENVIRONMENT=dev`): wildcard CORS preserved for `/admin/*` to avoid tunnel-origin breakage.
  - Production/staging: restricted to configured `ADMIN_ALLOWED_ORIGINS`.

- **Proxy Signature Verification**
  - Dev (`ENVIRONMENT=dev`): signature checks remain disabled for local storefront iteration.
  - Production/staging: all `/proxy/*` routes require valid Shopify app proxy signature.

## Validation Performed (Post-M6)

1. `npx tsc -p worker/tsconfig.json`
- Result: **PASS** (no output, exit code `0`)

2. `npm --workspace worker run test`
- Result: **PASS**
```text
> worker@0.0.0 test
> node --test --import tsx

✔ signed agreement with signature_png_base64 present should be valid (1.301125ms)
✔ signed agreement with empty signature_png_base64 should be valid (0.098125ms)
✔ signed agreement with missing id should be invalid (0.079ms)
✔ signed agreement with both id and empty signature should be valid (0.055ms)
✔ DEFAULT_STORE_TIMEZONE is fixed to America/Mazatlan (0.948709ms)
✔ getTodayInTimeZone respects store timezone date boundary (10.61575ms)
✔ getTodayInTimeZone formats dates as YYYY-MM-DD (0.440041ms)
✔ normalizeStoreTimezone preserves valid shop timezone (1.213042ms)
✔ normalizeStoreTimezone falls back for invalid timezone (0.135459ms)
✔ production enforces proxy signature for all /proxy routes (22.886167ms)
✔ dev mode keeps proxy signature check disabled for compatibility (0.424959ms)
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 315.972416
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
- Warning is pre-existing and unchanged.

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
✓ built in 1.28s
```

## Regression/Scope Notes

- D1 remains the source of truth.
- No-overselling and fail-fast atomic inventory behavior remains unchanged.
- Webhook idempotency flow (`webhook_events`) remains unchanged.
- M1-M5 UI and routing behaviors are unaffected by M6 backend hardening changes.

## Issues Covered by This Milestone

- ISS-014: fixed
- ISS-015: fixed
- ISS-016: fixed
- ISS-020: fixed

## Remaining Milestone Scope

- M7 testing and regression guardrails.
