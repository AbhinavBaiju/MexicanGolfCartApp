import { Env } from './types';
import { SessionTokenPayload, verifySessionToken } from './auth';
import { checkRateLimit } from './rateLimit';
import { listDateStrings, parseDateParts, getTodayInTimeZone } from './date';
import { STORE_TIMEZONE } from './config';

interface AdminAuthContext {
    shopId: number;
    shopDomain: string;
    payload: SessionTokenPayload;
}

interface InventoryOverrideInput {
    date: string;
    capacity: number;
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
            return handleBookingsGet(request, env, auth.shopId);
        }
    }

    if (segments.length === 1 && segments[0] === 'dashboard') {
        if (method === 'GET') {
            return handleDashboardGet(env, auth.shopId);
        }
    }

    if (segments.length === 2 && segments[0] === 'bookings') {
        if (method === 'GET') {
            return handleBookingGet(env, auth.shopId, segments[1]);
        }
    }

    if (segments.length === 3 && segments[0] === 'bookings' && segments[2] === 'complete') {
        if (method === 'POST') {
            return handleBookingComplete(env, auth.shopId, segments[1]);
        }
    }

    if (segments.length === 1 && segments[0] === 'shopify-products') {
        if (method === 'GET') {
            return handleShopifyProductsGet(env, auth.shopId);
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

    const shopRow = await env.DB.prepare('SELECT id FROM shops WHERE shop_domain = ? AND uninstalled_at IS NULL')
        .bind(shopDomain)
        .first();
    if (!shopRow) {
        return jsonError('Shop not found', 401);
    }

    return {
        shopId: shopRow.id as number,
        shopDomain,
        payload,
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

async function handleBookingsGet(request: Request, env: Env, shopId: number): Promise<Response> {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');

    if ((startDate && !parseDateParts(startDate)) || (endDate && !parseDateParts(endDate))) {
        return jsonError('Invalid date range', 400);
    }

    let sql =
        'SELECT booking_token, status, location_code, start_date, end_date, order_id, invalid_reason, created_at, updated_at FROM bookings WHERE shop_id = ?';
    const bindings: (string | number)[] = [shopId];
    if (status) {
        sql += ' AND status = ?';
        bindings.push(status);
    }
    if (startDate) {
        sql += ' AND start_date >= ?';
        bindings.push(startDate);
    }
    if (endDate) {
        sql += ' AND end_date <= ?';
        bindings.push(endDate);
    }
    sql += ' ORDER BY start_date DESC';

    const rows = await env.DB.prepare(sql).bind(...bindings).all();
    return Response.json({ ok: true, bookings: rows.results ?? [] });
}

async function handleBookingGet(env: Env, shopId: number, bookingToken: string): Promise<Response> {
    const booking = await env.DB.prepare(
        `SELECT id, booking_token, status, location_code, start_date, end_date, expires_at, order_id, invalid_reason, created_at, updated_at
         FROM bookings WHERE shop_id = ? AND booking_token = ?`
    )
        .bind(shopId, bookingToken)
        .first();
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

async function handleDashboardGet(env: Env, shopId: number): Promise<Response> {
    const today = getTodayInTimeZone(STORE_TIMEZONE);

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
    const upcomingStmt = env.DB.prepare(
        `SELECT booking_token, start_date, end_date, location_code, status, order_id FROM bookings 
         WHERE shop_id = ? AND start_date > ? AND status = 'CONFIRMED' 
         ORDER BY start_date ASC LIMIT 5`
    ).bind(shopId, today);

    // history: recent
    const historyStmt = env.DB.prepare(
        `SELECT booking_token, start_date, end_date, status, created_at, invalid_reason FROM bookings 
         WHERE shop_id = ? 
         ORDER BY created_at DESC LIMIT 10`
    ).bind(shopId);

    const bookingsCountStmt = env.DB.prepare(
        `SELECT COUNT(*) as count FROM bookings WHERE shop_id = ? AND status = 'CONFIRMED'`
    ).bind(shopId);

    const cancelledCountStmt = env.DB.prepare(
        `SELECT COUNT(*) as count FROM bookings WHERE shop_id = ? AND status IN ('CANCELLED', 'EXPIRED', 'INVALID')`
    ).bind(shopId);

    const [active, pending, pickups, dropoffs, upcoming, history, bCount, cCount] = await env.DB.batch([
        activeBookingsStmt,
        pendingHoldsStmt,
        pickupsStmt,
        dropoffsStmt,
        upcomingStmt,
        historyStmt,
        bookingsCountStmt,
        cancelledCountStmt
    ]);

    return Response.json({
        ok: true,
        todayDate: today,
        stats: {
            active_bookings: (active.results?.[0] as any)?.count ?? 0,
            pending_holds: (pending.results?.[0] as any)?.count ?? 0,
            bookings_count: (bCount.results?.[0] as any)?.count ?? 0,
            cancelled_count: (cCount.results?.[0] as any)?.count ?? 0,
            revenue: 0
        },
        todayActivity: {
            pickups: pickups.results ?? [],
            dropoffs: dropoffs.results ?? [],
        },
        upcomingBookings: upcoming.results ?? [],
        recentHistory: history.results ?? []
    });
}

async function handleBookingComplete(env: Env, shopId: number, bookingToken: string): Promise<Response> {
    const booking = await env.DB.prepare(
        `SELECT id, order_id, status FROM bookings WHERE shop_id = ? AND booking_token = ?`
    ).bind(shopId, bookingToken).first();

    if (!booking) {
        return jsonError('Booking not found', 404);
    }
    const orderId = booking.order_id as number;

    let fulfillmentResult = { success: false, message: 'No Order ID' };

    if (orderId) {
        fulfillmentResult = await fulfillShopifyOrder(env, shopId, orderId);
    }

    await env.DB.prepare(
        `UPDATE bookings SET status = 'RELEASED', updated_at = datetime('now') WHERE id = ?`
    ).bind(booking.id).run();

    return Response.json({ ok: true, fulfillment: fulfillmentResult });
}

async function fulfillShopifyOrder(env: Env, shopId: number, orderId: number): Promise<{ success: boolean; message: string }> {
     const shopRow = await env.DB.prepare('SELECT shop_domain, access_token FROM shops WHERE id = ?')
        .bind(shopId).first();
    if (!shopRow) return { success: false, message: 'Shop not found' };

    const { shop_domain, access_token } = shopRow as { shop_domain: string; access_token: string };

    const foRes = await fetch(`https://${shop_domain}/admin/api/2024-04/orders/${orderId}/fulfillment_orders.json`, {
        headers: { 'X-Shopify-Access-Token': access_token }
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

    const createRes = await fetch(`https://${shop_domain}/admin/api/2024-04/fulfillments.json`, {
        method: 'POST',
        headers: {
            'X-Shopify-Access-Token': access_token,
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

async function handleShopifyProductsGet(env: Env, shopId: number): Promise<Response> {
    const shopRow = await env.DB.prepare('SELECT shop_domain, access_token FROM shops WHERE id = ?')
        .bind(shopId).first();
    if (!shopRow) return jsonError('Shop not found', 404);

    const { shop_domain, access_token } = shopRow as { shop_domain: string; access_token: string };

    const response = await fetch(`https://${shop_domain}/admin/api/2024-04/products.json?fields=id,title,images,variants,status`, {
        headers: { 'X-Shopify-Access-Token': access_token }
    });

    if (!response.ok) {
        return jsonError('Failed to fetch products from Shopify', 502);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await response.json() as any;
    return Response.json({ ok: true, products: data.products });
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
