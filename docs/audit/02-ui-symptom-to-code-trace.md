# UI Symptom → Code Trace

This document traces each visible UI element from the provided screenshots back to its source code, handlers, API endpoints, and data models. Each section corresponds to a screenshot group.

---

## Screenshot 1: Bookings Page — Filter Bar (Top)

**Visible UI Elements:** Text field "Filter by customer name or email", Button "Upcoming", Dropdown "All services ▾", Dropdown "All types ▾", Dropdown "All statuses ▾", Up-arrow icon button, Button "Export"

**Source File:** `apps/admin/src/pages/Bookings.tsx` (lines 128–152)

| UI Element | Component/File | Handler/Function | API Endpoint | Data Model | Status | Failure Hypothesis | Evidence |
|-----------|---------------|-----------------|-------------|------------|--------|-------------------|----------|
| "Filter by customer name or email" TextField | `Bookings.tsx` L134–141 — Polaris `TextField` | `setSearchQuery` (state update) | None — **client-side filter only** | Filters `bookings` array by `booking_token`, `location_code`, `order_id` | ⚠️ Partially broken | **Does NOT search customer name/email** despite placeholder text. Backend `/admin/bookings` supports `search` param but Bookings page doesn't use it. Client-side filter (`filteredBookings`, L96–101) only checks `booking_token`, `location_code`, `order_id`. | `Bookings.tsx` L96–101: `b.booking_token.toLowerCase().includes(q) \|\| b.location_code.toLowerCase().includes(q) \|\| (b.order_id && b.order_id.toString().includes(q))` |
| "Upcoming" Button | `Bookings.tsx` L145 — `<Button variant="secondary">Upcoming</Button>` | **None** — no `onClick` prop | N/A | N/A | ❌ Stub | Button renders but has no handler. Does not toggle any state or filter parameter. | `Bookings.tsx` L145: `<Button variant="secondary">Upcoming</Button>` — no onClick |
| "All services ▾" Button | `Bookings.tsx` L146 — `<Button variant="secondary" disclosure>All services</Button>` | **None** — no `onClick` prop | N/A | N/A | ❌ Stub | Renders disclosure chevron but no dropdown/popover. No state. No filter logic. | `Bookings.tsx` L146 |
| "All types ▾" Button | `Bookings.tsx` L147 — `<Button variant="secondary" disclosure>All types</Button>` | **None** | N/A | N/A | ❌ Stub | Same as above. | `Bookings.tsx` L147 |
| "All statuses ▾" Button | `Bookings.tsx` L148 — `<Button variant="secondary" disclosure>All statuses</Button>` | **None** | N/A | N/A | ❌ Stub | Same. Note: status filtering happens via **Tabs** (L24–33), not this button. | `Bookings.tsx` L148 |
| Up-arrow icon Button | `Bookings.tsx` L149 — `<Button icon={ArrowUpIcon} />` | **None** | N/A | N/A | ❌ Stub | No onClick, no sort toggle. | `Bookings.tsx` L149 |
| "Export" Button | `Bookings.tsx` L150 — `<Button icon={ExportIcon}>Export</Button>` | **None** | N/A | N/A | ❌ Stub | No onClick handler. Does nothing. (Contrast with Dashboard's Export which works.) | `Bookings.tsx` L150 |

### Contrast with Dashboard Page

The Dashboard page (`Dashboard.tsx` L456–510) has **fully functional** versions of these same filters:
- "Upcoming" → `upcomingOnly` state toggle, sent as `date_preset=upcoming` query param
- "All services" → `FilterPopover` with `serviceOptions`, sent as `product_id` param
- "All teammates" → `FilterPopover` with `teammateOptions`, sent as `location_code` param
- "All types" → `FilterPopover` with `TYPE_OPTIONS`, sent as `fulfillment_type` param
- "All statuses" → `FilterPopover` with `STATUS_OPTIONS`, sent as `status` param
- "Upsell" → `FilterPopover` with `UPSELL_OPTIONS`, sent as `upsell` param
- Sort arrow → `sortDirection` state toggle, sent as `sort_direction` param
- Export → `handleExport()` generates CSV blob and triggers download

**The Bookings page filters are a visual copy of the Dashboard filters without any logic.**

---

## Screenshot 2: "Manual booking" Button

**Visible UI:** Black button "+ Manual booking"

**Source File:** `apps/admin/src/pages/Bookings.tsx` L111

| UI Element | Component/File | Handler/Function | API Endpoint | Data Model | Status | Failure Hypothesis | Evidence |
|-----------|---------------|-----------------|-------------|------------|--------|-------------------|----------|
| "+ Manual booking" Button | `Bookings.tsx` L111 — `<Button variant="primary" icon={PlusIcon}>Manual booking</Button>` | **None** — no `onClick` prop | `POST /admin/bookings` **does not exist** | Would need to create a `bookings` row + `booking_items` + `booking_days` + update `inventory_day` | ❌ Not implemented | Button is purely decorative. No handler, no modal, no form, no backend endpoint. Creating a booking requires the full hold-and-confirm flow that only the storefront proxy implements. | `Bookings.tsx` L111; `admin.ts` routing — no `POST /bookings` handler |

---

## Screenshot 3: Dashboard Page — "FAQ" and "+ New service" Buttons

**Visible UI:** Two buttons in the Dashboard header: "FAQ" (secondary) and "+ New service" (primary, black)

**Source File:** `apps/admin/src/pages/Dashboard.tsx` L429–432

| UI Element | Component/File | Handler/Function | API Endpoint | Data Model | Status | Failure Hypothesis | Evidence |
|-----------|---------------|-----------------|-------------|------------|--------|-------------------|----------|
| "FAQ" Button | `Dashboard.tsx` L431 — `<Button>FAQ</Button>` | **None** | N/A | N/A | ❌ Stub | No onClick handler. No FAQ page or content exists anywhere in the codebase. | `Dashboard.tsx` L431 |
| "+ New service" Button | `Dashboard.tsx` L432 — `<Button variant="primary" icon={PlusIcon}>New service</Button>` | **None** | N/A | N/A | ❌ Stub | No onClick handler. No service creation flow exists. "Service" concept maps to product configuration, which is handled on the Inventory page but not triggered from here. | `Dashboard.tsx` L432 |

---

## Screenshot 4: BookingCard — "View agreement", "Manage", "Mark as Completed" Buttons + Date Display

**Visible UI:** "View agreement" button (disabled/greyed), "Manage" button, "Mark as Completed" button (red), Date range "February 7, 2026 to February 9, 2026"

**Source File:** `apps/admin/src/components/BookingCard.tsx` L178–197

| UI Element | Component/File | Handler/Function | API Endpoint | Data Model | Status | Failure Hypothesis | Evidence |
|-----------|---------------|-----------------|-------------|------------|--------|-------------------|----------|
| "View agreement" Button | `BookingCard.tsx` L179–184 — `<Button icon={ViewIcon} onClick={openAgreementModal} disabled={!booking.signed_agreement_id}>` | `openAgreementModal()` (L99–115) — fetches agreement detail | `GET /admin/agreement/signed/:id` | `signed_agreements` + `agreements` tables | ✅ Works when `signed_agreement_id` is present | Button is **correctly disabled** when booking has no linked signed agreement. When present, it opens a full-screen modal with PDF preview. Backend endpoint exists and returns correct data shape. | `BookingCard.tsx` L99–115, L179–184; `admin.ts` `handleAgreementSignedDetail` |
| "Manage" Button | `BookingCard.tsx` L186 — `<Button variant="secondary">Manage</Button>` | **None** — no `onClick` prop | **No endpoint** | N/A | ❌ Stub | Button renders but clicking it does nothing. No booking detail/edit page exists. No navigation target. No modal. | `BookingCard.tsx` L186: bare `<Button>` with no handler |
| "Mark as Completed" Button | `BookingCard.tsx` L187–192 — `<Button variant="primary" tone="critical" onClick={() => setModalOpen(true)} disabled={booking.status === 'RELEASED'}>` | Opens confirmation modal → `handleConfirmComplete()` (L86–93) → calls `onMarkComplete(booking.booking_token)` | `POST /admin/bookings/:token/complete` | Updates `bookings.status` to `RELEASED`, fulfills Shopify order via REST API | ✅ Works | Correctly opens modal, calls parent's `handleMarkComplete`, which POSTs to backend. Backend changes status and attempts Shopify fulfillment. **Disabled when already RELEASED.** Minor issue: no success toast/feedback on completion. | `BookingCard.tsx` L86–93, L187–192; `Dashboard.tsx` L366–370; `admin.ts` `handleBookingComplete` |
| Date Range Display | `BookingCard.tsx` L195–197 — `formatDate(booking.start_date) to formatDate(booking.end_date)` | N/A (display only) | N/A | `bookings.start_date`, `bookings.end_date` | ✅ Works | Formats dates correctly. **Potential timezone issue:** `new Date(dateStr)` parses date strings (YYYY-MM-DD) in local timezone on the client, which may shift dates by one day depending on client TZ vs store TZ. | `BookingCard.tsx` L81–84: `const d = new Date(dateStr)` |

---

## Screenshot 5: Dashboard Page — Full Filter Bar

**Visible UI:** "Filter by customer name or email" text field, "Upcoming" pressed button, Dropdowns: "All services ▾", "All teammates ▾", "All types ▾", "All statuses ▾", "Upsell ▾", Up-arrow button, "Export" button

**Source File:** `apps/admin/src/pages/Dashboard.tsx` L456–510

| UI Element | Component/File | Handler/Function | API Endpoint | Data Model | Status | Notes |
|-----------|---------------|-----------------|-------------|------------|--------|-------|
| Search TextField | `Dashboard.tsx` L469–477 | `setSearchQuery` → debounced → `loadFilteredBookings(search)` | `GET /admin/bookings?search=...` | `bookings.booking_token`, `bookings.customer_name`, `bookings.customer_email`, `bookings.order_id` | ✅ Works | Server-side LIKE search. 350ms debounce. |
| "Upcoming" toggle | `Dashboard.tsx` L484–486 | `setUpcomingOnly` toggle | `date_preset=upcoming` → backend filters `start_date >= today` | `bookings.start_date` | ✅ Works | Uses `pressed` prop for visual state. |
| "All services ▾" | `Dashboard.tsx` L487–491 | `FilterPopover` → `setSelectedService` | `product_id=...` → backend EXISTS subquery on `booking_items` | `booking_items.product_id` | ✅ Works | Options populated from `GET /admin/products`. Labeled as "Service {id}" (numeric IDs, not product titles). |
| "All teammates ▾" | `Dashboard.tsx` L492–496 | `FilterPopover` → `setSelectedTeammate` | `location_code=...` → backend filters `bookings.location_code` | `bookings.location_code` + `locations.code`/`name` | ✅ Works | Options populated from `GET /admin/locations`. Label is "teammates" but data is locations. |
| "All types ▾" | `Dashboard.tsx` L497–501 | `FilterPopover` → `setSelectedType` | `fulfillment_type=Pick Up|Delivery` | `bookings.fulfillment_type` | ✅ Works | Two options: Pick Up, Delivery. |
| "All statuses ▾" | `Dashboard.tsx` L502–506 | `FilterPopover` → `setSelectedStatus` | `status=CONFIRMED|HOLD|...` | `bookings.status` | ✅ Works | All 6 status values available. |
| "Upsell ▾" | `Dashboard.tsx` L507–511 | `FilterPopover` → `setSelectedUpsell` | `upsell=with_upsell|without_upsell` | Derived from `booking_items` count | ✅ Works | Backend uses EXISTS/NOT EXISTS subquery on booking_items GROUP BY. |
| Sort arrow | `Dashboard.tsx` L512–518 | `setSortDirection` toggle | `sort_direction=asc|desc` | `bookings.start_date` ORDER BY | ✅ Works | Toggles between ascending/descending. |
| "Export" Button | `Dashboard.tsx` L519 | `handleExport()` (L379–417) — generates CSV, triggers blob download | None (client-side) | Uses `filteredBookings` state | ✅ Works | Exports currently filtered bookings to CSV. Disabled when 0 results. |

**Summary:** The Dashboard page's filter bar is **fully functional**. Every filter button is backed by a `FilterPopover` component with proper state, API query parameter integration, and server-side filtering.

---

## Cross-Screenshot Observations

### Elements Present but Permanently Disabled
- **"View agreement" button** on BookingCard: Correctly disabled when `signed_agreement_id` is null/undefined. Not a bug — just indicates no agreement was signed for that booking.

### Elements Present but are Stubs
- **All filter buttons on Bookings page** (Screenshot 1): Visual stubs, no functionality
- **"Manual booking" button** (Screenshot 2): No handler, no backend support
- **"FAQ" button** on Dashboard (Screenshot 3): No handler, no content
- **"+ New service" button** on Dashboard (Screenshot 3): No handler, no flow
- **"Manage" button** on BookingCard (Screenshot 4): No handler, no destination

### Elements That Work Correctly
- **"Mark as Completed" button** on BookingCard: Full flow working (modal → API → status update → Shopify fulfillment)
- **All Dashboard filter controls** (Screenshot 5): Full server-side filtering working
- **Dashboard Export**: CSV generation and download working
- **Search on Dashboard**: Server-side search with debounce working
- **Tabs on Bookings page**: Status-based tab switching working (CONFIRMED/CANCELLED/HOLD/WAITLIST/EXPIRED)
