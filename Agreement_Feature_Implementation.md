# Agreement Feature Implementation Plan (Shopify App + Theme)

**Feature name:** Agreement  
**Goal:** Require customers to read and sign a PDF agreement (signature drawn in-browser) **before they can proceed to checkout**, but **only when the cart contains specific “bookable/rentable” products** (the same product set the app already manages under “Inventory”).

This document is a **full implementation strategy** for adding the Agreement feature to the existing system built across:

- **Repo A (Shopify App):** `MexicanGolfCartApp`  
  - Contains:
    - Shopify embedded admin app front-end (Cloudflare Pages).
    - Cloudflare Worker backend (D1 database + app proxy endpoints).
    - Existing Theme App Extension (`product-booking-widget`) that interacts with the Worker via Shopify App Proxy.
- **Repo B (Shopify Theme):** `MexicanGolfCarts`  
  - The store’s theme. Notably includes cart page + cart drawer checkout controls we need to intercept.

---

## 1) Requirements Recap (as provided)

### Admin (embedded app)
1) Add a new sidebar view: **“Agreement”**  
   - Store admin can:
     - Upload a new agreement (PDF).
     - Configure where the **signature box** should appear on the PDF (position + size).
     - View list of all signed agreements (and open/download signed docs).

### Storefront (cart)
2) Add a Shopify **App Widget** that can be added to the cart view.
   - Must **disable the default Checkout button** and replace it with **“Sign & Checkout”**.
   - Clicking “Sign & Checkout” opens the agreement modal.
   - Customer can only checkout **after signing**.
   - Widget **only activates when cart contains at least 1 of the “Inventory” products** (the “rentable/bookable” products).

### Modal flow
3) Modal UX rules:
   - Modal content:
     - Title
     - **“Sign PDF”** button
     - Agreement shown below (but initially hidden, with **“View PDF”** button shown).
   - After clicking **“Sign PDF”**:
     - Show drawing input signature box + buttons **Confirm / Clear**
   - After **Confirm**:
     - Show agreement again **with signature filled in** at the configured area
     - Show final **“Submit & Checkout”** button

---

## 2) Current System Overview (what’s already there)

### 2.1 Cloudflare hosting model (high-level)
The system is split into **two deployments**:

1) **Cloudflare Pages**: embedded admin UI (and/or Remix app web UI)  
2) **Cloudflare Worker**: backend API + Shopify App Proxy endpoints + webhooks, using **D1** for persistence.

> If there are additional Cloudflare resources (R2, KV, etc.), they are not obvious from the Worker binding setup. This doc includes explicit “TBD” placeholders where storage choices need confirmation.

### 2.2 Backend patterns (Worker)
The Worker already supports:
- **Admin API** endpoints under `/admin/*` (authenticated with Shopify session/JWT token)
- **App Proxy** endpoints under `/proxy/*` (consumed by storefront theme extensions)
- **Webhooks**, including `orders/create`

The Worker uses **Cloudflare D1** with existing tables like `shops`, `products`, `locations`, `inventory_day`, and `bookings`.

### 2.3 Product applicability (“the 3 Inventory products”)
There is already a concept of rentable/bookable products (managed in admin “Products” and “Inventory”). The existing proxy config endpoint returns **products filtered by rentable**.

**Agreement feature should reuse this:**
- Agreement required if cart contains any product where `rentable = 1` (or whichever criteria the app currently uses for “Inventory” eligibility).
- If the business truly needs “exactly 3 products” always, we can enforce it by configuration, but the architecture should treat it as “rentable products” so it stays consistent with Inventory selection.

### 2.4 Theme specifics (important for checkout interception)
In the theme:
- Cart page checkout button typically has `id="checkout"` and `name="checkout"`.
- Cart drawer checkout button uses `id="CartDrawer-Checkout"` and submits `form="CartDrawer-Form"`.

