# Admin Dashboard Review (Cloudflare Pages Admin App)

## Scope
Admin UI reviewed under apps/admin. Backend reviewed under worker/src/admin.ts and D1 schema (worker/migrations).

## Backend Admin Endpoints (Available)
- GET /admin/locations
- POST /admin/locations
- PATCH /admin/locations/:id
- GET /admin/products
- PATCH /admin/products/:product_id
- GET /admin/inventory?product_id=&start_date=&end_date=
- PUT /admin/inventory
- GET /admin/bookings?status=&start_date=&end_date=
- GET /admin/bookings/:booking_token
- GET /admin/dashboard

## Findings by View

### 1) Dashboard (apps/admin/src/pages/Dashboard.tsx)
**Data sources**
- Uses GET /admin/bookings (no params) via useAuthenticatedFetch.

**Functional / connected**
- Upcoming bookings list is populated from bookings returned by /admin/bookings.
- Calendar counts bookings per day (by start_date) using bookings from /admin/bookings.

**Not connected / placeholder / incorrect**
- Stats cards (Revenue, Bookings, Cancelled, Views) are computed client-side and are mock values (revenue derived from order_id, views fixed 0). No backend stats endpoint used even though /admin/dashboard exists.
- ProductInventory component is entirely placeholder data (static images, bookings, revenue, availability).
- Header buttons (FAQ, New service) do not trigger any action.
- Filter buttons (Last 30 days, All services) are static; no filtering or backend queries.
- Upcoming bookings search bar label references customer name/email, but backend data does not include customer name/email. Search only filters booking_token or location_code.
- BookingCard actions (View, Manage, Mark as Completed) are UI-only; no API calls.
- Uses client timezone for date comparisons (new Date()) rather than store timezone.

**Columns / UI elements**
- Stats cards: Revenue, Bookings, Cancelled bookings, Views.
- Product list rows: image, name, total bookings, revenue, available.
- Calendar grid with count of bookings per day.
- Upcoming bookings list with card fields: order id, location, status badge, date range, quantity (fixed 1).

### 2) Bookings (apps/admin/src/pages/Bookings.tsx)
**Data sources**
- Uses GET /admin/bookings?status=... based on selected tab.

**Functional / connected**
- Tabs for Bookings (CONFIRMED), Canceled (CANCELLED), Pre-payment (HOLD), Abandoned (EXPIRED) map to backend status filter and render bookings.
- Client-side search filters booking_token, location_code, order_id.

**Not connected / placeholder / incorrect**
- Waitlist tab requests status=WAITLIST which is not a valid status in D1 schema (no WAITLIST). Will return zero.
- Bookings calendar tab renders <BookingsCalendar /> with no data prop; it shows empty calendar even if bookings exist.
- Services availabilities tab is placeholder text only.
- Filter buttons (Upcoming, All services, All types, All statuses) are static; no filtering and no backend support.
- Export button has no action.
- Manual booking button has no action.
- Search bar label says customer name/email, but no such fields exist in backend payload.
- Uses client timezone for date filtering and calendar.

**Columns / UI elements**
- Booking cards show order id, location, status, booking token, date range, quantity.

### 3) Inventory (apps/admin/src/pages/Inventory.tsx)
**Data sources**
- Uses GET /admin/products to populate a “Shopify Product” dropdown.
- Uses GET /admin/inventory for a single product_id (driver) and date range.
- Uses PUT /admin/inventory to update capacity for a single product_id.

**Functional / connected**
- Inventory table for Product 1 uses real inventory data (capacity/reserved_qty) from /admin/inventory.
- Update availability modal updates Product 1 capacity via PUT /admin/inventory.

**Not connected / placeholder / incorrect**
- Product cards (3 items) are static placeholders (images, titles, price, features, capacity) and are not tied to backend products.
- Product “settings” modal only updates local state; no persistence to DB or backend.
- Product 2 and Product 3 columns are mock data computed from placeholders, not from DB.
- /admin/products returns product configs only (product_id, rentable, default_capacity, deposit_*). UI expects title/image; dropdown will show undefined titles.
- “Link Shopify Product” dropdown uses /admin/products but that endpoint does not return Shopify product metadata; linkage is not persisted.
- Uses client timezone for date range boundaries and toISOString() (UTC), which can drift from store timezone.

**Columns / UI elements**
- Table headings: Date, Product 1 (Avail/Total), Product 2 (Avail/Total), Product 3 (Avail/Total), Action.
- Modal fields: capacities for P1, P2, P3 (only P1 persisted).

