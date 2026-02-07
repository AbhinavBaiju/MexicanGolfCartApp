# Issues Register

Each entry represents a distinct issue found during the audit. Issues are ordered by severity.

---

## ISS-001: Bookings Page Filter Buttons Are Non-Functional Stubs

| Field | Value |
|-------|-------|
| **ID** | ISS-001 |
| **Title** | Bookings page filter bar buttons (Upcoming, All services, All types, All statuses, Sort, Export) have no handlers |
| **Severity** | Blocker |
| **Area** | UI / Frontend |
| **Symptoms** | Clicking any filter button on the Bookings page does nothing. No dropdown opens, no filter applies, no state changes. |
| **Root Cause** | All filter buttons in `Bookings.tsx` L145–150 are bare `<Button>` components with no `onClick` prop, no state management, and no query parameter integration. They are decorative copies of the Dashboard's functional filter bar. |
| **Evidence** | `apps/admin/src/pages/Bookings.tsx` L145: `<Button variant="secondary">Upcoming</Button>` — no onClick. Same pattern for L146–150. Compare with `Dashboard.tsx` L484–519 where identical UI uses `FilterPopover` components with full state + API integration. |
| **Impact** | Admin users cannot filter bookings by date, service, type, or status from the Bookings page. They can only switch between status tabs. |
| **What's Needed to Fix** | Port the `FilterPopover` pattern from Dashboard to Bookings page. Add state variables, wire filter values to `loadBookings()` query params. Backend already supports all filter params. |
| **Owner Type** | Frontend |

---

## ISS-002: "Manual Booking" Button Has No Handler or Backend Support

| Field | Value |
|-------|-------|
| **ID** | ISS-002 |
| **Title** | "Manual booking" button is a visual stub with no implementation |
| **Severity** | Blocker |
| **Area** | UI / Frontend / API |
| **Symptoms** | Clicking "+ Manual booking" on the Bookings page does nothing. |
| **Root Cause** | `<Button variant="primary" icon={PlusIcon}>Manual booking</Button>` at `Bookings.tsx` L111 has no `onClick` handler. Additionally, no `POST /admin/bookings` endpoint exists in the worker — booking creation only happens through the storefront proxy hold flow. |
| **Evidence** | `Bookings.tsx` L111: no onClick. `admin.ts` routing (L100–215): no POST handler for `/bookings`. |
| **Impact** | Admins cannot create bookings for phone/walk-in customers. This is identified as a core workflow in `Product_Requirement.md` L305. |
| **What's Needed to Fix** | 1) Create a booking form modal in the UI. 2) Create `POST /admin/bookings` endpoint that performs hold creation + immediate confirmation (bypassing the storefront flow). 3) Include inventory capacity checks. |
| **Owner Type** | Fullstack |

---

## ISS-003: "Manage" Button on BookingCard Has No Handler

| Field | Value |
|-------|-------|
| **ID** | ISS-003 |
| **Title** | BookingCard "Manage" button does nothing |
| **Severity** | Blocker |
| **Area** | UI / Frontend |
| **Symptoms** | Clicking "Manage" on any booking card does nothing. |
| **Root Cause** | `<Button variant="secondary">Manage</Button>` at `BookingCard.tsx` L186 has no `onClick` prop. No booking detail/edit page or modal exists. |
| **Evidence** | `BookingCard.tsx` L186: bare `<Button>` with no handler. No booking detail route exists in `App.tsx`. |
| **Impact** | Admins cannot view detailed booking information, edit dates, change status, or perform any management action on individual bookings. |
| **What's Needed to Fix** | 1) Create a booking detail modal or page. 2) Wire the Manage button to navigate/open it. 3) Backend `GET /admin/bookings/:token` already exists and returns full detail including items and days. |
| **Owner Type** | Frontend |

---

## ISS-004: Bookings Page Search Claims Customer Name/Email but Only Filters on Token/Location/Order