Our widget needs to handle:
- Cart page (template cart)
- Cart drawer (drawer snippet)
- Ajax cart updates (quantity changes, add/remove, etc.)

Also, there are references to “signpanda” CSS customizations in the cart template, suggesting there may have been a prior signature solution. We should be careful not to conflict with any legacy scripts.

---

## 3) Proposed Architecture (end-to-end)

### 3.1 Data model changes (D1)
We add 2–3 tables.

#### Table: `agreements`
Represents versions of the agreement PDF + signature placement config.

Fields (suggested):
- `id` TEXT (UUID) PRIMARY KEY
- `shop_domain` TEXT (FK to shops.domain) — if multi-store is possible
- `version` INTEGER (incremented per upload)
- `active` INTEGER (0/1) — only one active at a time
- `title` TEXT — optional display title
- `pdf_storage_type` TEXT — `"R2" | "D1" | "SHOPIFY_FILES" | "EXTERNAL"`
- `pdf_storage_key` TEXT — object key or identifier
- `pdf_sha256` TEXT — helpful for caching/integrity
- `page_number` INTEGER — which page to place signature
- `x` REAL, `y` REAL, `width` REAL, `height` REAL
  - Coordinates are relative to the PDF page, using a normalized coordinate system (see 3.3.3)
- `created_at` TEXT (ISO date)
- `created_by` TEXT — optional admin user

#### Table: `signed_agreements`
One row per signature event (typically 1 per checkout attempt).

Fields (suggested):
- `id` TEXT (UUID) PRIMARY KEY
- `shop_domain` TEXT
- `agreement_id` TEXT (FK agreements.id)
- `cart_token` TEXT — obtained from `/cart.js`
- `checkout_url` TEXT — optional, if we want to store
- `order_id` TEXT — filled in later when webhook arrives
- `customer_email` TEXT — optional; may not exist pre-checkout
- `signature_png_base64` TEXT OR `signature_storage_key` TEXT
- `signed_pdf_storage_key` TEXT — optional; only if we generate/store a merged signed PDF
- `signed_at` TEXT
- `status` TEXT — `"pending" | "linked_to_order" | "expired"`

#### Optional Table: `agreement_settings`
If we want store-level toggles:
- enable/disable agreement
- apply-to-products override
- expiration window for pending signatures, etc.

**Migration strategy:** Create a new migration file under `worker/migrations/` and include these tables. Keep it additive and non-breaking.

---

## 3.2 Backend APIs (Worker)

### 3.2.1 Admin endpoints (embedded app uses these)
These endpoints are used by the new “Agreement” sidebar page.

**Routes (suggested):**
- `GET /admin/agreement/current`
  - returns active agreement metadata (title, version, signature rect, and PDF access URL)
- `POST /admin/agreement/upload`
  - multipart or base64 PDF upload
  - creates new agreement version, sets active, stores pdf
- `POST /admin/agreement/placement`
  - updates signature placement config: page + rect
- `GET /admin/agreement/signed`
  - list signed agreements (pagination + search by date/order/email)
- `GET /admin/agreement/signed/:id`
  - details + download urls
- `POST /admin/agreement/activate/:id`
  - set active agreement version

**Auth:** Reuse existing admin auth middleware. The Worker already authenticates admin requests—extend the router for the new paths in the same style as existing `products`, `locations`, `inventory` endpoints.

### 3.2.2 Proxy endpoints (storefront widget uses these via App Proxy)
These are public-from-storefront but still scoped by `shop=` param.

**Routes (suggested):**
- `GET /proxy/agreement/current?shop=...`
  - returns:
    - agreement metadata for storefront
    - signature rect
    - **a temporary, cacheable PDF URL** (see storage options)
    - optionally: `applicable_product_ids` (or reuse `/proxy/config`)
- `POST /proxy/agreement/sign?shop=...`
  - body includes:
    - cart_token
    - agreement_id
    - signature image (PNG data URL or binary)
    - browser fingerprint bits (optional), and timestamp
  - returns:
    - signed_agreement_id
    - maybe a rendered preview URL or a “server-signed PDF URL” if we generate it

