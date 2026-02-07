# Local Development (One Command)

Run everything with hot reload from the repo root:

```bash
npm run dev
```

This starts:

- Worker live deploy watcher (`worker`): deploys to `mexican-golf-cart-worker-dev` on every change in `worker/src` and `worker/migrations`.
- Shopify app dev (`shopify`): runs with `shopify.app.dev.toml` (`--config dev`) and auto-updates app URLs to the Shopify CLI dev tunnel.
- Admin pages dev server (`pages`): local standalone Vite dev server on `http://localhost:4173` with HMR.

## Notes

- Embedded admin hot reload:
  - Shopify CLI tunnel URL is used inside Shopify Admin (not `localhost`).
  - Shopify runs the admin Vite server via `shopify.web.toml` and proxies it through the tunnel.
  - Admin Vite dev server allows rotating tunnel hostnames so embedded requests are not blocked by host checks.
  - Open the app from Shopify Admin (embedded view). UI edits in `apps/admin/src` hot reload inside that embedded iframe.
- Storefront widget requests go through Shopify App Proxy (`/apps/rental`) so they follow the dev Worker endpoint from `shopify.app.dev.toml`.
- If you change `worker/wrangler.toml`, restart `npm run dev` to pick up config changes.
- The Worker deploy watcher uses `WRANGLER` auth from your local machine. Ensure you are logged in:

```bash
cd worker
npx wrangler login
```
