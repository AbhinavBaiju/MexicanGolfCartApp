# AI Agent Context & Milestones

## What These Docs Cover
- Executive findings and UI dead-ends: [docs/audit/00-executive-summary.md](docs/audit/00-executive-summary.md)
- Monorepo map, stacks, routing, and envs: [docs/audit/01-repo-architecture-map.md](docs/audit/01-repo-architecture-map.md)
- UI-to-code trace for broken controls: [docs/audit/02-ui-symptom-to-code-trace.md](docs/audit/02-ui-symptom-to-code-trace.md)
- Issue IDs with evidence and owners: [docs/audit/03-issues-register.md](docs/audit/03-issues-register.md)
- API surface and gaps (admin, proxy, webhooks): [docs/audit/04-endpoints-and-data-contracts.md](docs/audit/04-endpoints-and-data-contracts.md)
- Manual test checklist and test priorities: [docs/audit/05-test-and-verification-plan.md](docs/audit/05-test-and-verification-plan.md)
- Milestone implementation handoff log: [docs/audit/06-m1-implementation-log.md](docs/audit/06-m1-implementation-log.md)
- Milestone implementation handoff log: [docs/audit/07-m2-implementation-log.md](docs/audit/07-m2-implementation-log.md)
- Milestone implementation handoff log: [docs/audit/09-m3-implementation-log.md](docs/audit/09-m3-implementation-log.md)
- Milestone implementation handoff log: [docs/audit/11-m4-implementation-log.md](docs/audit/11-m4-implementation-log.md)
- Milestone implementation handoff log: [docs/audit/14-m5-implementation-log.md](docs/audit/14-m5-implementation-log.md)
- Milestone implementation handoff log: [docs/audit/17-m6-implementation-log.md](docs/audit/17-m6-implementation-log.md)
- Milestone handoff context: [docs/audit/18-m6-handoff-context.md](docs/audit/18-m6-handoff-context.md)
- Next chat prompt (M7): [docs/audit/19-next-chat-m7-handoff-prompt.md](docs/audit/19-next-chat-m7-handoff-prompt.md)
- Milestone implementation handoff log: [docs/audit/20-m7-implementation-log.md](docs/audit/20-m7-implementation-log.md)

## System Snapshot (from the docs)
- Stack: Vite+React+Polaris admin SPA (Cloudflare Pages), Cloudflare Worker + D1 backend, Shopify Remix shell for OAuth/tunnel, App Bridge v4 for auth.
- Truth source: Worker/D1; storefront proxy handles holds; admin SPA uses `/admin/*` JWT endpoints.
- Biggest broken UX (historical): Bookings page filters/export/manual booking, stub buttons (Manage, FAQ, New service), Remix placeholder routes.
- Remaining high-priority work: Full browser-level embedded E2E automation (Playwright/Shopify iframe path).
- Security posture: M6 removed wildcard admin CORS, enabled proxy HMAC verification in production for all `/proxy/*` routes, and moved date rules to per-shop timezone. `SHOPIFY_API_SECRET` still must be managed as a Cloudflare secret (not in `wrangler.toml`).

## Milestones for Implementation
M0 – Baseline & Secrets
- Verify Cloudflare secrets set (SHOPIFY_API_SECRET, DB bindings) and env vars in `wrangler.toml`/Pages build.
- Sync store timezone handling with per-shop data where available; avoid UTC/client drift.
- Run smoke checks from [docs/audit/05-test-and-verification-plan.md](docs/audit/05-test-and-verification-plan.md) before changes.

M1 – Bookings Page Parity (ISS-001/004/006/011/021)
- Port Dashboard filter bar (`FilterPopover`, server-side params) into `apps/admin/src/pages/Bookings.tsx` with search hitting `search` query param.
- Wire sort/export handlers (reuse Dashboard `handleExport`), remove or implement Up-arrow toggle.
- Decide on WAITLIST: either add migration to allow status or drop the tab.
- Replace "Services availabilities" placeholder with real view or remove the tab.
Status: Completed on 2026-02-08. See [docs/audit/06-m1-implementation-log.md](docs/audit/06-m1-implementation-log.md).