**Important:** We should NOT trust the client for “agreement required” decisions. The client decides whether to show the flow, but backend should validate what it stores (e.g., confirm agreement_id exists and is active).

### 3.2.3 Orders webhook linkage (`orders/create`)
We need to link the agreement signature to the eventual order.

**Recommended approach (robust + Shopify-native):**
1) When the signature is captured and backend returns `signed_agreement_id`, the storefront script calls:
   - `POST /cart/update.js`
   - `attributes[agreement_signature_id] = <signed_agreement_id>`
   - optionally `attributes[agreement_version] = <version>`
2) When Shopify emits `orders/create`, the webhook handler reads `note_attributes` and extracts `agreement_signature_id`, then updates `signed_agreements.order_id` and status.

This avoids needing a checkout token and works reliably for cart → order correlation.

**Edge cases:**
- Customer abandons checkout after signing: keep signature record with status `pending`, expire after N days.
- Customer edits cart after signing: our widget can invalidate and require re-sign if rentable items changed (recommended).

---

## 3.3 Storefront Widget (Theme App Extension)

### 3.3.1 Extension type
Create a new Theme App Extension, for example:
- `extensions/agreement-cart-widget/`
  - `blocks/agreement-cart-widget.liquid`
  - `assets/agreement-cart-widget.js`
  - `assets/agreement-cart-widget.css` (optional)
  - `shopify.extension.toml`

The block should target the cart section (or be addable on cart pages) and primarily exists to load JS and mount a modal.

### 3.3.2 What the JS must do
At runtime, the script must:

1) Detect whether the page has:
   - cart page checkout button (`#checkout`)
   - cart drawer checkout button (`#CartDrawer-Checkout`)

2) Fetch applicability:
   - `GET /cart.js` to get cart line items and cart_token
   - `GET <API_BASE>/config?shop=...` (or `agreement/current`) to get rentable product IDs
   - If cart contains applicable product(s):
     - Hide/disable default checkout buttons
     - Insert “Sign & Checkout” buttons in the same CTA containers

3) On “Sign & Checkout” click:
   - Open modal
   - Load agreement metadata and PDF access URL
   - Respect the UI states described in requirements

4) Capture signature:
   - Provide a canvas drawing area
   - Implement Clear / Confirm actions
   - On Confirm:
     - Freeze signature
     - Render preview overlay on PDF (client-side)
     - Show “Submit & Checkout”

5) Submit signature:
   - `POST <API_BASE>/agreement/sign?shop=...` with signature data and cart_token
   - Receive `signed_agreement_id`
   - Write to cart attributes via `/cart/update.js`
   - Then trigger actual checkout by submitting the original checkout form/button

6) Keep in sync with cart changes:
   - MutationObserver on cart DOM, plus listening to theme’s cart update events if any
   - Re-run applicability when cart changes (remove rentable item => restore original checkout button)

### 3.3.3 Signature placement coordinate system (critical)
The admin defines a rectangle on a PDF page. We need a stable way to represent that on both admin and storefront.

**Recommended: store normalized coordinates**
- `x`, `y`, `width`, `height` as values from 0.0 to 1.0 relative to the PDF page width/height.
- Origin: top-left (consistent with browser rendering).

Then, when rendering:
- Use PDF.js page viewport size to map normalized → actual px.
- When generating a signed PDF server-side (pdf-lib), convert normalized → PDF points with PDF origin bottom-left (requires transforming `y`).

This keeps placement stable across device sizes.

### 3.3.4 Modal UI State Machine (exact requirement mapping)
Implement a simple state machine:

**State A: Closed**
- Default checkout shown unless applicable items exist.

**State B: Open / Pre-sign**
- Title
- Buttons:
  - “Sign PDF” (primary)
  - “View PDF” (secondary) if PDF is hidden