| Field | Value |
|-------|-------|
| **ID** | ISS-004 |
| **Title** | Search field placeholder says "Filter by customer name or email" but doesn't search those fields |
| **Severity** | Critical |
| **Area** | UI / Frontend |
| **Symptoms** | Typing a customer name or email in the Bookings page search field yields no results, even when matching bookings exist. |
| **Root Cause** | The Bookings page uses client-side filtering (`filteredBookings` at L96–101) that only checks `booking_token`, `location_code`, and `order_id`. It does not check `customer_name` or `customer_email`. The backend `GET /admin/bookings?search=...` endpoint DOES support searching these fields, but the Bookings page doesn't use the `search` query param — it fetches all bookings for a status tab and filters client-side. |
| **Evidence** | `Bookings.tsx` L96–101: filter only checks `booking_token`, `location_code`, `order_id`. Compare with `admin.ts` L697–703 where backend search includes `customer_name LIKE ?` and `customer_email LIKE ?`. |
| **Impact** | Misleading UX. Admins expect to search by customer but get no results. |
| **What's Needed to Fix** | Either: (a) Pass `search` as a query param to the API call (like Dashboard does), or (b) Include `customer_name`/`customer_email` in the client-side filter (but this is inferior since the data may not be in the fetched subset). |
| **Owner Type** | Frontend |

---

## ISS-005: "FAQ" and "+ New Service" Dashboard Buttons Are Stubs

| Field | Value |
|-------|-------|
| **ID** | ISS-005 |
| **Title** | Dashboard header buttons "FAQ" and "+ New service" have no handlers |
| **Severity** | Critical |
| **Area** | UI / Frontend |
| **Symptoms** | Clicking either button does nothing. |
| **Root Cause** | Both buttons at `Dashboard.tsx` L431–432 lack `onClick` props. No FAQ content or service creation flow exists anywhere. |
| **Evidence** | `Dashboard.tsx` L431: `<Button>FAQ</Button>` — no onClick. L432: `<Button variant="primary" icon={PlusIcon}>New service</Button>` — no onClick. |
| **Impact** | False affordance. Users expect functionality. "New service" is likely equivalent to adding a product configuration, which IS possible on the Inventory page but not triggered from Dashboard. |
| **What's Needed to Fix** | Wire "New service" to navigate to `/inventory` or open a product config modal. Wire "FAQ" to an external URL or help content. |
| **Owner Type** | Frontend |

---

## ISS-006: Bookings Page Export Button Does Nothing

| Field | Value |
|-------|-------|
| **ID** | ISS-006 |
| **Title** | Export button on Bookings page has no handler |
| **Severity** | Critical |
| **Area** | UI / Frontend |
| **Symptoms** | Clicking "Export" on the Bookings page does nothing. |
| **Root Cause** | `<Button icon={ExportIcon}>Export</Button>` at `Bookings.tsx` L150 has no `onClick`. The Dashboard page has a working `handleExport()` function (L379–417) that generates a CSV download. |
| **Evidence** | `Bookings.tsx` L150 vs `Dashboard.tsx` L379–417 (working implementation). |
| **Impact** | Admins cannot export booking data from the Bookings page. They must use the Dashboard export instead. |
| **What's Needed to Fix** | Copy `handleExport()` logic from Dashboard to Bookings and wire to button. |
| **Owner Type** | Frontend |

---

## ISS-007: Products Page Not Routable

| Field | Value |
|-------|-------|
| **ID** | ISS-007 |
| **Title** | Products.tsx exists but has no route in App.tsx |
| **Severity** | Major |
| **Area** | UI / Frontend |
| **Symptoms** | No way to navigate to the Products page. |
| **Root Cause** | `Apps/admin/src/pages/Products.tsx` is a complete component with product CRUD UI, but `App.tsx` does not include a `<Route path="/products">` for it. The NavMenu also doesn't link to it. |
| **Evidence** | `App.tsx` L27–31: routes defined for `/`, `/bookings`, `/inventory`, `/locations`, `/agreement`. No `/products`. `Products.tsx` exists as dead code. |
| **Impact** | Product management is only accessible through the Inventory page's "Edit settings" / "Link Product" flow. The standalone Products page is unreachable. |
| **What's Needed to Fix** | Either add a `/products` route to `App.tsx` or remove the dead file. |
| **Owner Type** | Frontend |