M2 – Manual Booking Creation (ISS-002)
- Backend: add `POST /admin/bookings` to perform hold+confirm with capacity checks (reuse proxy hold logic) and create booking_items/days.
- Frontend: add modal/form from "+ Manual booking" button; support product/variant selection, dates, location, quantity; show success/error toasts.
- Ensure atomic inventory updates (fail-fast SQL) and store-timezone validation.
Status: Completed on 2026-02-07 and re-audited/signed off on 2026-02-07 (no M2 delta findings). See [docs/audit/07-m2-implementation-log.md](docs/audit/07-m2-implementation-log.md).

M3 – Booking Management Flow (ISS-003/017/013/012)
- Add booking detail view (modal or route) using `GET /admin/bookings/:token`; wire BookingCard "Manage" button.
- Add toast feedback for `POST /admin/bookings/:token/complete`; guard against fulfillment failure.
- Fix date display to be timezone-safe and update calendar counts to include spans between start/end.
Status: Completed on 2026-02-07. See [docs/audit/09-m3-implementation-log.md](docs/audit/09-m3-implementation-log.md).

M4 – Dashboard Polishing (ISS-005/010/018/019/007)
- Wire "FAQ" to help URL and "New service" to Inventory (or product-create modal).
- Relabel "All teammates" to locations or implement actual staff data.
- Show service labels using Shopify product titles (`/admin/shopify-products`) instead of numeric IDs.
- Remove dead code/deps (recharts, DashboardChart, unused Products page) or route `/products` correctly.
Status: Completed on 2026-02-07. See [docs/audit/11-m4-implementation-log.md](docs/audit/11-m4-implementation-log.md).

M5 – Shopify Remix Cleanup (ISS-008/009)
- Remove template "Generate a product" action and placeholder routes or redirect them to the Cloudflare Pages admin SPA.
- Align nav links to actual SPA paths; ensure dev tunnel script continues to serve Vite admin.
Status: Completed on 2026-02-07. See [docs/audit/14-m5-implementation-log.md](docs/audit/14-m5-implementation-log.md).

M6 – Security & Proxy Hardening (ISS-014/015/016/020)
- Restrict CORS to admin origin; enforce App Proxy HMAC on all `/proxy/*` routes in production.
- Persist store timezone during OAuth (`shop.iana_timezone`) into `shops.timezone`; use per-shop tz in date logic.
- Centralize Shopify API version constants to avoid mismatches.
Status: Completed on 2026-02-07. See [docs/audit/17-m6-implementation-log.md](docs/audit/17-m6-implementation-log.md).

M7 – Testing & Regression Guardrails
- Backend: add booking filter coverage, manual booking creation, proxy HMAC, inventory conflict tests (see P0 list in [docs/audit/05-test-and-verification-plan.md](docs/audit/05-test-and-verification-plan.md)).
- Frontend: Vitest + Testing Library for filter buttons wired, Manage action, date formatting, calendar spans, toast feedback.
- E2E: Playwright flow for hold→confirm→admin visibility, agreement signing, embedded iframe auth.
Status: Implemented on 2026-02-08 with backend/frontend guardrails and practical integration paths; browser-level embedded Playwright flow remains as follow-up. See [docs/audit/20-m7-implementation-log.md](docs/audit/20-m7-implementation-log.md).

## Quick Pointers to Code/Endpoints
- Functional filters reference: Dashboard implementation in [apps/admin/src/pages/Dashboard.tsx](apps/admin/src/pages/Dashboard.tsx).
- Booking list API: [worker/src/admin.ts](worker/src/admin.ts#L556) for `/admin/bookings` params; detail at [worker/src/admin.ts](worker/src/admin.ts#L766).
- Hold logic to mirror for manual booking: [worker/src/proxy.ts](worker/src/proxy.ts#L280).
- Agreement flows: [worker/src/admin.ts](worker/src/admin.ts#L1121) and [worker/src/proxy.ts](worker/src/proxy.ts).
- Known schema limits: bookings status CHECK in [worker/migrations/0001_schema.sql](worker/migrations/0001_schema.sql).
