import { Env } from './types';
import { SessionTokenPayload, verifySessionToken } from './auth';
import { checkRateLimit } from './rateLimit';
import { datePartsToIndex, listDateStrings, parseDateParts, getTodayInTimeZone } from './date';
import { DEFAULT_STORE_TIMEZONE, normalizeStoreTimezone, SHOPIFY_ADMIN_API_VERSION } from './config';

interface AdminAuthContext {
    shopId: number;
    shopDomain: string;
    shopTimezone: string;
    payload: SessionTokenPayload;
    /** The raw session token (JWT) used for token exchange if an access_token is needed. */
    sessionToken: string;
}

/**
 * Returns the shop's offline access token from D1, performing a Shopify token
 * exchange if one is not stored yet.  The exchanged token is persisted so
 * subsequent calls are fast.
 */
async function getShopAccessToken(
    env: Env,
    shopId: number,
    shopDomain: string,
    sessionToken: string
): Promise<string | null> {
    // 1. Check if we already have an access_token stored
    const row = await env.DB.prepare('SELECT access_token FROM shops WHERE id = ?')
        .bind(shopId)
        .first();
    if (row && typeof row.access_token === 'string' && row.access_token.length > 0) {
        return row.access_token as string;
    }

    // 2. Perform token exchange: session-token → offline access-token
    try {
        const body = new URLSearchParams({
            client_id: env.SHOPIFY_API_KEY,
            client_secret: env.SHOPIFY_API_SECRET,
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            subject_token: sessionToken,
            subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
        });

        const resp = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: body.toString(),
        });

        if (!resp.ok) {
            const txt = await resp.text();
            console.error('Token exchange failed', resp.status, txt);
            return null;
        }

        const data = (await resp.json()) as { access_token: string };
        const accessToken = data.access_token;
        if (!accessToken) {
            console.error('Token exchange returned empty access_token');
            return null;
        }

        // 3. Persist so we don't exchange on every request
        await env.DB.prepare('UPDATE shops SET access_token = ? WHERE id = ?')
            .bind(accessToken, shopId)
            .run();

        return accessToken;
    } catch (e) {
        console.error('Token exchange exception', e);
        return null;
    }
}

interface InventoryOverrideInput {
    date: string;
    capacity: number;
}

interface ManualBookingItemInput {
    product_id: number;
    variant_id?: number;
    qty: number;
}

interface ManualBookingRequestBody {
    start_date: string;
    end_date: string;
    location: string;
    items: ManualBookingItemInput[];
    customer_name?: string;
    customer_email?: string;
    fulfillment_type?: 'Pick Up' | 'Delivery';
    delivery_address?: string;
    revenue?: number;
}

interface NormalizedManualBookingItem {
    product_id: number;
    variant_id: number;
    qty: number;
    default_capacity: number;
}

interface BookingQuerySchema {
    hasInvalidReason: boolean;
    hasCustomerName: boolean;
    hasCustomerEmail: boolean;
    hasRevenue: boolean;
    hasFulfillmentType: boolean;
    hasDeliveryAddress: boolean;
    hasSignedAgreements: boolean;
}

export async function handleAdminRequest(request: Request, env: Env): Promise<Response> {
    const rate = checkRateLimit(rateLimitKey(request, 'admin'), 120, 60_000);
    if (!rate.allowed) {
        return rateLimitResponse(rate.resetAt);
    }

    const auth = await requireAdminAuth(request, env);
    if (auth instanceof Response) {
        return auth;
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/admin/, '');
    const segments = path.split('/').filter(Boolean);
    const method = request.method.toUpperCase();

    if (segments.length === 1 && segments[0] === 'locations') {
        if (method === 'GET') {
            return handleLocationsGet(env, auth.shopId);
        }
        if (method === 'POST') {
            return handleLocationsPost(request, env, auth.shopId);
        }
    }

    if (segments.length === 2 && segments[0] === 'locations') {
        if (method === 'PATCH') {
            const id = parsePositiveInt(segments[1]);
            if (!id) {
                return jsonError('Invalid location id', 400);
            }
            return handleLocationsPatch(request, env, auth.shopId, id);
        }
    }

    if (segments.length === 1 && segments[0] === 'products') {
        if (method === 'GET') {
            return handleProductsGet(env, auth.shopId);
        }
    }

    if (segments.length === 2 && segments[0] === 'products') {
        if (method === 'PATCH') {
            const productId = parsePositiveInt(segments[1]);
            if (!productId) {
                return jsonError('Invalid product id', 400);
            }
            return handleProductsPatch(request, env, auth.shopId, productId);
        }
        if (method === 'DELETE') {
            const productId = parsePositiveInt(segments[1]);
            if (!productId) {
                return jsonError('Invalid product id', 400);
            }
            return handleProductsDelete(env, auth.shopId, productId);
        }
    }

    if (segments.length === 1 && segments[0] === 'inventory') {
        if (method === 'GET') {
            return handleInventoryGet(request, env, auth.shopId);
        }
        if (method === 'PUT') {
            return handleInventoryPut(request, env, auth.shopId);
        }
    }

    if (segments.length === 1 && segments[0] === 'bookings') {
        if (method === 'GET') {
            return handleBookingsGet(request, env, auth);
        }
        if (method === 'POST') {
            return handleBookingsPost(request, env, auth);
        }
    }

    if (segments.length === 1 && segments[0] === 'dashboard') {
        if (method === 'GET') {
            return handleDashboardGet(env, auth);
        }
    }

    if (segments.length >= 2 && segments[0] === 'agreement') {
        if (segments.length === 2 && segments[1] === 'current') {
            if (method === 'GET') {
                return handleAgreementCurrent(env, auth.shopDomain);
            }
        }
        if (segments.length === 2 && segments[1] === 'upload') {
            if (method === 'POST') {
                return handleAgreementUpload(request, env, auth.shopDomain, auth.payload);
            }
        }
        if (segments.length === 2 && segments[1] === 'placement') {
            if (method === 'POST') {
                return handleAgreementPlacement(request, env, auth.shopDomain);
            }
        }
        if (segments.length === 2 && segments[1] === 'signed') {
            if (method === 'GET') {
                return handleAgreementSignedList(request, env, auth.shopDomain);
            }
        }
        if (segments.length === 3 && segments[1] === 'signed') {
            if (method === 'GET') {
                return handleAgreementSignedDetail(env, auth.shopDomain, segments[2]);
            }
        }
        if (segments.length === 3 && segments[1] === 'activate') {
            if (method === 'POST') {
                return handleAgreementActivate(env, auth.shopDomain, segments[2]);
            }
        }
    }

    if (segments.length === 2 && segments[0] === 'bookings') {
        if (method === 'GET') {
            return handleBookingGet(env, auth.shopId, segments[1]);
        }
    }

    if (segments.length === 3 && segments[0] === 'bookings' && segments[2] === 'complete') {
        if (method === 'POST') {
            return handleBookingComplete(env, auth, segments[1]);
        }
    }

    if (segments.length === 1 && segments[0] === 'shopify-products') {
        if (method === 'GET') {
            return handleShopifyProductsGet(env, auth);
        }
    }

    return new Response('Not Found', { status: 404 });
}

async function requireAdminAuth(request: Request, env: Env): Promise<Response | AdminAuthContext> {
    const token = getBearerToken(request);
    if (!token) {
        return jsonError('Missing session token', 401);
    }

    const payload = await verifySessionToken(
        token,
        env.SHOPIFY_API_SECRET,
        env.SHOPIFY_API_KEY,
        env.SHOPIFY_JWKS_URL
    );
    if (!payload) {
        return jsonError('Invalid session token', 401);
    }

    const shopDomain = safeUrlHost(payload.dest);
    if (!shopDomain) {
        return jsonError('Invalid token destination', 401);
    }

    let shopRow = await env.DB.prepare('SELECT id, timezone FROM shops WHERE shop_domain = ? AND uninstalled_at IS NULL')
        .bind(shopDomain)
        .first();

    if (!shopRow) {
        // Auto-provision: the session token is already verified (signature, exp,
        // aud, iss/dest) so the shop is legitimately installed.  The Remix host
        // handles OAuth via Prisma; the worker's D1 may not have the row yet.
        try {
            await env.DB.prepare(
                `INSERT INTO shops (shop_domain, installed_at, timezone)
                 VALUES (?, datetime('now'), ?)
                 ON CONFLICT(shop_domain) DO UPDATE SET uninstalled_at = NULL`
            )
                .bind(shopDomain, DEFAULT_STORE_TIMEZONE)
                .run();

            shopRow = await env.DB.prepare('SELECT id, timezone FROM shops WHERE shop_domain = ?')
                .bind(shopDomain)
                .first();
        } catch (e) {
            console.error('Auto-provision shop failed', e);
        }

        if (!shopRow) {
            return jsonError('Shop not found', 401);
        }
    }

    const shopTimezone = shopRow && isRecord(shopRow)
        ? normalizeStoreTimezone(shopRow.timezone)
        : DEFAULT_STORE_TIMEZONE;

    return {
        shopId: shopRow.id as number,
        shopDomain,
        shopTimezone,
        payload,
        sessionToken: token,
    };
}