---

## ISS-008: Remix App Index Page Has Template Demo Code

| Field | Value |
|-------|-------|
| **ID** | ISS-008 |
| **Title** | Shopify Remix app index route still has "Generate a product" demo action |
| **Severity** | Major |
| **Area** | Shopify / Frontend |
| **Symptoms** | If a user somehow navigates to the Remix app's index route (rather than the Vite admin SPA), they see a "Generate a product" button that creates random snowboard products in Shopify. |
| **Root Cause** | `app/routes/app._index.tsx` was never updated from the Shopify Remix template. It contains a `productCreate` mutation. |
| **Evidence** | `apps/shopify/mexican-golf-cart/app/routes/app._index.tsx` L26–91: action handler creates a random color snowboard product. |
| **Impact** | Accidental product creation pollution. In production, users should never see this page (they see the Vite admin SPA), but it's a risk during development or if the Cloudflare Pages deployment fails. |
| **What's Needed to Fix** | Replace with a redirect to the admin SPA or remove the demo action. |
| **Owner Type** | Fullstack |

---

## ISS-009: Shopify Remix Route Pages Are All Placeholders

| Field | Value |
|-------|-------|
| **ID** | ISS-009 |
| **Title** | Remix routes for bookings/inventory/products/locations are empty placeholders |
| **Severity** | Major |
| **Area** | Shopify / Frontend |
| **Symptoms** | Navigating to `/app/bookings`, `/app/inventory`, `/app/products`, `/app/locations` in the Remix app shows "placeholder" text. |
| **Root Cause** | These routes were created as stubs. The real admin UI is served via `apps/admin/` through Cloudflare Pages. |
| **Evidence** | `app.bookings.tsx` L12: "Bookings page placeholder." Same pattern in `app.inventory.tsx`, `app.products.tsx`, `app.locations.tsx`. |
| **Impact** | Confusion for developers. During production, the Vite admin SPA is served instead, so users don't see these. But the Remix NavMenu links point to these placeholder routes. |
| **What's Needed to Fix** | Either remove these routes (since they're unused) or redirect them to the Vite admin SPA paths. |
| **Owner Type** | Frontend |

---

## ISS-010: Dashboard "All teammates" Filter Label Is Misleading

| Field | Value |
|-------|-------|
| **ID** | ISS-010 |
| **Title** | "All teammates" filter actually filters by location |
| **Severity** | Minor |
| **Area** | UI / Frontend |
| **Symptoms** | The filter labeled "All teammates" shows location names/codes, not team member names. |
| **Root Cause** | `Dashboard.tsx` L256–275: `teammateOptions` are populated from `GET /admin/locations` response. The label "All teammates" is used for what is actually a location filter, sent as `location_code` query param. |
| **Evidence** | `Dashboard.tsx` L256: `setTeammateOptions` populated from `locationsData.locations`. L493: `<FilterPopover options={teammateOptions}...>`. L332: `params.set('location_code', selectedTeammate)`. |
| **Impact** | Misleading UX. Users expect to see teammate/staff members but see locations. |
| **What's Needed to Fix** | Rename label to "All locations" or implement a proper teammates/staff data model. |
| **Owner Type** | Frontend |

---

## ISS-011: "Services availabilities" Tab Is a Placeholder

| Field | Value |
|-------|-------|
| **ID** | ISS-011 |
| **Title** | Bookings page "Services availabilities" tab shows "coming soon" |
| **Severity** | Minor |
| **Area** | UI / Frontend |
| **Symptoms** | Clicking the "Services availabilities" tab shows placeholder text. |
| **Root Cause** | `Bookings.tsx` L122–126: Tab index 6 renders "Services availabilities view coming soon" text. |
| **Evidence** | `Bookings.tsx` L124: `<Text as="p" tone="subdued">Services availabilities view coming soon</Text>` |
| **Impact** | Incomplete feature. The Inventory page already shows per-product daily availability. |
| **What's Needed to Fix** | Either implement the view (showing product availability per day) or remove the tab. |
| **Owner Type** | Frontend |

