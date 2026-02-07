# Admin App Deployment Guide

The admin app is hosted on Cloudflare Pages. Since there is no automatic deployment from the `master` branch, you must deploy manually using the `wrangler` CLI.

## Dev vs Production Configuration

- Development embedded admin hot reload uses Shopify CLI tunnel URLs from `shopify app dev --config dev`.
- Production deploys use `apps/shopify/mexican-golf-cart/shopify.app.toml` with the Cloudflare Pages URL (`https://master.mexican-golf-cart-admin.pages.dev`).
- `scripts/deploy.sh` validates and deploys using production config values; it does not use dev tunnel URLs.

## Prerequisites

- Node.js and npm installed.
- Cloudflare `wrangler` CLI authenticated (use `npx wrangler login` if needed).
- Shopify CLI installed (or use `npx shopify`).
- **CRITICAL**: The `apps/admin/.env` file must exist locally with `VITE_SHOPIFY_API_KEY` set. This file is gitignored and required for the build to embed the Shopify API key.

## Deployment Steps

### 1. Build the Admin App

Navigate to the admin app directory and run the build script.

```bash
cd apps/admin
npm run build
```

### 2. Deploy to Cloudflare Pages (Master Branch)

Use `wrangler` to deploy the `dist` folder to the `mexican-golf-cart-admin` project. **Crucially**, specify the branch as `master` to ensure the URL consistency if you are using the branch alias.

```bash
# Run from the root directory
npx wrangler pages deploy apps/admin/dist --project-name mexican-golf-cart-admin --branch master
```

### 3. Verify and Update Shopify Configuration

The Shopify app must point to the correct deployed URL. We are currently using the `master` branch alias.

1.  Check `apps/shopify/mexican-golf-cart/shopify.app.toml`.
2.  Ensure `application_url` is set to `https://master.mexican-golf-cart-admin.pages.dev` (or the alias matching your deployment).
3.  If you changed the URL or configuration, push the changes to Shopify:

    ```bash
    cd apps/shopify/mexican-golf-cart
    npm run deploy
    ```
    *(Note: Confirm "Yes" when prompted to release the new version)*

### 4. Full Production Deploy Script (Recommended)

From repo root:

```bash
./scripts/deploy.sh
```

This keeps the existing production flow:

- Deploy Worker
- Apply D1 migrations
- Build + deploy admin to Cloudflare Pages
- Deploy Shopify app configuration/extensions

## Troubleshooting

- **Changes not showing up?**
    - Check if the `application_url` in `shopify.app.toml` matches the deployment alias URL (e.g., `https://master.mexican-golf-cart-admin.pages.dev`).
    - Cloudflare Pages "Production" URL (`...pages.dev` without subdomain) might be stale or cached. Prefer using the branch alias.
    - Ensure you ran `npm run deploy` in the Shopify app folder after changing `shopify.app.toml`.