async function handleLocationsGet(env: Env, shopId: number): Promise<Response> {
    const rows = await env.DB.prepare(
        'SELECT id, code, name, lead_time_days, min_duration_days, active FROM locations WHERE shop_id = ? ORDER BY name'
    )
        .bind(shopId)
        .all();
    return Response.json({ ok: true, locations: rows.results ?? [] });
}

async function handleLocationsPost(request: Request, env: Env, shopId: number): Promise<Response> {
    const body = await readJsonBody(request);
    if (!body) {
        return jsonError('Invalid JSON body', 400);
    }
    const code = getString(body, 'code');
    const name = getString(body, 'name');
    if (!code || !name) {
        return jsonError('Missing required fields', 400);
    }
    const leadTimeDays = getOptionalNumber(body, 'lead_time_days');
    const minDurationDays = getOptionalNumber(body, 'min_duration_days');
    const active = getOptionalBoolean(body, 'active');

    const leadValue = leadTimeDays ?? 1;
    const minValue = minDurationDays ?? 1;
    if (!Number.isInteger(leadValue) || leadValue < 0 || !Number.isInteger(minValue) || minValue < 1) {
        return jsonError('Invalid lead time or minimum duration', 400);
    }

    try {
        await env.DB.prepare(
            `INSERT INTO locations (shop_id, code, name, lead_time_days, min_duration_days, active)
             VALUES (?, ?, ?, ?, ?, ?)`
        )
            .bind(shopId, code, name, leadValue, minValue, active ?? true)
            .run();
        return Response.json({ ok: true });
    } catch (e) {
        console.error('Locations insert failed', e);
        return jsonError('Failed to create location', 500);
    }
}

async function handleLocationsPatch(
    request: Request,
    env: Env,
    shopId: number,
    locationId: number
): Promise<Response> {
    const body = await readJsonBody(request);
    if (!body) {
        return jsonError('Invalid JSON body', 400);
    }
    const existing = await env.DB.prepare(
        'SELECT code, name, lead_time_days, min_duration_days, active FROM locations WHERE shop_id = ? AND id = ?'
    )
        .bind(shopId, locationId)
        .first();
    if (!existing) {
        return jsonError('Location not found', 404);
    }

    const code = getOptionalString(body, 'code') ?? (existing.code as string);
    const name = getOptionalString(body, 'name') ?? (existing.name as string);
    const leadTimeDays = getOptionalNumber(body, 'lead_time_days') ?? (existing.lead_time_days as number);
    const minDurationDays = getOptionalNumber(body, 'min_duration_days') ?? (existing.min_duration_days as number);
    const active = getOptionalBoolean(body, 'active') ?? Boolean(existing.active);

    if (!code || !name) {
        return jsonError('Invalid location fields', 400);
    }
    if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0 || !Number.isInteger(minDurationDays) || minDurationDays < 1) {
        return jsonError('Invalid lead time or minimum duration', 400);
    }

    await env.DB.prepare(
        `UPDATE locations
         SET code = ?, name = ?, lead_time_days = ?, min_duration_days = ?, active = ?
         WHERE shop_id = ? AND id = ?`
    )
        .bind(code, name, leadTimeDays, minDurationDays, active, shopId, locationId)
        .run();

    return Response.json({ ok: true });
}

async function handleProductsGet(env: Env, shopId: number): Promise<Response> {
    const rows = await env.DB.prepare(
        'SELECT product_id, variant_id, rentable, default_capacity, deposit_variant_id, deposit_multiplier, updated_at FROM products WHERE shop_id = ? ORDER BY product_id'
    )
        .bind(shopId)
        .all();
    return Response.json({ ok: true, products: rows.results ?? [] });
}

async function handleProductsPatch(
    request: Request,
    env: Env,
    shopId: number,
    productId: number
): Promise<Response> {
    const body = await readJsonBody(request);
    if (!body) {
        return jsonError('Invalid JSON body', 400);
    }
    const rentable = getOptionalBoolean(body, 'rentable');
    const defaultCapacity = getOptionalNumber(body, 'default_capacity');
    const variantId = getOptionalNumber(body, 'variant_id');
    const depositVariantId = getOptionalNumber(body, 'deposit_variant_id');
    const depositMultiplier = getOptionalNumber(body, 'deposit_multiplier');

    if (defaultCapacity !== undefined && (!Number.isInteger(defaultCapacity) || defaultCapacity < 0)) {
        return jsonError('Invalid default capacity', 400);
    }
    if (depositMultiplier !== undefined && (!Number.isInteger(depositMultiplier) || depositMultiplier < 1)) {
        return jsonError('Invalid deposit multiplier', 400);
    }

    await env.DB.prepare(
        `INSERT INTO products (
            shop_id, product_id, variant_id, rentable, default_capacity,
            deposit_variant_id, deposit_multiplier, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(shop_id, product_id) DO UPDATE SET
            variant_id = COALESCE(excluded.variant_id, products.variant_id),
            rentable = COALESCE(excluded.rentable, products.rentable),
            default_capacity = COALESCE(excluded.default_capacity, products.default_capacity),
            deposit_variant_id = COALESCE(excluded.deposit_variant_id, products.deposit_variant_id),
            deposit_multiplier = COALESCE(excluded.deposit_multiplier, products.deposit_multiplier),
            updated_at = datetime('now')`
    )
        .bind(
            shopId,
            productId,
            variantId ?? null,
            rentable ?? null,
            defaultCapacity ?? null,
            depositVariantId ?? null,
            depositMultiplier ?? null
        )
        .run();

    return Response.json({ ok: true });
}

async function handleProductsDelete(env: Env, shopId: number, productId: number): Promise<Response> {
    await env.DB.prepare('DELETE FROM products WHERE shop_id = ? AND product_id = ?')
        .bind(shopId, productId)
        .run();
    return Response.json({ ok: true });
}

async function handleInventoryGet(request: Request, env: Env, shopId: number): Promise<Response> {
    const url = new URL(request.url);
    const productId = parsePositiveInt(url.searchParams.get('product_id') || '');
    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');

    if (!productId || !startDate || !endDate) {
        return jsonError('Missing required parameters', 400);
    }

    const dateList = listDateStrings(startDate, endDate);
    if (!dateList) {
        return jsonError('Invalid date range', 400);
    }

    const product = await env.DB.prepare(
        'SELECT default_capacity FROM products WHERE shop_id = ? AND product_id = ?'
    )
        .bind(shopId, productId)
        .first();
    if (!product) {
        return jsonError('Product not found', 404);
    }
    const defaultCapacity = product.default_capacity as number;

    const rows = await env.DB.prepare(
        'SELECT date, capacity, reserved_qty FROM inventory_day WHERE shop_id = ? AND product_id = ? AND date >= ? AND date <= ?'
    )
        .bind(shopId, productId, startDate, endDate)
        .all();
    const map = new Map<string, { capacity: number; reserved_qty: number }>();
    for (const row of rows.results ?? []) {
        map.set(row.date as string, {
            capacity: row.capacity as number,
            reserved_qty: row.reserved_qty as number,
        });
    }

    const inventory = dateList.map((date) => {
        const found = map.get(date);
        return {
            date,
            capacity: found ? found.capacity : defaultCapacity,
            reserved_qty: found ? found.reserved_qty : 0,
        };
    });

    return Response.json({ ok: true, inventory });
}