---

## ISS-012: Calendar Counts Only Start-Date Bookings

| Field | Value |
|-------|-------|
| **ID** | ISS-012 |
| **Title** | BookingsCalendar only counts bookings starting on each day, not spanning |
| **Severity** | Minor |
| **Area** | UI / Frontend |
| **Symptoms** | A booking from Feb 5–10 only shows a count on Feb 5 in the calendar, not on Feb 6–10. |
| **Root Cause** | `BookingsCalendar.tsx` L48: `const count = bookings.filter(b => b.start_date.startsWith(dateStr)).length;` — only matches `start_date`, not the range `start_date` to `end_date`. |
| **Evidence** | `BookingsCalendar.tsx` L48 |
| **Impact** | Calendar gives inaccurate view of daily booking load. Days with active rentals but no new starts show 0. |
| **What's Needed to Fix** | Change filter to: `b.start_date <= dateStr && b.end_date >= dateStr` (accounting for string comparison of YYYY-MM-DD format). |
| **Owner Type** | Frontend |

---

## ISS-013: Date Formatting May Shift By One Day Due to Timezone

| Field | Value |
|-------|-------|
| **ID** | ISS-013 |
| **Title** | Date display uses `new Date(dateStr)` which is timezone-sensitive |
| **Severity** | Minor |
| **Area** | UI / Frontend |
| **Symptoms** | A booking with `start_date: "2026-02-07"` might display as "February 6, 2026" for a user in a west-of-UTC timezone. |
| **Root Cause** | `BookingCard.tsx` L81–84: `const d = new Date(dateStr)` parses "YYYY-MM-DD" as midnight UTC in some browsers and midnight local in others. `toLocaleDateString()` then converts to the client's timezone. |
| **Evidence** | `BookingCard.tsx` L81: `const d = new Date(dateStr)` |
| **Impact** | Dates may appear off by one day. The store is in `America/Mazatlan` timezone. |
| **What's Needed to Fix** | Parse dates by splitting "YYYY-MM-DD" into parts and constructing with explicit year/month/day, or append `T12:00:00` to avoid midnight edge cases. |
| **Owner Type** | Frontend |

---

## ISS-014: CORS Wildcard on Authenticated Admin API

| Field | Value |
|-------|-------|
| **ID** | ISS-014 |
| **Title** | Worker sets `Access-Control-Allow-Origin: *` for all routes including admin |
| **Severity** | Major |
| **Area** | Security |
| **Symptoms** | Any origin can make CORS requests to admin endpoints (though they still need a valid JWT). |
| **Root Cause** | `index.ts` L14: `'Access-Control-Allow-Origin': '*'` applied globally to all responses. |
| **Evidence** | `worker/src/index.ts` L13–17 |
| **Impact** | Reduced defense-in-depth. If a JWT is leaked, any origin can use it. Should be restricted to the admin SPA origin. |
| **What's Needed to Fix** | Set CORS origin to `master.mexican-golf-cart-admin.pages.dev` (or dynamically match against allowed origins). |
| **Owner Type** | Backend |

---

## ISS-015: App Proxy Signature Verification Mostly Disabled

| Field | Value |
|-------|-------|
| **ID** | ISS-015 |
| **Title** | Proxy signature verification only enforced for `/agreement/sign`, skipped for all other proxy routes |
| **Severity** | Major |
| **Area** | Security |
| **Symptoms** | Storefront proxy endpoints (`/availability`, `/hold`, `/release`, `/config`) don't verify Shopify App Proxy HMAC signatures. |
| **Root Cause** | `proxy.ts` L73–78: Only `isAgreementSign` triggers signature verification, and only in non-dev mode. All other proxy routes skip verification entirely. |
| **Evidence** | `proxy.ts` L73–78: `if (isAgreementSign && !isDev) { const valid = await verifyProxySignature(...) }` |
| **Impact** | Anyone who knows the worker URL can call `/proxy/hold`, `/proxy/availability`, etc. directly without going through Shopify's App Proxy. Rate limiting partially mitigates this. |
| **What's Needed to Fix** | Enable signature verification for all proxy routes in production. |
| **Owner Type** | Backend |

