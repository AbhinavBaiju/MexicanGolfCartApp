# Local Development (One Command)

Run everything with hot reload from the repo root:

```bash
npm run dev
```

## Startup Sequence

`npm run dev` now runs in this order:

1. `dev:sync-db` (blocking): syncs a full snapshot from `mexican-golf-cart-db-prod` to `mexican-golf-cart-db-dev`.
2. `dev:worker`: deploy watcher for Worker changes.
3. `dev:shopify`: Shopify CLI dev with tunnel and embedded app URL updates.
4. `dev:pages`: admin Vite server with HMR.

This starts:

- Worker live deploy watcher (`worker`): deploys to `mexican-golf-cart-worker-dev` on every change in `worker/src` and `worker/migrations`.
- Shopify app dev (`shopify`): runs with `shopify.app.dev.toml` (`--config dev`) and auto-updates app URLs to the Shopify CLI dev tunnel.
- Admin pages dev server (`pages`): local standalone Vite dev server on `http://localhost:4173` with HMR.

## Notes

- Embedded admin hot reload:
  - Shopify CLI tunnel URL is used inside Shopify Admin (not `localhost`).
  - Shopify runs the admin Vite server via `shopify.web.toml` and proxies it through the tunnel.
  - Admin Vite dev server allows rotating tunnel hostnames so embedded requests are not blocked by host checks.
  - Open the app from the same dev store selected in that `shopify app dev` run. Opening a different store often loads a stale tunnel URL.
  - UI edits in `apps/admin/src` hot reload inside the embedded iframe.
  - If tunnel DNS fails, check `cloudflared --version` and temporarily rename `~/.cloudflared/config.yml` / `config.yaml` if present.
- Storefront widget requests go through Shopify App Proxy (`/apps/rental`) so they follow the dev Worker endpoint from `shopify.app.dev.toml`.
- Inventory configuration flow:
  - Configure `Rentable Products` in the Inventory page first; enabling rentable automatically applies Shopify product template `product.rentals`.
  - Configure `Featured Home Products` with exactly 3 rentable products; these drive the home-page booking widget product toggle.
  - If a rentable product is disabled, the Worker restores the product template suffix to its previous/default value.
- If you change `worker/wrangler.toml`, restart `npm run dev` to pick up config changes.
- The Worker deploy watcher uses `WRANGLER` auth from your local machine. Ensure you are logged in:

```bash
cd worker
npx wrangler login
```

## Dev DB Sync Defaults

Sync behavior is controlled in `scripts/config/dev.env`:

- `DEV_DB_SYNC_ENABLED=1`
- `DEV_DB_SYNC_SOURCE_DB_NAME=mexican-golf-cart-db-prod`
- `DEV_DB_SYNC_TARGET_DB_NAME=mexican-golf-cart-db-dev`
- `DEV_DB_SYNC_REMOTE=1`

## Expected Timing

- Snapshot sync runs before all other dev services.
- For the current database size, sync usually completes in a few seconds.
- If sync fails, `npm run dev` exits and does not start worker/shopify/pages processes.

## Failure Modes and Recovery

- `Source and target databases must differ`:
  - Ensure `DEV_DB_SYNC_SOURCE_DB_NAME` and `DEV_DB_SYNC_TARGET_DB_NAME` are not the same.
- Wrangler auth errors:
  - Run `cd worker && npx wrangler login`.
- Missing source DB or network/API errors:
  - Verify DB names in `scripts/config/dev.env` and retry.
- Critical table empty after sync:
  - Confirm source DB contains booking data:
    - `cd worker && npx wrangler d1 execute mexican-golf-cart-db-prod --remote --command "SELECT COUNT(*) AS bookings FROM bookings;"`
  - Re-run sync:
    - `npm run dev:sync-db`