async function handleInventoryPut(request: Request, env: Env, shopId: number): Promise<Response> {
    const body = await readJsonBody(request);
    if (!body) {
        return jsonError('Invalid JSON body', 400);
    }
    const productId = getNumber(body, 'product_id');
    if (!productId || !Number.isInteger(productId) || productId <= 0) {
        return jsonError('Invalid product id', 400);
    }

    const overrides = body.overrides;
    if (!Array.isArray(overrides) || overrides.length === 0) {
        return jsonError('Missing overrides', 400);
    }

    const normalized: InventoryOverrideInput[] = [];
    const seenDates = new Set<string>();
    for (const entry of overrides) {
        if (!isRecord(entry)) {
            return jsonError('Invalid override entry', 400);
        }
        const date = getString(entry, 'date');
        const capacity = getNumber(entry, 'capacity');
        if (date === null || !parseDateParts(date)) {
            return jsonError('Invalid override date', 400);
        }
        if (capacity === null || !Number.isInteger(capacity) || capacity < 0) {
            return jsonError('Invalid override capacity', 400);
        }
        if (seenDates.has(date)) {
            return jsonError('Duplicate override date', 400);
        }
        seenDates.add(date);
        normalized.push({ date, capacity });
    }

    const statements: D1PreparedStatement[] = [];
    for (const override of normalized) {
        statements.push(
            env.DB.prepare(
                `INSERT OR IGNORE INTO inventory_day (shop_id, product_id, date, capacity, reserved_qty)
                 VALUES (?, ?, ?, ?, 0)`
            ).bind(shopId, productId, override.date, override.capacity)
        );
        statements.push(
            env.DB.prepare(
                `UPDATE inventory_day
                 SET capacity = ?
                 WHERE shop_id = ? AND product_id = ? AND date = ? AND reserved_qty <= ?`
            ).bind(override.capacity, shopId, productId, override.date, override.capacity)
        );
        statements.push(
            env.DB.prepare(
                `SELECT CASE WHEN EXISTS (
                    SELECT 1 FROM inventory_day
                    WHERE shop_id = ? AND product_id = ? AND date = ? AND reserved_qty <= ?
                ) THEN 1 ELSE 1/0 END;`
            ).bind(shopId, productId, override.date, override.capacity)
        );
    }

    try {
        await env.DB.batch(statements);
    } catch (e) {
        console.error('Inventory override failed', e);
        return jsonError('Inventory override failed', 409);
    }

    return Response.json({ ok: true });
}

async function handleBookingsPost(request: Request, env: Env, auth: AdminAuthContext): Promise<Response> {
    const shopId = auth.shopId;
    const body = await readJsonBody(request);
    if (!body) {
        return jsonError('Invalid JSON body', 400);
    }

    const parsed = parseManualBookingBody(body);
    if (!parsed) {
        return jsonError('Invalid booking request', 400);
    }

    const location = await env.DB.prepare(
        'SELECT code, lead_time_days, min_duration_days FROM locations WHERE shop_id = ? AND code = ? AND active = 1'
    )
        .bind(shopId, parsed.location)
        .first();
    if (!location) {
        return jsonError('Invalid location', 400);
    }

    const startParts = parseDateParts(parsed.start_date);
    const endParts = parseDateParts(parsed.end_date);
    if (!startParts || !endParts) {
        return jsonError('Invalid dates', 400);
    }

    const startIndex = datePartsToIndex(startParts);
    const endIndex = datePartsToIndex(endParts);
    if (startIndex > endIndex) {
        return jsonError('Start date must be before end date', 400);
    }

    const todayStr = getTodayInTimeZone(auth.shopTimezone);
    const todayParts = parseDateParts(todayStr);
    if (!todayParts) {
        return jsonError('Failed to read store date', 500);
    }

    const leadTimeDays = toNumber(location.lead_time_days);
    const minDurationDays = toNumber(location.min_duration_days);
    if (
        leadTimeDays === null ||
        minDurationDays === null ||
        !Number.isInteger(leadTimeDays) ||
        !Number.isInteger(minDurationDays)
    ) {
        return jsonError('Location rules are invalid', 500);
    }

    const todayIndex = datePartsToIndex(todayParts);
    const durationDays = endIndex - startIndex + 1;
    if (startIndex < todayIndex + leadTimeDays) {
        return jsonError('Start date violates lead time', 400);
    }
    if (durationDays < minDurationDays) {
        return jsonError('Below minimum duration', 400);
    }

    const uniqueProductIds = Array.from(new Set(parsed.items.map((item) => item.product_id)));
    if (uniqueProductIds.length === 0) {
        return jsonError('At least one item is required', 400);
    }

    const placeholders = uniqueProductIds.map(() => '?').join(', ');
    const productRows = await env.DB.prepare(
        `SELECT product_id, variant_id, rentable, default_capacity
         FROM products
         WHERE shop_id = ? AND product_id IN (${placeholders})`
    )
        .bind(shopId, ...uniqueProductIds)
        .all();

    const productMap = new Map<number, { variant_id: number | null; rentable: number; default_capacity: number }>();
    for (const row of productRows.results ?? []) {
        if (!isRecord(row)) {
            continue;
        }

        const productId = toNumber(row.product_id);
        const variantId = toNumber(row.variant_id);
        const rentableRaw = row.rentable;
        const rentable = toNumber(rentableRaw) ?? (typeof rentableRaw === 'boolean' ? (rentableRaw ? 1 : 0) : null);
        const defaultCapacity = toNumber(row.default_capacity);

        if (
            productId === null ||
            !Number.isInteger(productId) ||
            productId <= 0 ||
            rentable === null ||
            defaultCapacity === null ||
            !Number.isInteger(defaultCapacity)
        ) {
            continue;
        }

        productMap.set(productId, {
            variant_id: variantId,
            rentable,
            default_capacity: defaultCapacity,
        });
    }

    const normalizedItems = normalizeManualBookingItems(parsed.items, productMap);
    if (!normalizedItems) {
        return jsonError('Invalid product configuration', 400);
    }

    const dateList = listDateStrings(parsed.start_date, parsed.end_date);
    if (!dateList) {
        return jsonError('Invalid date range', 400);
    }

    const schema = await getBookingQuerySchema(env.DB);
    const bookingId = crypto.randomUUID();
    const bookingToken = crypto.randomUUID();
    const bookingColumns = [
        'id',
        'shop_id',
        'booking_token',
        'status',
        'location_code',
        'start_date',
        'end_date',
        'expires_at',
        'order_id',
        'created_at',
        'updated_at',
    ];
    const bookingValues = [
        '?',
        '?',
        '?',
        "'CONFIRMED'",
        '?',
        '?',
        '?',
        'NULL',
        'NULL',
        "datetime('now')",
        "datetime('now')",
    ];
    const bookingBindings: Array<string | number | null> = [
        bookingId,
        shopId,
        bookingToken,
        parsed.location,
        parsed.start_date,
        parsed.end_date,
    ];

    if (schema.hasCustomerName) {
        bookingColumns.push('customer_name');
        bookingValues.push('?');
        bookingBindings.push(parsed.customer_name ?? null);
    }
    if (schema.hasCustomerEmail) {
        bookingColumns.push('customer_email');
        bookingValues.push('?');
        bookingBindings.push(parsed.customer_email ?? null);
    }
    if (schema.hasRevenue) {
        bookingColumns.push('revenue');
        bookingValues.push('?');
        bookingBindings.push(parsed.revenue ?? null);
    }
    if (schema.hasFulfillmentType) {
        bookingColumns.push('fulfillment_type');
        bookingValues.push('?');
        bookingBindings.push(parsed.fulfillment_type ?? 'Pick Up');
    }
    if (schema.hasDeliveryAddress) {
        bookingColumns.push('delivery_address');
        bookingValues.push('?');
        bookingBindings.push(parsed.fulfillment_type === 'Delivery' ? parsed.delivery_address ?? null : null);
    }

    const statements: D1PreparedStatement[] = [];
    statements.push(
        env.DB.prepare(
            `INSERT INTO bookings (${bookingColumns.join(', ')})
             VALUES (${bookingValues.join(', ')})`
        ).bind(...bookingBindings)
    );

    for (const item of normalizedItems) {
        statements.push(
            env.DB.prepare(
                `INSERT INTO booking_items (booking_id, product_id, variant_id, qty)
                 VALUES (?, ?, ?, ?)`
            ).bind(bookingId, item.product_id, item.variant_id, item.qty)
        );
    }

    for (const date of dateList) {
        for (const item of normalizedItems) {
            statements.push(
                env.DB.prepare(
                    `INSERT OR IGNORE INTO inventory_day (shop_id, product_id, date, capacity, reserved_qty)
                     VALUES (?, ?, ?, ?, 0)`
                ).bind(shopId, item.product_id, date, item.default_capacity)
            );
            statements.push(
                env.DB.prepare(
                    `UPDATE inventory_day
                     SET reserved_qty = reserved_qty + ?
                     WHERE shop_id = ? AND product_id = ? AND date = ? AND reserved_qty + ? <= capacity`
                ).bind(item.qty, shopId, item.product_id, date, item.qty)
            );
            statements.push(env.DB.prepare('SELECT CASE WHEN changes() = 1 THEN 1 ELSE 1/0 END;'));
            statements.push(
                env.DB.prepare(
                    `INSERT INTO booking_days (booking_id, product_id, date, qty)
                     VALUES (?, ?, ?, ?)`
                ).bind(bookingId, item.product_id, date, item.qty)
            );
        }
    }

    try {
        await env.DB.batch(statements);
    } catch (e) {
        console.error('Manual booking creation failed', e);
        if (String(e).includes('division')) {
            return jsonError('Insufficient capacity', 409);
        }
        return jsonError('Failed to create booking', 500);
    }

    return Response.json({
        ok: true,
        booking_token: bookingToken,
        status: 'CONFIRMED',
    });
}