---

## ISS-016: Store Timezone Never Populated in shops Table

| Field | Value |
|-------|-------|
| **ID** | ISS-016 |
| **Title** | `shops.timezone` column defaults to 'UTC' and is never set to actual store timezone |
| **Severity** | Major |
| **Area** | Data / Backend |
| **Symptoms** | Code uses `STORE_TIMEZONE = 'America/Mazatlan'` constant instead of per-shop timezone. If multi-shop support is ever needed, all shops would use the same timezone. |
| **Root Cause** | The `timezone` column exists in the `shops` migration but the OAuth callback (`auth.ts` `handleAuthCallback`) never fetches or stores the shop's actual timezone. The `config.ts` hardcodes `America/Mazatlan`. |
| **Evidence** | `config.ts` L1: `export const STORE_TIMEZONE = 'America/Mazatlan'`. `auth.ts` `handleAuthCallback` L157–201: does not fetch shop timezone. Migration `0001_schema.sql` L8: `timezone TEXT DEFAULT 'UTC'`. |
| **Impact** | Single-shop deployment works fine with the hardcoded value. Multi-shop would have incorrect date logic. |
| **What's Needed to Fix** | Fetch shop timezone from Shopify Admin API (`shop.iana_timezone`) during OAuth callback and store it. |
| **Owner Type** | Backend |

---

## ISS-017: No User Feedback After "Mark as Completed"

| Field | Value |
|-------|-------|
| **ID** | ISS-017 |
| **Title** | No toast or success message after completing a booking |
| **Severity** | Minor |
| **Area** | UI / Frontend |
| **Symptoms** | After clicking "Yes, Complete" in the modal, it just closes. No success/failure feedback. |
| **Root Cause** | `BookingCard.tsx` `handleConfirmComplete` (L86–93) closes the modal on success but shows no toast. On failure, only `console.error('Failed to complete')` in the parent handlers (`Dashboard.tsx` L368, `Bookings.tsx` L91). |
| **Evidence** | `BookingCard.tsx` L86–93; `Dashboard.tsx` L366–370 |
| **Impact** | Poor UX — user doesn't know if the action succeeded or failed without checking the booking list. |
| **What's Needed to Fix** | Use App Bridge `shopify.toast.show()` for success/error feedback. |
| **Owner Type** | Frontend |

---

## ISS-018: Dashboard Service Filter Shows Numeric IDs, Not Product Titles

| Field | Value |
|-------|-------|
| **ID** | ISS-018 |
| **Title** | Service filter options display "Service 12345" (numeric IDs) instead of product titles |
| **Severity** | Minor |
| **Area** | UI / Frontend |
| **Symptoms** | The "All services" dropdown shows items like "Service 9678432108731" instead of human-readable product names. |
| **Root Cause** | `Dashboard.tsx` L247–252: Service options are built from `GET /admin/products` which returns `product_id` numbers. Labels are formatted as `` `Service ${id}` ``. Product titles are only available from `GET /admin/shopify-products`. |
| **Evidence** | `Dashboard.tsx` L251: `...serviceIds.map((id) => ({ label: \`Service ${id}\`, value: String(id) }))` |
| **Impact** | Admin must memorize numeric product IDs to know which service a filter refers to. |
| **What's Needed to Fix** | Cross-reference with Shopify product data (already fetched by `ProductInventory` component) to show product titles. |
| **Owner Type** | Frontend |

---

## ISS-019: Unused Dependencies and Dead Code