### 4) Locations (apps/admin/src/pages/Locations.tsx)
**Data sources**
- Uses GET /admin/locations, POST /admin/locations, PATCH /admin/locations/:id.

**Functional / connected**
- List loads from DB.
- Add and edit save to DB.

**Not connected / placeholder / incorrect**
- No UI to toggle “active” status; always uses existing value and defaults true on new.
- No delete action.

**Columns / UI elements**
- Resource list rows: name, code, lead time, min duration, active badge.

### 5) Products (apps/admin/src/pages/Products.tsx)
**Data sources**
- Uses GET /admin/products and PATCH /admin/products/:product_id.

**Functional / connected**
- Product config list loads from DB.
- Save persists rentable, default_capacity, deposit_multiplier.

**Not connected / placeholder / incorrect**
- Not accessible from NavMenu (page exists but no route entry).
- UI lacks fields for variant_id and deposit_variant_id though backend supports them.
- No Shopify product lookup or title display; list uses product_id only.

**Columns / UI elements**
- Resource list rows: product_id, capacity, deposit multiplier, rentable badge.

## Backend Issues Impacting Admin UI
- /admin/dashboard uses lowercase status values ('confirmed','hold') that do not match DB status enum (uppercase). If the dashboard endpoint is used, it will return incorrect counts.
- /admin/products does not include Shopify product metadata (title, image). Inventory UI expects title/image for dropdown and cards.
- No backend endpoint for aggregated dashboard stats by date range (revenue, views, bookings), nor endpoint for calendar counts per day across date ranges.

## Summary: What’s Fully Wired vs Not
**Fully wired to backend (core CRUD):**
- Locations list/add/edit.
- Products config list/update (but limited fields).
- Bookings list by status (confirmed/cancelled/hold/expired).
- Inventory table and capacity updates for a single product_id.

**Partially wired:**
- Dashboard uses bookings list but has placeholder stats and product inventory.
- Bookings search is client-side only and limited to booking_token/location/order_id.

**Not wired / placeholder:**
- Dashboard stats, ProductInventory, actions, and filters.
- Bookings calendar tab data, services availabilities tab.
- Waitlist tab (unsupported status).
- Inventory cards, product settings modal, multi-product inventory columns.
- Products page route in nav; variant/deposit fields missing.

## Proposed Next Steps (No changes applied yet)
1) **Dashboard**
   - Wire dashboard stats to GET /admin/dashboard or create a new stats endpoint for revenue/bookings/cancelled/traffic with date range.
   - Replace ProductInventory placeholder with data from DB and/or Shopify product metadata.
   - Implement search against real fields (booking_token, location, order_id) and update placeholder text.
   - Add filter state (date range/service) and pass to backend queries.
   - Add actions for BookingCard (view detail via /admin/bookings/:token, manage, mark completed).

2) **Bookings**
   - Remove or re-map Waitlist tab to a valid status or create WAITLIST support in backend schema and flows.
   - Pass bookings data to BookingsCalendar; add date range filtering.
   - Implement export flow and define backend export endpoint if required.
   - Add API support for filter dropdowns (service/product, status, type, upcoming).

3) **Inventory**
   - Replace placeholder productDefinitions with data from DB/Shopify (product list with titles/images).
   - Support multi-product inventory in a single view or create per-product views backed by /admin/inventory.
   - Persist Product Settings modal to backend (add endpoint or re-use /admin/products + new metadata table).
   - Ensure store timezone used for date range and display.

4) **Locations**
   - Add UI toggle for active flag and update PATCH payload accordingly.
   - Add delete/disable action if needed.

5) **Products**
   - Add Products page to navigation and routes.
   - Add fields for variant_id and deposit_variant_id.
   - Add Shopify product lookup so list displays title/image and allows linking.

6) **Backend alignment**
   - Fix /admin/dashboard status casing to uppercase.
   - Add endpoints for aggregated metrics, calendar counts, and product metadata if needed.
   - Add search parameters on /admin/bookings (booking_token, location_code, order_id) if server-side search is required.

## Suggested Order of Work
1) Backend alignment (dashboard status casing, search params, product metadata endpoints).
2) Inventory wiring (product data source, multi-product inventory, settings persistence).
3) Dashboard wiring (stats + product inventory + actions).
4) Bookings tabs and calendar wiring.
5) Products and Locations enhancements.