async function handleBookingsGet(request: Request, env: Env, auth: AdminAuthContext): Promise<Response> {
    const shopId = auth.shopId;
    // NOTE: This endpoint intentionally returns a flattened list for the admin UI.
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');
    const search = url.searchParams.get('search');
    const datePreset = url.searchParams.get('date_preset');
    const locationCode = url.searchParams.get('location_code');
    const fulfillmentType = url.searchParams.get('fulfillment_type');
    const upsell = url.searchParams.get('upsell');
    const sortDirectionParam = (url.searchParams.get('sort_direction') || 'desc').toLowerCase();
    const productIdParam = url.searchParams.get('product_id');
    const productId = productIdParam ? parsePositiveInt(productIdParam) : null;

    const validStatuses = new Set(['HOLD', 'CONFIRMED', 'RELEASED', 'EXPIRED', 'INVALID', 'CANCELLED', 'WAITLIST']);
    const validDatePresets = new Set(['upcoming']);
    const validFulfillmentTypes = new Set(['Pick Up', 'Delivery']);
    const validUpsellOptions = new Set(['with_upsell', 'without_upsell']);
    const sortDirection = sortDirectionParam === 'asc' ? 'ASC' : 'DESC';

    if (status && !validStatuses.has(status)) {
        return jsonError('Invalid status filter', 400);
    }
    if (datePreset && !validDatePresets.has(datePreset)) {
        return jsonError('Invalid date preset filter', 400);
    }
    if (fulfillmentType && !validFulfillmentTypes.has(fulfillmentType)) {
        return jsonError('Invalid fulfillment type filter', 400);
    }
    if (upsell && !validUpsellOptions.has(upsell)) {
        return jsonError('Invalid upsell filter', 400);
    }
    if (sortDirectionParam !== 'asc' && sortDirectionParam !== 'desc') {
        return jsonError('Invalid sort direction', 400);
    }
    if (productIdParam && !productId) {
        return jsonError('Invalid product_id filter', 400);
    }

    if ((startDate && !parseDateParts(startDate)) || (endDate && !parseDateParts(endDate))) {
        return jsonError('Invalid date range', 400);
    }

    const schema = await getBookingQuerySchema(env.DB);

    const selectColumns = [
        'b.booking_token',
        'b.status',
        'b.location_code',
        'b.start_date',
        'b.end_date',
        'b.order_id',
        schema.hasInvalidReason ? 'b.invalid_reason' : 'NULL as invalid_reason',
        'b.created_at',
        'b.updated_at',
        schema.hasCustomerName ? 'b.customer_name' : 'NULL as customer_name',
        schema.hasCustomerEmail ? 'b.customer_email' : 'NULL as customer_email',
        schema.hasRevenue ? 'b.revenue' : 'NULL as revenue',
        schema.hasFulfillmentType ? 'b.fulfillment_type' : 'NULL as fulfillment_type',
        schema.hasDeliveryAddress ? 'b.delivery_address' : 'NULL as delivery_address',
        schema.hasSignedAgreements ? 's.id as signed_agreement_id' : 'NULL as signed_agreement_id',
        'COUNT(DISTINCT bi.product_id) as service_count',
        'GROUP_CONCAT(DISTINCT bi.product_id) as service_product_ids',
        'CASE WHEN COUNT(DISTINCT bi.product_id) > 1 THEN 1 ELSE 0 END as has_upsell',
    ];

    let sql =
        `SELECT ${selectColumns.join(', ')}
         FROM bookings b
         LEFT JOIN booking_items bi ON bi.booking_id = b.id`;

    if (schema.hasSignedAgreements) {
        sql += `
         LEFT JOIN signed_agreements s
             ON s.order_id = b.order_id AND s.shop_domain = ?`;
    }

    sql += `
         WHERE b.shop_id = ?`;

    const bindings: (string | number)[] = schema.hasSignedAgreements ? [auth.shopDomain, shopId] : [shopId];
    if (status) {
        sql += ' AND b.status = ?';
        bindings.push(status);
    }
    if (startDate) {
        sql += ' AND b.start_date >= ?';
        bindings.push(startDate);
    }
    if (endDate) {
        sql += ' AND b.end_date <= ?';
        bindings.push(endDate);
    }
    if (datePreset === 'upcoming') {
        sql += ' AND b.start_date >= ?';
        bindings.push(getTodayInTimeZone(auth.shopTimezone));
    }
    if (locationCode && locationCode.trim().length > 0) {
        sql += ' AND b.location_code = ?';
        bindings.push(locationCode.trim());
    }
    if (fulfillmentType) {
        sql += ' AND b.fulfillment_type = ?';
        bindings.push(fulfillmentType);
    }
    if (productId) {
        sql += ' AND EXISTS (SELECT 1 FROM booking_items bi_filter WHERE bi_filter.booking_id = b.id AND bi_filter.product_id = ?)';
        bindings.push(productId);
    }
    if (upsell === 'with_upsell') {
        sql += ` AND EXISTS (
            SELECT 1
            FROM booking_items bi_upsell
            WHERE bi_upsell.booking_id = b.id
            GROUP BY bi_upsell.booking_id
            HAVING COUNT(DISTINCT bi_upsell.product_id) > 1
        )`;
    }
    if (upsell === 'without_upsell') {
        sql += ` AND NOT EXISTS (
            SELECT 1
            FROM booking_items bi_upsell
            WHERE bi_upsell.booking_id = b.id
            GROUP BY bi_upsell.booking_id
            HAVING COUNT(DISTINCT bi_upsell.product_id) > 1
        )`;
    }
    if (search) {
        const term = `%${search.trim()}%`;
        const searchClauses = ['b.booking_token LIKE ?', 'CAST(b.order_id AS TEXT) LIKE ?'];
        const searchBindings: string[] = [term, term];
        if (schema.hasCustomerName) {
            searchClauses.push('b.customer_name LIKE ?');
            searchBindings.push(term);
        }
        if (schema.hasCustomerEmail) {
            searchClauses.push('b.customer_email LIKE ?');
            searchBindings.push(term);
        }
        sql += ` AND (${searchClauses.join(' OR ')})`;
        bindings.push(...searchBindings);
    }

    const groupByColumns = [
        'b.id',
        'b.booking_token',
        'b.status',
        'b.location_code',
        'b.start_date',
        'b.end_date',
        'b.order_id',
        'b.created_at',
        'b.updated_at',
    ];

    if (schema.hasInvalidReason) {
        groupByColumns.push('b.invalid_reason');
    }
    if (schema.hasCustomerName) {
        groupByColumns.push('b.customer_name');
    }
    if (schema.hasCustomerEmail) {
        groupByColumns.push('b.customer_email');
    }
    if (schema.hasRevenue) {
        groupByColumns.push('b.revenue');
    }
    if (schema.hasFulfillmentType) {
        groupByColumns.push('b.fulfillment_type');
    }
    if (schema.hasDeliveryAddress) {
        groupByColumns.push('b.delivery_address');
    }
    if (schema.hasSignedAgreements) {
        groupByColumns.push('s.id');
    }

    sql += ` GROUP BY ${groupByColumns.join(', ')}`;
    sql += ` ORDER BY b.start_date ${sortDirection}, b.created_at DESC`;

    const rows = await env.DB.prepare(sql).bind(...bindings).all();
    return Response.json({ ok: true, bookings: rows.results ?? [] });
}