| Field | Value |
|-------|-------|
| **ID** | ISS-019 |
| **Title** | Unused npm packages and dead code files |
| **Severity** | Minor |
| **Area** | Infra / Code Quality |
| **Symptoms** | Bundle bloat, maintenance confusion. |
| **Root Cause** | 1) `recharts` in admin `package.json` — not imported anywhere. 2) `@shopify/app-bridge-utils` v3 — legacy package alongside v4. 3) `DashboardChart.tsx` — component exists but is never imported. 4) `Products.tsx` — page exists but has no route. |
| **Evidence** | `apps/admin/package.json`: `"recharts": "^3.6.0"`, `"@shopify/app-bridge-utils": "^3.5.1"`. `components/DashboardChart.tsx` exists but no import found. `pages/Products.tsx` exists but no route in `App.tsx`. |
| **Impact** | Increased bundle size, developer confusion. |
| **What's Needed to Fix** | Remove unused packages and dead code, or wire them up if needed. |
| **Owner Type** | Frontend |

---

## ISS-020: Webhook API Version Mismatch

| Field | Value |
|-------|-------|
| **ID** | ISS-020 |
| **Title** | Webhook registration uses API version `2026-04` but fulfillment REST API uses `2025-10` |
| **Severity** | Minor |
| **Area** | Backend / Shopify |
| **Symptoms** | Potential API behavior differences between versions. |
| **Root Cause** | `auth.ts` L238: `const apiVersion = '2026-04'` for webhook registration. `admin.ts` `fulfillShopifyOrder` L942: `const apiVersion = '2025-10'` for fulfillment calls. |
| **Evidence** | `auth.ts` L238, `admin.ts` L942 |
| **Impact** | Low — likely works fine, but version inconsistency could cause subtle issues with response shapes or deprecated fields. |
| **What's Needed to Fix** | Centralize API version to a single constant in `config.ts`. |
| **Owner Type** | Backend |

---

## ISS-021: "Waitlist" Status Not in bookings CHECK Constraint

| Field | Value |
|-------|-------|
| **ID** | ISS-021 |
| **Title** | Bookings tab has "Waitlist" tab but 'WAITLIST' is not a valid status in the DB schema |
| **Severity** | Major |
| **Area** | Data / Frontend |
| **Symptoms** | Clicking the "Waitlist" tab shows 0 bookings (even if any existed, they couldn't be stored). |
| **Root Cause** | `Bookings.tsx` L29 defines a "Waitlist" tab mapping to `status: 'WAITLIST'`. Migration `0001_schema.sql` L57 defines `CHECK(status IN ('HOLD','CONFIRMED','RELEASED','EXPIRED','INVALID','CANCELLED'))` — 'WAITLIST' is not in the allowed values. The backend `handleBookingsGet` in `admin.ts` L603 has `validStatuses` set including `'WAITLIST'`, but no booking can actually be stored with that status. |
| **Evidence** | `Bookings.tsx` L29: `{ id: 'waitlist', content: 'Waitlist' }`. `0001_schema.sql` L57: CHECK constraint excludes WAITLIST. `admin.ts` L603: `validStatuses` includes WAITLIST. |
| **Impact** | Dead tab — will always show 0 results. Creating a booking with WAITLIST status would fail at DB level. |
| **What's Needed to Fix** | Either add 'WAITLIST' to the bookings status CHECK constraint (requires migration), or remove the tab from the UI. |
| **Owner Type** | Fullstack |

---

## ISS-022: Dashboard Loads ALL Bookings for Calendar Without Filters

| Field | Value |
|-------|-------|
| **ID** | ISS-022 |
| **Title** | Dashboard fetches all bookings (no status/date filter) for calendar view |
| **Severity** | Minor |
| **Area** | Performance / Backend |
| **Symptoms** | For stores with many bookings, the initial Dashboard load could be slow. |
| **Root Cause** | `Dashboard.tsx` `loadData` L230: `fetch('/bookings')` with no query params — returns all bookings for the shop. These are used for the calendar count. |
| **Evidence** | `Dashboard.tsx` L230: `fetch('/bookings')` — no filters. |
| **Impact** | Performance degradation with scale. The calendar only needs booking count per day for the visible month. |
| **What's Needed to Fix** | Add date range filter to limit to visible calendar month, or create a dedicated lightweight calendar endpoint. |
| **Owner Type** | Fullstack |
