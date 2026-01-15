# Project: MexicanGolfCarts (Shopify Booking System)
**Context:** A private Shopify OS 2.0 app for date-range bookings of rentable products.
**Core Stack:** Cloudflare Workers (Backend), D1 (Database), Shopify Theme App Extension (Storefront), React/Polaris (Admin).

## Tech Stack & Conventions
- **Backend:** Cloudflare Workers (TypeScript), Hono (recommended) or native fetch, D1 (SQLite).
- **Storefront:** Shopify Liquid (Theme App Extension), Vanilla JS (Widget), Tailwind (via CDN/build).
- **Admin UI:** React, Vite, Shopify Polaris, App Bridge.
- **Package Manager:** `pnpm` (preferred) or `npm`.

## Architecture & Workflows
* **Source of Truth:** The Backend (D1) is the authority. Storefront UI is ephemeral.
* **State Machine:** `HOLD` -> `CONFIRMED` (via Webhook). See `Product_Requirement.md` §6.1.
* **Concurrency:** Use atomic conditional updates on `inventory_day`. See `Implementation_Plan.md` §5.

## Critical Rules (The "Hard" Constraints)
1. **Timezone:** All date logic MUST use the **Store Timezone**. Never use UTC/Client time for business rules.
2. **Idempotency:** Webhooks must be idempotent. Use `webhook_events` table.
3. **Security:**
   - Storefront routes (`/proxy/*`) MUST verify `signature`.
   - Webhooks MUST verify HMAC headers.
   - Admin routes MUST verify Session Tokens (JWT).
4. **Validation:** Never trust client input (price, availability, dates). Re-validate EVERYTHING on webhook confirmation.
5. **No Overselling:** Ensure atomic capacity checks using the "Fail Fast" SQL strategy.

## Documentation References
* **Business Logic & Rules:** [Product_Requirement.md](./Product_Requirement.md)
  * *Read for:* UX flows, deposit logic, valid states, and anti-tamper rules.
* **Architecture & Data:** [Implementation_Plan.md](./Implementation_Plan.md)
  * *Read for:* D1 schema, API contracts, SQL strategies, and detailed data flow.
* **Step-by-Step Build:** [Task.md](./Task.md)
  * *Read for:* Implementation order (Milestones M0-M9), Definition of Done, and testing requirements.

## Common Commands
- **Dev:** `npm run dev` (Shopify App), `npx wrangler dev` (Worker).
- **DB:** `npx wrangler d1 migrations apply <db_name> --local`.
- **Deploy:** `npm run deploy` (App), `npx wrangler deploy` (Worker).

## "Do Not" List
- Do **not** use `any` types. Define interfaces for all API payloads.
- Do **not** put business logic in the Storefront (Liquid/JS). It belongs in the Worker.
- Do **not** use client-side timers for critical expiry (only for UX).