async function handleBookingGet(env: Env, shopId: number, bookingToken: string): Promise<Response> {
    const schema = await getBookingQuerySchema(env.DB);

    const shopRow = await env.DB.prepare('SELECT shop_domain FROM shops WHERE id = ?').bind(shopId).first();
    const shopDomain = shopRow && isRecord(shopRow) ? (shopRow.shop_domain as string | null) : null;

    const selectColumns = [
        'b.id',
        'b.booking_token',
        'b.status',
        'b.location_code',
        'b.start_date',
        'b.end_date',
        'b.expires_at',
        'b.order_id',
        schema.hasInvalidReason ? 'b.invalid_reason' : 'NULL as invalid_reason',
        'b.created_at',
        'b.updated_at',
        schema.hasCustomerName ? 'b.customer_name' : 'NULL as customer_name',
        schema.hasCustomerEmail ? 'b.customer_email' : 'NULL as customer_email',
        schema.hasRevenue ? 'b.revenue' : 'NULL as revenue',
        schema.hasFulfillmentType ? 'b.fulfillment_type' : 'NULL as fulfillment_type',
        schema.hasDeliveryAddress ? 'b.delivery_address' : 'NULL as delivery_address',
        schema.hasSignedAgreements ? 's.id as signed_agreement_id' : 'NULL as signed_agreement_id',
    ];

    let sql =
        `SELECT ${selectColumns.join(', ')}
         FROM bookings b`;
    const bindings: (string | number)[] = [];

    if (schema.hasSignedAgreements) {
        sql += `
         LEFT JOIN signed_agreements s
           ON s.order_id = b.order_id AND s.shop_domain = ?`;
        bindings.push(shopDomain ?? '');
    }

    sql += `
         WHERE b.shop_id = ? AND b.booking_token = ?`;
    bindings.push(shopId, bookingToken);

    const booking = await env.DB.prepare(sql).bind(...bindings).first();
    if (!booking) {
        return jsonError('Booking not found', 404);
    }

    const items = await env.DB.prepare(
        'SELECT product_id, variant_id, qty FROM booking_items WHERE booking_id = ? ORDER BY product_id'
    )
        .bind(booking.id)
        .all();
    const days = await env.DB.prepare(
        'SELECT product_id, date, qty FROM booking_days WHERE booking_id = ? ORDER BY date, product_id'
    )
        .bind(booking.id)
        .all();

    return Response.json({
        ok: true,
        booking,
        items: items.results ?? [],
        days: days.results ?? [],
    });
}

async function handleDashboardGet(env: Env, auth: AdminAuthContext): Promise<Response> {
    const shopId = auth.shopId;
    const today = getTodayInTimeZone(auth.shopTimezone);
    const schema = await getBookingQuerySchema(env.DB);

    // activeBookings: CONFIRMED and overlapping today
    const activeBookingsStmt = env.DB.prepare(
        `SELECT COUNT(*) as count FROM bookings 
         WHERE shop_id = ? AND status = 'CONFIRMED' AND start_date <= ? AND end_date >= ?`
    ).bind(shopId, today, today);

    // pendingHolds: HOLD
    const pendingHoldsStmt = env.DB.prepare(
        `SELECT COUNT(*) as count FROM bookings 
         WHERE shop_id = ? AND status = 'HOLD'`
    ).bind(shopId);

    // pickups: start_date = today, CONFIRMED/HOLD
    const pickupsStmt = env.DB.prepare(
        `SELECT booking_token, location_code, order_id, status FROM bookings 
         WHERE shop_id = ? AND start_date = ? AND status IN ('CONFIRMED', 'HOLD')`
    ).bind(shopId, today);

    // dropoffs: end_date = today, CONFIRMED/HOLD
    const dropoffsStmt = env.DB.prepare(
        `SELECT booking_token, location_code, order_id, status FROM bookings 
         WHERE shop_id = ? AND end_date = ? AND status IN ('CONFIRMED', 'HOLD')`
    ).bind(shopId, today);

    // upcoming: start_date > today, CONFIRMED
    const upcomingCustomerName = schema.hasCustomerName ? 'customer_name' : 'NULL as customer_name';
    const upcomingStmt = env.DB.prepare(
        `SELECT booking_token, start_date, end_date, location_code, status, order_id, ${upcomingCustomerName} FROM bookings 
         WHERE shop_id = ? AND start_date > ? AND status = 'CONFIRMED' 
         ORDER BY start_date ASC LIMIT 5`
    ).bind(shopId, today);

    // history: recent
    const historyInvalidReason = schema.hasInvalidReason ? 'invalid_reason' : 'NULL as invalid_reason';
    const historyStmt = env.DB.prepare(
        `SELECT booking_token, start_date, end_date, status, created_at, ${historyInvalidReason} FROM bookings 
         WHERE shop_id = ? 
         ORDER BY created_at DESC LIMIT 10`
    ).bind(shopId);

    const bookingsCountStmt = env.DB.prepare(
        `SELECT COUNT(*) as count FROM bookings WHERE shop_id = ? AND status = 'CONFIRMED'`
    ).bind(shopId);

    const cancelledCountStmt = env.DB.prepare(
        `SELECT COUNT(*) as count FROM bookings WHERE shop_id = ? AND status IN ('CANCELLED', 'EXPIRED', 'INVALID')`
    ).bind(shopId);

    const revenueStmt = schema.hasRevenue
        ? env.DB.prepare(
            `SELECT SUM(revenue) as total FROM bookings WHERE shop_id = ? AND status = 'CONFIRMED'`
        ).bind(shopId)
        : env.DB.prepare('SELECT 0 as total');

    const results = await env.DB.batch([
        activeBookingsStmt,
        pendingHoldsStmt,
        pickupsStmt,
        dropoffsStmt,
        upcomingStmt,
        historyStmt,
        bookingsCountStmt,
        cancelledCountStmt,
        revenueStmt,
        // Product breakdown (count only for now)
        env.DB.prepare(
            `SELECT product_id, COUNT(*) as count 
             FROM booking_items 
             JOIN bookings ON bookings.id = booking_items.booking_id 
             WHERE bookings.shop_id = ? AND bookings.status = 'CONFIRMED' 
             GROUP BY product_id`
        ).bind(shopId)
    ]);

    // Check bounds since we added a query
    const productStats = results.length > 9 ? results[9].results : [];

    return Response.json({
        ok: true,
        todayDate: today,
        stats: {
            active_bookings: (results[0].results?.[0] as any)?.count ?? 0,
            pending_holds: (results[1].results?.[0] as any)?.count ?? 0,
            bookings_count: (results[6].results?.[0] as any)?.count ?? 0,
            cancelled_count: (results[7].results?.[0] as any)?.count ?? 0,
            revenue: (results[8].results?.[0] as any)?.total ?? 0
        },
        productStats: productStats ?? [],
        todayActivity: {
            pickups: results[2].results ?? [],
            dropoffs: results[3].results ?? [],
        },
        upcomingBookings: results[4].results ?? [],
        recentHistory: results[5].results ?? []
    });
}

async function handleBookingComplete(env: Env, auth: AdminAuthContext, bookingToken: string): Promise<Response> {
    const booking = await env.DB.prepare(
        `SELECT id, order_id, status FROM bookings WHERE shop_id = ? AND booking_token = ?`
    ).bind(auth.shopId, bookingToken).first();

    if (!booking) {
        return jsonError('Booking not found', 404);
    }
    const orderId = booking.order_id as number;

    let fulfillmentResult = { success: false, message: 'No Order ID' };

    if (orderId) {
        fulfillmentResult = await fulfillShopifyOrder(env, auth, orderId);
    }

    await env.DB.prepare(
        `UPDATE bookings SET status = 'RELEASED', updated_at = datetime('now') WHERE id = ?`
    ).bind(booking.id).run();

    return Response.json({ ok: true, fulfillment: fulfillmentResult });
}

