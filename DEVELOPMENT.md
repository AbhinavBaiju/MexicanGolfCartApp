# Local Development (One Command)

Run everything with hot reload from the repo root:

```bash
npm run dev
```

This starts:

- Worker live deploy watcher (`worker`): deploys to `mexican-golf-cart-worker-dev` on every change in `worker/src` and `worker/migrations`.
- Shopify app dev (`shopify`): runs with `shopify.app.dev.toml` (`--config dev --no-update`) for extension/storefront development.
- Admin pages dev server (`pages`): Vite dev server on `http://localhost:4173` with HMR.

## Notes

- Storefront widget requests go through Shopify App Proxy (`/apps/rental`) so they follow the dev Worker endpoint from `shopify.app.dev.toml`.
- If you change `worker/wrangler.toml`, restart `npm run dev` to pick up config changes.
- The Worker deploy watcher uses `WRANGLER` auth from your local machine. Ensure you are logged in:

```bash
cd worker
npx wrangler login
```