- Agreement preview area:
  - Hidden by default
  - When “View PDF” clicked → show embedded PDF preview (iframe/object or PDF.js render)

**State C: Signing**
- Show agreement preview (recommended) + signature canvas overlay at configured rect
- Buttons under signature pad:
  - Confirm
  - Clear

**State D: Confirmed**
- Render agreement again with signature “burned in” visually (overlay) at rect
- Show final CTA:
  - “Submit & Checkout”

**State E: Submitting**
- Disable buttons, show spinner
- Submit to backend, then set cart attributes, then checkout

**State F: Error**
- Show error banner, allow retry

---

## 3.4 PDF + Signature Rendering Options

### Option 1 (fastest): Client-only overlay + store signature separately
- Store signature image + metadata in D1
- Do not generate a merged “signed PDF”
- Admin viewing UI overlays signature when previewing

Pros: simpler, no PDF manipulation in Worker  
Cons: admin might want the actual signed PDF artifact

### Option 2 (recommended): Generate a signed PDF server-side
- Use `pdf-lib` (or similar) in the Worker:
  - Load original PDF bytes
  - Embed signature PNG
  - Draw onto specified page at specified coords
  - Output signed PDF bytes
- Store signed PDF in **R2** (recommended) or another storage

Pros: strong compliance artifact; easy download  
Cons: requires implementing PDF byte storage (see 3.5)

### Option 3: Store PDF inside Shopify Files
- Upload active agreement PDF to Shopify Files via Admin API
- Use the Shopify CDN URL for storefront display and admin preview

Pros: no need for R2; Shopify handles delivery  
Cons: requires permissions + API integration; managing versions becomes trickier

**Decision:**
- **Primary:** Store signature images (PNG) as base64 or BLOB in D1 (Table: `signed_agreements`). This is sufficient for the immediate requirement and avoids provisioning new infrastructure.
- **Agreement PDF:** Store the blank agreement PDF in **Shopify Files** (uploaded via Admin) or typically hosted externally. 
- **Future:** If "compliance-grade" signed PDFs are strictly required later, we will add an R2 binding. For now, we proceed without R2 to speed up implementation.

---

## 3.5 Storage Strategy (Cloudflare)
We must store:
- Active agreement PDF (and maybe old versions)
- Optional signed PDFs
- Signature images (PNG)

### Storage candidates
1) **Cloudflare R2 (preferred)**  
   - Store PDFs as objects: `agreements/<shop>/<agreementId>.pdf`
   - Store signed: `signed/<shop>/<signedId>.pdf`
   - Store signature PNG: `signatures/<shop>/<signedId>.png`
2) **D1 BLOB / base64**  
   - Works for small signatures
   - **Not recommended** for multi-page PDFs (size, performance)
3) **Shopify Files**  
   - Good for the active agreement PDF
   - Not great for per-customer signed PDFs unless you want to create many files

**Decision:**  
- Store signature image in D1 for speed + simplicity
- Store agreement PDF in R2 (or Shopify Files if R2 not available)
- Store signed PDFs in R2 if generating them

**TBD (Cloudflare system check):**
- Confirm if Worker already has R2 buckets / KV namespaces bound in `wrangler.toml` and production environment.
- If not, add them safely and update deployment pipeline accordingly.

---

## 4) Admin Dashboard Implementation (Agreement page)

### 4.1 UI layout in admin
Add a new Nav item in the embedded app sidebar: **Agreement**.

Page sections:
1) **Active Agreement**
   - Title/version
   - Uploaded timestamp
   - Buttons:
     - “Upload New Agreement”
     - “Preview / Download PDF”
2) **Signature Placement Editor**
   - PDF preview with page selection
   - Drag-resizable rectangle overlay for signature area
   - Save button
3) **Signed Agreements**
   - Table list: date, status, order id, downloadable signed PDF (if available)
   - Filters: date range, order id, status
   - Row details: signature image preview