async function fulfillShopifyOrder(env: Env, auth: AdminAuthContext, orderId: number): Promise<{ success: boolean; message: string }> {
    const accessToken = await getShopAccessToken(env, auth.shopId, auth.shopDomain, auth.sessionToken);
    if (!accessToken) return { success: false, message: 'Unable to obtain access token' };

    const apiVersion = SHOPIFY_ADMIN_API_VERSION;

    const foRes = await fetch(`https://${auth.shopDomain}/admin/api/${apiVersion}/orders/${orderId}/fulfillment_orders.json`, {
        headers: { 'X-Shopify-Access-Token': accessToken }
    });

    if (!foRes.ok) return { success: false, message: 'Failed to fetch fulfillment orders' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const foData = await foRes.json() as any;
    const fulfillmentOrders = foData.fulfillment_orders;

    if (!fulfillmentOrders || fulfillmentOrders.length === 0) {
        return { success: false, message: 'No fulfillment orders found' };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openOrders = fulfillmentOrders.filter((fo: any) => fo.status === 'open');
    if (openOrders.length === 0) return { success: true, message: 'Order already fulfilled' };

    const targetFo = openOrders[0];
    const payload = {
        fulfillment: {
            line_items_by_fulfillment_order: [{
                fulfillment_order_id: targetFo.id
            }]
        }
    };

    const createRes = await fetch(`https://${auth.shopDomain}/admin/api/${apiVersion}/fulfillments.json`, {
        method: 'POST',
        headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!createRes.ok) {
        const txt = await createRes.text();
        console.error('Fulfillment failed', txt);
        return { success: false, message: 'Fulfillment failed' };
    }

    return { success: true, message: 'Fulfilled' };
}

async function handleShopifyProductsGet(env: Env, auth: AdminAuthContext): Promise<Response> {
    const accessToken = await getShopAccessToken(env, auth.shopId, auth.shopDomain, auth.sessionToken);
    if (!accessToken) return jsonError('Unable to obtain Shopify access token. Please reinstall the app.', 502);

    const apiVersion = SHOPIFY_ADMIN_API_VERSION;

    const query = `
    {
      products(first: 50, sortKey: TITLE) {
        edges {
          node {
            id
            title
            status
            images(first: 1) {
              edges {
                node {
                  url
                }
              }
            }
            variants(first: 20) {
              edges {
                node {
                  id
                  title
                }
              }
            }
          }
        }
      }
    }
    `;

    try {
        const response = await fetch(`https://${auth.shopDomain}/admin/api/${apiVersion}/graphql.json`, {
            method: 'POST',
            headers: {
                'X-Shopify-Access-Token': accessToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query }),
        });

        if (!response.ok) {
            const text = await response.text();
            console.error('GraphQL HTTP Error', text);
            return jsonError('Failed to fetch products from Shopify (HTTP)', 502);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body = await response.json() as any;
        if (body.errors) {
            console.error('GraphQL Errors', JSON.stringify(body.errors));
            return jsonError('Failed to fetch products from Shopify (GraphQL)', 502);
        }

        const rawProducts = body.data?.products?.edges || [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const products = rawProducts.map((edge: any) => {
            const node = edge.node;
            const productId = parseInt(node.id.split('/').pop() || '0');

            return {
                id: productId,
                title: node.title,
                status: node.status,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                images: node.images.edges.map((imgEdge: any) => ({
                    src: imgEdge.node.url
                })),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                variants: node.variants.edges.map((varEdge: any) => ({
                    id: parseInt(varEdge.node.id.split('/').pop() || '0'),
                    title: varEdge.node.title
                }))
            };
        });

        return Response.json({ ok: true, products });
    } catch (e) {
        console.error('Shopify fetch exception', e);
        return jsonError('Exception fetching products', 500);
    }
}

interface AgreementResponse {
    id: string;
    version: number;
    active: boolean;
    title: string | null;
    pdf_url: string;
    pdf_storage_type: string;
    pdf_sha256: string | null;
    page_number: number;
    x: number;
    y: number;
    width: number;
    height: number;
    created_at: string;
    created_by: string | null;
}

interface SignedAgreementListItem {
    id: string;
    agreement_id: string;
    agreement_version: number;
    agreement_title: string | null;
    cart_token: string;
    order_id: string | null;
    customer_email: string | null;
    signed_at: string;
    status: string;
}

interface SignedAgreementDetail extends SignedAgreementListItem {
    signature_png_base64: string;
}

interface SignedAgreementDetailResponse {
    ok: boolean;
    signed_agreement: SignedAgreementDetail;
    agreement: AgreementResponse;
}

async function handleAgreementCurrent(env: Env, shopDomain: string): Promise<Response> {
    const row = await env.DB.prepare(
        `SELECT id, shop_domain, version, active, title, pdf_storage_type, pdf_storage_key, pdf_sha256,
                page_number, x, y, width, height, created_at, created_by
         FROM agreements
         WHERE shop_domain = ? AND active = 1
         ORDER BY version DESC
         LIMIT 1`
    )
        .bind(shopDomain)
        .first();

    if (!row || !isRecord(row)) {
        return Response.json({ ok: true, agreement: null });
    }

    const agreement = mapAgreementRow(row);
    if (!agreement) {
        return jsonError('Failed to read agreement', 500);
    }

    return Response.json({ ok: true, agreement });
}

async function handleAgreementUpload(
    request: Request,
    env: Env,
    shopDomain: string,
    payload: SessionTokenPayload
): Promise<Response> {
    const body = await readJsonBody(request);
    if (!body) {
        return jsonError('Invalid JSON body', 400);
    }

    const title = getOptionalString(body, 'title') ?? null;
    const pdfUrl = getString(body, 'pdf_url');
    const pdfSha = getOptionalString(body, 'pdf_sha256') ?? null;
    const pdfType = getOptionalString(body, 'pdf_storage_type') ?? 'EXTERNAL';
    const pageNumberRaw = getOptionalPositiveInt(body, 'page_number');
    const xRaw = getOptionalNumber(body, 'x');
    const yRaw = getOptionalNumber(body, 'y');
    const widthRaw = getOptionalNumber(body, 'width');
    const heightRaw = getOptionalNumber(body, 'height');

    const pageNumber = pageNumberRaw ?? 1;
    const x = xRaw ?? 0.1;
    const y = yRaw ?? 0.8;
    const width = widthRaw ?? 0.3;
    const height = heightRaw ?? 0.1;

    if (!pdfUrl || !isValidPdfUrl(pdfUrl)) {
        return jsonError('Invalid pdf_url', 400);
    }

    if (isInvalidOptionalNumber(body, 'page_number', pageNumberRaw)) {
        return jsonError('Invalid page_number', 400);
    }
    if (isInvalidOptionalNumber(body, 'x', xRaw)) {
        return jsonError('Invalid x', 400);
    }
    if (isInvalidOptionalNumber(body, 'y', yRaw)) {
        return jsonError('Invalid y', 400);
    }
    if (isInvalidOptionalNumber(body, 'width', widthRaw)) {
        return jsonError('Invalid width', 400);
    }
    if (isInvalidOptionalNumber(body, 'height', heightRaw)) {
        return jsonError('Invalid height', 400);
    }
    if (!isAllowedPdfStorageType(pdfType)) {
        return jsonError('Invalid pdf_storage_type', 400);
    }

    if (!isNormalizedRect(x, y, width, height) || !Number.isInteger(pageNumber) || pageNumber < 1) {
        return jsonError('Invalid signature placement', 400);
    }

    const versionRow = await env.DB.prepare(
        'SELECT COALESCE(MAX(version), 0) as max_version FROM agreements WHERE shop_domain = ?'
    )
        .bind(shopDomain)
        .first();
    const maxVersion = isRecord(versionRow) ? toNumber(versionRow.max_version) ?? 0 : 0;
    const nextVersion = maxVersion + 1;

    const agreementId = crypto.randomUUID();
    const createdBy = payload.sub ?? payload.sid ?? null;
    const createdAt = new Date().toISOString();

    try {
        await env.DB.batch([
            env.DB.prepare('UPDATE agreements SET active = 0 WHERE shop_domain = ?').bind(shopDomain),
            env.DB.prepare(
                `INSERT INTO agreements (
                    id, shop_domain, version, active, title, pdf_storage_type, pdf_storage_key, pdf_sha256,
                    page_number, x, y, width, height, created_at, created_by
                )
                VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                agreementId,
                shopDomain,
                nextVersion,
                title,
                pdfType,
                pdfUrl,
                pdfSha,
                pageNumber,
                x,
                y,
                width,
                height,
                createdAt,
                createdBy
            )
        ]);
    } catch (e) {
        console.error('Agreement upload failed', e);
        return jsonError('Failed to save agreement', 500);
    }

    return Response.json({
        ok: true,
        agreement: {
            id: agreementId,
            version: nextVersion,
            active: true,
            title,
            pdf_url: pdfUrl,
            pdf_storage_type: pdfType,
            pdf_sha256: pdfSha,
            page_number: pageNumber,
            x,
            y,
            width,
            height,
            created_at: createdAt,
            created_by: createdBy
        }
    });
}

async function handleAgreementPlacement(request: Request, env: Env, shopDomain: string): Promise<Response> {
    const body = await readJsonBody(request);
    if (!body) {
        return jsonError('Invalid JSON body', 400);
    }

    const agreementId = getOptionalString(body, 'agreement_id');
    const pageNumber = getOptionalPositiveInt(body, 'page_number');
    const x = getOptionalNumber(body, 'x');
    const y = getOptionalNumber(body, 'y');
    const width = getOptionalNumber(body, 'width');
    const height = getOptionalNumber(body, 'height');

    if (
        !pageNumber ||
        x === undefined ||
        y === undefined ||
        width === undefined ||
        height === undefined ||
        !isNormalizedRect(x, y, width, height)
    ) {
        return jsonError('Invalid placement fields', 400);
    }

    const target = agreementId
        ? await env.DB.prepare(
            'SELECT id FROM agreements WHERE shop_domain = ? AND id = ?'
        ).bind(shopDomain, agreementId).first()
        : await env.DB.prepare(
            'SELECT id FROM agreements WHERE shop_domain = ? AND active = 1 ORDER BY version DESC LIMIT 1'
        ).bind(shopDomain).first();

    if (!target || !isRecord(target)) {
        return jsonError('Agreement not found', 404);
    }

    await env.DB.prepare(
        `UPDATE agreements
         SET page_number = ?, x = ?, y = ?, width = ?, height = ?
         WHERE shop_domain = ? AND id = ?`
    )
        .bind(pageNumber, x, y, width, height, shopDomain, target.id)
        .run();

    return Response.json({ ok: true });
}

async function handleAgreementSignedList(request: Request, env: Env, shopDomain: string): Promise<Response> {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const orderId = url.searchParams.get('order_id');
    const email = url.searchParams.get('email');
    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');
    const limit = clampInt(url.searchParams.get('limit'), 25, 1, 100);
    const offset = clampInt(url.searchParams.get('offset'), 0, 0, 10_000);

    let sql =
        `SELECT s.id, s.agreement_id, s.cart_token, s.order_id, s.customer_email, s.signed_at, s.status,
                a.version as agreement_version, a.title as agreement_title
         FROM signed_agreements s
         JOIN agreements a ON s.agreement_id = a.id
         WHERE s.shop_domain = ?`;
    const bindings: (string | number)[] = [shopDomain];

    if (status) {
        sql += ' AND s.status = ?';
        bindings.push(status);
    }
    if (orderId) {
        sql += ' AND s.order_id = ?';
        bindings.push(orderId);
    }
    if (email) {
        sql += ' AND s.customer_email LIKE ?';
        bindings.push(`%${email}%`);
    }
    if (startDate) {
        sql += ' AND date(s.signed_at) >= date(?)';
        bindings.push(startDate);
    }
    if (endDate) {
        sql += ' AND date(s.signed_at) <= date(?)';
        bindings.push(endDate);
    }

    sql += ' ORDER BY s.signed_at DESC LIMIT ? OFFSET ?';
    bindings.push(limit, offset);

    const rows = await env.DB.prepare(sql).bind(...bindings).all();
    const items = (rows.results ?? [])
        .filter(isRecord)
        .map((row) => ({
            id: readStringField(row, 'id') ?? '',
            agreement_id: readStringField(row, 'agreement_id') ?? '',
            agreement_version: toNumber(row.agreement_version) ?? 0,
            agreement_title: readStringField(row, 'agreement_title'),
            cart_token: readStringField(row, 'cart_token') ?? '',
            order_id: readStringField(row, 'order_id'),
            customer_email: readStringField(row, 'customer_email'),
            signed_at: readStringField(row, 'signed_at') ?? '',
            status: readStringField(row, 'status') ?? 'pending'
        }))
        .filter((item) => item.id && item.agreement_id);

    return Response.json({ ok: true, signed_agreements: items });
}

async function handleAgreementSignedDetail(env: Env, shopDomain: string, signedId: string): Promise<Response> {
    const row = await env.DB.prepare(
        `SELECT s.id as signed_id, s.agreement_id as agreement_id, s.cart_token, s.order_id, s.customer_email, s.signed_at, s.status,
                s.signature_png_base64,
                a.id, a.shop_domain, a.version, a.active, a.title,
                a.pdf_storage_type, a.pdf_storage_key, a.pdf_sha256,
                a.page_number, a.x, a.y, a.width, a.height, a.created_at, a.created_by
         FROM signed_agreements s
         JOIN agreements a ON s.agreement_id = a.id
         WHERE s.shop_domain = ? AND s.id = ?`
    )
        .bind(shopDomain, signedId)
        .first();

    if (!row || !isRecord(row)) {
        return jsonError('Signed agreement not found', 404);
    }

    const agreement = mapAgreementRow(row);
    if (!agreement) {
        return jsonError('Failed to read agreement for signed detail', 500);
    }

    const detail: SignedAgreementDetail = {
        id: readStringField(row, 'signed_id') ?? '',
        agreement_id: readStringField(row, 'agreement_id') ?? '',
        agreement_version: agreement.version,
        agreement_title: agreement.title,
        cart_token: readStringField(row, 'cart_token') ?? '',
        order_id: readStringField(row, 'order_id'),
        customer_email: readStringField(row, 'customer_email'),
        signed_at: readStringField(row, 'signed_at') ?? '',
        status: readStringField(row, 'status') ?? 'pending',
        signature_png_base64: readStringField(row, 'signature_png_base64') ?? ''
    };

    // Only error if the signed agreement ID is missing; empty signature is allowed
    // (the UI will show "Signature missing" gracefully)
    if (!detail.id) {
        return jsonError('Signed agreement ID missing', 500);
    }

    const response: SignedAgreementDetailResponse = { ok: true, signed_agreement: detail, agreement };
    return Response.json(response);
}

async function handleAgreementActivate(env: Env, shopDomain: string, agreementId: string): Promise<Response> {
    const exists = await env.DB.prepare(
        'SELECT id FROM agreements WHERE shop_domain = ? AND id = ?'
    ).bind(shopDomain, agreementId).first();

    if (!exists) {
        return jsonError('Agreement not found', 404);
    }

    await env.DB.batch([
        env.DB.prepare('UPDATE agreements SET active = 0 WHERE shop_domain = ?').bind(shopDomain),
        env.DB.prepare('UPDATE agreements SET active = 1 WHERE shop_domain = ? AND id = ?').bind(shopDomain, agreementId)
    ]);

    return Response.json({ ok: true });
}

function mapAgreementRow(row: Record<string, unknown>): AgreementResponse | null {
    const id = readStringField(row, 'id');
    const pdfStorageKey = readStringField(row, 'pdf_storage_key');
    const pdfStorageType = readStringField(row, 'pdf_storage_type');
    if (!id || !pdfStorageKey || !pdfStorageType) {
        return null;
    }

    const version = toNumber(row.version);
    const pageNumber = toNumber(row.page_number);
    const x = toNumber(row.x);
    const y = toNumber(row.y);
    const width = toNumber(row.width);
    const height = toNumber(row.height);

    if (
        version === null ||
        pageNumber === null ||
        x === null ||
        y === null ||
        width === null ||
        height === null
    ) {
        return null;
    }

    return {
        id,
        version,
        active: Boolean(toNumber(row.active)),
        title: readStringField(row, 'title'),
        pdf_url: pdfStorageKey,
        pdf_storage_type: pdfStorageType,
        pdf_sha256: readStringField(row, 'pdf_sha256'),
        page_number: pageNumber,
        x,
        y,
        width,
        height,
        created_at: readStringField(row, 'created_at') ?? '',
        created_by: readStringField(row, 'created_by')
    };
}

function isNormalizedRect(x: number, y: number, width: number, height: number): boolean {
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
        return false;
    }
    if (width <= 0 || height <= 0) {
        return false;
    }
    return x >= 0 && y >= 0 && width <= 1 && height <= 1 && x + width <= 1 && y + height <= 1;
}

function isFiniteNumber(value: number): boolean {
    return typeof value === 'number' && Number.isFinite(value);
}

function isValidPdfUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
}

function isAllowedPdfStorageType(value: string): boolean {
    return value === 'EXTERNAL' || value === 'SHOPIFY_FILES';
}

function isInvalidOptionalNumber(
    record: Record<string, unknown>,
    key: string,
    parsed: number | undefined
): boolean {
    return key in record && parsed === undefined;
}

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function readStringField(row: Record<string, unknown>, key: string): string | null {
    const value = row[key];
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number') {
        return value.toString();
    }
    return null;
}

function toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}

function getOptionalPositiveInt(record: Record<string, unknown>, key: string): number | undefined {
    if (!(key in record)) {
        return undefined;
    }
    const value = record[key];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return value;
    }
    return undefined;
}

function parseManualBookingBody(body: Record<string, unknown>): ManualBookingRequestBody | null {
    const startDate = getString(body, 'start_date');
    const endDate = getString(body, 'end_date');
    const location = getString(body, 'location') ?? getString(body, 'location_code');
    const items = body.items;

    if (!startDate || !endDate || !location || !Array.isArray(items) || items.length === 0) {
        return null;
    }

    const parsedItems: ManualBookingItemInput[] = [];
    for (const entry of items) {
        if (!isRecord(entry)) {
            return null;
        }

        const productId = getNumber(entry, 'product_id');
        const qty = getNumber(entry, 'qty');
        const variantId = getOptionalNumber(entry, 'variant_id');

        if (productId === null || !Number.isInteger(productId) || productId <= 0) {
            return null;
        }
        if (qty === null || !Number.isInteger(qty) || qty <= 0) {
            return null;
        }
        if (variantId !== undefined && (!Number.isInteger(variantId) || variantId <= 0)) {
            return null;
        }

        parsedItems.push({
            product_id: productId,
            variant_id: variantId,
            qty,
        });
    }

    if ('customer_name' in body && typeof body.customer_name !== 'string') {
        return null;
    }
    if ('customer_email' in body && typeof body.customer_email !== 'string') {
        return null;
    }

    const customerName = getOptionalString(body, 'customer_name');
    const customerEmail = getOptionalString(body, 'customer_email');
    const fulfillmentTypeRaw = getOptionalString(body, 'fulfillment_type');
    const deliveryAddress = getOptionalString(body, 'delivery_address');
    const revenue = getOptionalNumber(body, 'revenue');

    if ('revenue' in body && (revenue === undefined || revenue < 0)) {
        return null;
    }

    let fulfillmentType: 'Pick Up' | 'Delivery' | undefined;
    if ('fulfillment_type' in body) {
        if (!fulfillmentTypeRaw || (fulfillmentTypeRaw !== 'Pick Up' && fulfillmentTypeRaw !== 'Delivery')) {
            return null;
        }
        fulfillmentType = fulfillmentTypeRaw;
    }

    if (fulfillmentType === 'Delivery' && !deliveryAddress) {
        return null;
    }
    if (deliveryAddress && fulfillmentType !== 'Delivery') {
        return null;
    }
    if ('delivery_address' in body && typeof body.delivery_address !== 'string') {
        return null;
    }

    const parsed: ManualBookingRequestBody = {
        start_date: startDate,
        end_date: endDate,
        location,
        items: parsedItems,
    };

    if (customerName) {
        parsed.customer_name = customerName;
    }
    if (customerEmail) {
        parsed.customer_email = customerEmail;
    }
    if (fulfillmentType) {
        parsed.fulfillment_type = fulfillmentType;
    }
    if (deliveryAddress) {
        parsed.delivery_address = deliveryAddress;
    }
    if (revenue !== undefined) {
        parsed.revenue = revenue;
    }

    return parsed;
}

function normalizeManualBookingItems(
    items: ManualBookingItemInput[],
    productMap: Map<number, { variant_id: number | null; rentable: number; default_capacity: number }>
): NormalizedManualBookingItem[] | null {
    const itemMap = new Map<number, NormalizedManualBookingItem>();

    for (const item of items) {
        const product = productMap.get(item.product_id);
        if (!product || !product.rentable) {
            return null;
        }

        const defaultCapacity = product.default_capacity;
        if (!Number.isInteger(defaultCapacity) || defaultCapacity < 0) {
            return null;
        }

        const variantId = product.variant_id ?? item.variant_id;
        if (variantId === undefined || variantId === null || !Number.isInteger(variantId) || variantId <= 0) {
            return null;
        }
        if (product.variant_id && item.variant_id && product.variant_id !== item.variant_id) {
            return null;
        }

        const existing = itemMap.get(item.product_id);
        if (existing) {
            if (existing.variant_id !== variantId) {
                return null;
            }
            existing.qty += item.qty;
            continue;
        }

        itemMap.set(item.product_id, {
            product_id: item.product_id,
            variant_id: variantId,
            qty: item.qty,
            default_capacity: defaultCapacity,
        });
    }

    return Array.from(itemMap.values());
}

function rateLimitKey(request: Request, scope: string): string {
    const ip =
        request.headers.get('CF-Connecting-IP') ||
        request.headers.get('X-Forwarded-For') ||
        'unknown';
    return `${scope}:${ip}`;
}

function rateLimitResponse(resetAt: number): Response {
    const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    return new Response('Rate limit exceeded', {
        status: 429,
        headers: {
            'Retry-After': retryAfter.toString(),
        },
    });
}

function getBearerToken(request: Request): string | null {
    const auth = request.headers.get('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
        return auth.slice('Bearer '.length).trim();
    }
    const token =
        request.headers.get('X-Shopify-Session-Token') ||
        request.headers.get('X-Shopify-Access-Token');
    return token ? token.trim() : null;
}

function safeUrlHost(value: string): string | null {
    try {
        return new URL(value).host;
    } catch {
        return null;
    }
}

function parsePositiveInt(value: string): number | null {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
    try {
        const data = await request.json();
        return isRecord(data) ? data : null;
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function getOptionalString(record: Record<string, unknown>, key: string): string | undefined {
    if (!(key in record)) {
        return undefined;
    }
    const value = record[key];
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function getNumber(record: Record<string, unknown>, key: string): number | null {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return value;
}

function getOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
    if (!(key in record)) {
        return undefined;
    }
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return value;
}

function getOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
    if (!(key in record)) {
        return undefined;
    }
    const value = record[key];
    if (typeof value !== 'boolean') {
        return undefined;
    }
    return value;
}

function jsonError(message: string, status: number): Response {
    return Response.json({ ok: false, error: message }, { status });
}

const tableExistsCache = new Map<string, boolean>();
const tableColumnsCache = new Map<string, Set<string>>();
let bookingSchemaCache: BookingQuerySchema | null = null;

async function tableExists(db: D1Database, table: string): Promise<boolean> {
    const cached = tableExistsCache.get(table);
    if (cached !== undefined) {
        return cached;
    }

    const row = await db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .bind(table)
        .first();

    const exists = Boolean(row);
    tableExistsCache.set(table, exists);
    return exists;
}

async function getTableColumns(db: D1Database, table: string): Promise<Set<string>> {
    const cached = tableColumnsCache.get(table);
    if (cached) {
        return cached;
    }

    const rows = await db.prepare(`PRAGMA table_info(${table})`).all();
    const columns = new Set<string>();
    for (const row of rows.results ?? []) {
        if (!isRecord(row)) {
            continue;
        }
        const name = readStringField(row, 'name');
        if (name) {
            columns.add(name);
        }
    }

    tableColumnsCache.set(table, columns);
    return columns;
}

async function getBookingQuerySchema(db: D1Database): Promise<BookingQuerySchema> {
    if (bookingSchemaCache) {
        return bookingSchemaCache;
    }

    const bookingsColumns = await getTableColumns(db, 'bookings');
    const hasSignedAgreements = await tableExists(db, 'signed_agreements');

    bookingSchemaCache = {
        hasInvalidReason: bookingsColumns.has('invalid_reason'),
        hasCustomerName: bookingsColumns.has('customer_name'),
        hasCustomerEmail: bookingsColumns.has('customer_email'),
        hasRevenue: bookingsColumns.has('revenue'),
        hasFulfillmentType: bookingsColumns.has('fulfillment_type'),
        hasDeliveryAddress: bookingsColumns.has('delivery_address'),
        hasSignedAgreements,
    };

    return bookingSchemaCache;
}