### 4.2 Placement editor implementation detail
Use PDF.js (client-side) to render PDF pages into canvas. Then:
- Overlay a draggable/resizable div to represent the signature rectangle
- Convert rectangle to normalized coords and save via `/admin/agreement/placement`

This is also reusable on storefront:
- Storefront can use the same rendering strategy to place the signature pad.

### 4.3 Upload flow
Upload a PDF from admin page:
- Prefer multipart upload to `/admin/agreement/upload`
- Worker stores file (R2/Shopify Files/D1) and creates a new agreement version
- Worker returns new agreement metadata

Validation:
- Only allow PDF mime types
- Max size threshold (TBD)

---

## 5) Implementation Plan (phased)

### Phase 0 — Discovery (required because of Cloudflare/storage uncertainty)
- Confirm:
  - **Storage:** R2 is **not** currently bound. We will use D1 for signature images and existing content (Shopify Files) for the PDF.
  - **Deployments:** Pages for frontend, Worker for backend.
  - **Admin UI:** Confirmed as **Vite React SPA** (`apps/admin`).
- Confirm agreement PDF size and expected number of signatures/day (storage sizing)

### Phase 1 — Database + backend scaffolding
1) Create D1 migration:
   - `agreements`
   - `signed_agreements`
2) Extend Worker admin router:
   - `GET/POST` endpoints listed above
3) Extend Worker proxy router:
   - `GET /proxy/agreement/current`
   - `POST /proxy/agreement/sign`
4) Update orders webhook handler:
   - Extract cart attributes from order
   - Link signature id → order id

Deliverable:
- Back-end fully supports storing signatures and serving agreement metadata.

### Phase 2 — Admin UI: Agreement page
1) Add sidebar item “Agreement”
2) Implement Agreement page UI skeleton:
   - Active agreement info
   - Upload action
   - Signed list (mocked)
3) Implement placement editor using PDF.js
4) Hook up real endpoints
5) Add signed agreement downloads/previews

Deliverable:
- Admin can upload agreement, set placement, and see signed records.

### Phase 3 — Storefront extension: cart widget + modal
1) Create new Theme App Extension block
2) Implement DOM interception:
   - hide/disable checkout on cart page and cart drawer
   - insert “Sign & Checkout”
3) Implement modal state machine and signature pad
4) Implement “Submit & Checkout” sequence:
   - submit signature to proxy endpoint
   - set cart attribute
   - checkout

Deliverable:
- Customer must sign before checkout when applicable items exist.

### Phase 4 — Signed PDF generation (optional but recommended)
- Implement pdf-lib worker function:
  - merge signature into the PDF at configured rect
- Store signed PDF in R2
- Add download links in admin UI

Deliverable:
- Compliance-grade signed PDF artifact.

---

## 6) UX/Engineering Edge Cases (don’t skip)

### Cart changes after signing
If a user signs and then changes cart:
- If rentable items are removed → restore normal checkout and optionally clear cart attribute
- If rentable items remain but quantities change → signature still valid (probably)
- If the agreement changes version while user has modal open → require reload and re-sign

### Mobile & touch signature
Ensure signature pad supports:
- pointer events
- touch events
- high-DPI canvas scaling

### Accessibility
- Modal traps focus
- Keyboard navigation
- Clear error messages

### Security
- Do not trust the browser for “agreement is required”
- Validate `shop` parameter via proxy HMAC (Shopify app proxy signature) if currently used; if not, add it.
- Rate-limit `/proxy/agreement/sign` (basic anti-spam)

### Performance
- Cache agreement metadata and PDF URL aggressively (public cache with version hash)
- Lazy load PDF only when user clicks “View PDF” or “Sign PDF”

---

## 7) Testing Strategy

### Unit tests (Worker)
- Agreement versioning logic
- Placement normalization conversions
- Proxy signing endpoint validation
- Webhook order linkage via cart attributes

### Integration tests
- Install app in dev store
- Add rentable item to cart → checkout replaced
- Sign → cart attribute set → checkout proceeds
- Verify webhook links signature record to created order

### Manual QA matrix
- Cart page vs cart drawer
- Mobile Safari/Chrome
- Multiple rentable items
- Mixed carts (rentable + normal products)
- Empty cart
- Slow network

---

## 8) Confirmed Architecture Decisions

1) **PDF storage**:
   - **Status:** R2 is NOT currently bound in `wrangler.toml`.
   - **Decision:** We will **not** use R2 for Phase 1. 
   - We will store **signature images** (Data URLs) directly in D1 (text/blob).
   - We will link the **Agreement PDF** via a public URL (e.g. uploaded to Shopify Files).

2) **Admin UI architecture**:
   - **Status:** Confirmed `apps/admin` (Vite + React + Polaris) is the active admin frontend.
   - **Action:** All admin UI changes happen in `apps/admin/src/...`.

3) **Proxy security**:
   - **Status:** Verification code exists in `worker/src/security.ts` but is **commented out** in `worker/src/proxy.ts`.
   - **Decision:** We **MUST uncomment and enable** `verifyProxySignature` in `handleProxyRequest` as part of this feature to ensure valid signatures.

4) **Signed PDF requirement**:
   - **Decision:** We will implement **Option 1 (Signature Image only)** for now. The "signed agreement" will be a record in the database linking the Cart/Order to the version of the agreement signed + the captured signature image.
   - **Reason:** Avoids need for R2 overhead immediately.

---

## 9) Suggested File/Code Touchpoints (where changes go)

### Worker (backend)
- `worker/src/admin.ts`
  - add agreement admin endpoints
- `worker/src/proxy.ts`
  - add `/agreement/current` and `/agreement/sign`
- `worker/src/webhooks/ordersCreate.ts` (or wherever orders/create is handled)
  - link agreement_signature_id attribute to `signed_agreements.order_id`
- `worker/migrations/`
  - add new migration file

### Admin UI
- `apps/admin/src/App.tsx`
  - add `<NavMenu.Item>` for `/agreement`
  - add a route definition
- `apps/admin/src/pages/Agreement.tsx` (new)
  - implement UI described above
- `apps/admin/src/api.ts` or fetch helpers
  - add API calls for agreement endpoints

### Theme app extension
- `apps/shopify/mexican-golf-cart/extensions/agreement-cart-widget/` (new)
  - liquid block and JS assets

### Theme repo (optional)
- No required code change if the merchant adds the app block through theme editor.
- Only adjust theme if we want the block pre-inserted or need custom placement.

---

## 10) Acceptance Criteria (what “done” means)
1) Admin can:
   - Upload a PDF agreement
   - Configure signature placement
   - View signed agreements list and open/download the signature data (and signed PDF if implemented)
2) Storefront:
   - On cart page/drawer, checkout is replaced with “Sign & Checkout” when cart contains rentable products
   - Modal behaves exactly as specified
   - User cannot checkout without signing
   - After signing, “Submit & Checkout” proceeds to normal Shopify checkout
3) Backend:
   - Stores signature records in DB
   - Links signature record to order on `orders/create` webhook
   - (Optional) Generates and stores signed PDFs

## 11) Risk Mitigation (CRITICAL)
- **Proxy Verification:** The `security.ts` implementation for App Proxy uses `.join('')` but many documentation sources suggest `.join('&')`.
  - **Action:** When uncommenting `verifyProxySignature`, apply it **ONLY** to the new `/agreement/sign` route first. Do **NOT** enable it for `/availability` or `/hold` until you have confirmed it works by successfully submitting a signature.
  - **Prevention:** This ensures that if the verification logic is flawed, we do not break the *existing* live booking widget on the storefront.


---

If you want, I can also produce a follow-up document that’s essentially a “task breakdown PR plan” (file-by-file diffs + endpoint contracts + UI component tree) once the TBD storage and admin-UI architecture points are confirmed.
