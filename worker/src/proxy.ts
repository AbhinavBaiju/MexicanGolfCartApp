import { Env } from './types';
import { verifyProxySignature } from './security';
import { checkRateLimit } from './rateLimit';
import { releaseBooking } from './bookingService';
import {
    datePartsToIndex,
    getTodayInTimeZone,
    listDateStrings,
    parseDateParts,
} from './date';

interface AvailabilityResponse {
    ok: boolean;
    available?: boolean;
    min_available_qty?: number;
    details?: string;
    error?: string;
}

interface HoldRequestItemInput {
    product_id: number;
    variant_id?: number;
    qty: number;
}

interface HoldRequestBody {
    start_date: string;
    end_date: string;
    location: string;
    items: HoldRequestItemInput[];
}

interface ReleaseRequestBody {
    booking_token: string;
}

interface NormalizedHoldItem {
    product_id: number;
    variant_id: number;
    qty: number;
    default_capacity: number;
}

const HOLD_MINUTES = 20;

export async function handleProxyRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');

    const rate = checkRateLimit(rateLimitKey(request, 'proxy'), 240, 60_000);
    if (!rate.allowed) {
        return rateLimitResponse(rate.resetAt);
    }

    // 1. Verify Signature
    const valid = await verifyProxySignature(request, env.SHOPIFY_API_SECRET);
    if (!valid) {
        return new Response('Invalid signature', { status: 401 });
    }

    if (!shop) {
        return new Response('Missing shop parameter', { status: 400 });
    }

    if (url.pathname.endsWith('/availability')) {
        return handleAvailability(request, env, shop);
    }

    if (url.pathname.endsWith('/hold')) {
        if (request.method.toUpperCase() !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 });
        }
        return handleHold(request, env, shop);
    }

    if (url.pathname.endsWith('/release')) {
        if (request.method.toUpperCase() !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 });
        }
        return handleRelease(request, env, shop);
    }

    if (url.pathname.endsWith('/config')) {
        if (request.method.toUpperCase() !== 'GET') {
            return new Response('Method Not Allowed', { status: 405 });
        }
        return handleConfig(env, shop);
    }

    return new Response('Not Found', { status: 404 });
}

async function handleAvailability(request: Request, env: Env, shopDomain: string): Promise<Response> {
    const url = new URL(request.url);
    const startDateStr = url.searchParams.get('start_date');
    const endDateStr = url.searchParams.get('end_date');
    const locationCode = url.searchParams.get('location');
    const quantityStr = url.searchParams.get('quantity');
    const productIdStr = url.searchParams.get('product_id');

    // Validation
    if (!startDateStr || !endDateStr || !locationCode || !quantityStr || !productIdStr) {
        return Response.json({ ok: false, error: 'Missing required parameters' }, { status: 400 });
    }

    const quantity = Number(quantityStr);
    const productId = Number(productIdStr);

    if (!Number.isInteger(quantity) || quantity < 1) {
        return Response.json({ ok: false, error: 'Invalid quantity' }, { status: 400 });
    }

    if (!Number.isInteger(productId) || productId <= 0) {
        return Response.json({ ok: false, error: 'Invalid product id' }, { status: 400 });
    }

    const startParts = parseDateParts(startDateStr);
    const endParts = parseDateParts(endDateStr);
    if (!startParts || !endParts) {
        return Response.json({ ok: false, error: 'Invalid dates' }, { status: 400 });
    }

    const startIndex = datePartsToIndex(startParts);
    const endIndex = datePartsToIndex(endParts);
    if (startIndex > endIndex) {
        return Response.json({ ok: false, error: 'Start date must be before end date' }, { status: 400 });
    }

    try {
        const shopStmt = await env.DB.prepare('SELECT id, timezone FROM shops WHERE shop_domain = ?')
            .bind(shopDomain)
            .first();
        if (!shopStmt) {
            return Response.json({ ok: false, error: 'Shop not found' }, { status: 404 });
        }
        const shopId = shopStmt.id as number;
        const shopTimezone = (shopStmt.timezone as string) || 'UTC';

        const locStmt = await env.DB.prepare(
            'SELECT id, lead_time_days, min_duration_days FROM locations WHERE shop_id = ? AND code = ? AND active = 1'
        )
            .bind(shopId, locationCode)
            .first();
        if (!locStmt) {
            return Response.json({ ok: false, error: 'Invalid location' }, { status: 400 });
        }

        const todayStr = getTodayInTimeZone(shopTimezone);
        const todayParts = parseDateParts(todayStr);
        if (!todayParts) {
            return Response.json({ ok: false, error: 'Failed to read store date' }, { status: 500 });
        }
        const todayIndex = datePartsToIndex(todayParts);
        const leadTimeDays = locStmt.lead_time_days as number;
        const minDurationDays = locStmt.min_duration_days as number;
        const durationDays = endIndex - startIndex + 1;

        if (startIndex < todayIndex + leadTimeDays) {
            return Response.json({ ok: false, error: 'Start date violates lead time' }, { status: 400 });
        }
        if (durationDays < minDurationDays) {
            return Response.json({ ok: false, error: 'Below minimum duration' }, { status: 400 });
        }

        const productStmt = await env.DB.prepare(
            'SELECT default_capacity, rentable FROM products WHERE shop_id = ? AND product_id = ?'
        )
            .bind(shopId, productId)
            .first();

        if (!productStmt) {
            return Response.json({ ok: false, error: 'Product not configured for borrowing' }, { status: 404 });
        }

        if (!productStmt.rentable) {
            return Response.json({ ok: false, error: 'Product is not rentable' }, { status: 400 });
        }

        const defaultCapacity = productStmt.default_capacity as number;
        const dateList = listDateStrings(startDateStr, endDateStr);
        if (!dateList) {
            return Response.json({ ok: false, error: 'Invalid date range' }, { status: 400 });
        }

        const inventoryRows = await env.DB.prepare(
            'SELECT date, capacity, reserved_qty FROM inventory_day WHERE shop_id = ? AND product_id = ? AND date >= ? AND date <= ?'
        )
            .bind(shopId, productId, startDateStr, endDateStr)
            .all();

        const inventoryMap = new Map<string, { capacity: number; reserved: number }>();
        if (inventoryRows.results) {
            for (const row of inventoryRows.results) {
                inventoryMap.set(row.date as string, {
                    capacity: row.capacity as number,
                    reserved: row.reserved_qty as number,
                });
            }
        }

        let minAvailable = Infinity;
        for (const dateStr of dateList) {
            let cap = defaultCapacity;
            let res = 0;

            if (inventoryMap.has(dateStr)) {
                const data = inventoryMap.get(dateStr)!;
                cap = data.capacity;
                res = data.reserved;
            }

            const avail = cap - res;
            if (avail < minAvailable) {
                minAvailable = avail;
            }
        }

        const isAvailable = minAvailable >= quantity;

        return Response.json({
            ok: true,
            available: isAvailable,
            min_available_qty: minAvailable,
        } satisfies AvailabilityResponse);
    } catch (e) {
        console.error('Availability check failed', e);
        return Response.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
    }
}

async function handleHold(request: Request, env: Env, shopDomain: string): Promise<Response> {
    const body = await readJsonBody(request);
    if (!body) {
        return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = parseHoldBody(body);
    if (!parsed) {
        return Response.json({ ok: false, error: 'Invalid hold request' }, { status: 400 });
    }

    try {
        const shopStmt = await env.DB.prepare('SELECT id, timezone FROM shops WHERE shop_domain = ?')
            .bind(shopDomain)
            .first();
        if (!shopStmt) {
            return Response.json({ ok: false, error: 'Shop not found' }, { status: 404 });
        }
        const shopId = shopStmt.id as number;
        const shopTimezone = (shopStmt.timezone as string) || 'UTC';

        const location = await env.DB.prepare(
            'SELECT code, lead_time_days, min_duration_days FROM locations WHERE shop_id = ? AND code = ? AND active = 1'
        )
            .bind(shopId, parsed.location)
            .first();
        if (!location) {
            return Response.json({ ok: false, error: 'Invalid location' }, { status: 400 });
        }

        const startParts = parseDateParts(parsed.start_date);
        const endParts = parseDateParts(parsed.end_date);
        if (!startParts || !endParts) {
            return Response.json({ ok: false, error: 'Invalid dates' }, { status: 400 });
        }
        const startIndex = datePartsToIndex(startParts);
        const endIndex = datePartsToIndex(endParts);
        if (startIndex > endIndex) {
            return Response.json({ ok: false, error: 'Start date must be before end date' }, { status: 400 });
        }

        const todayStr = getTodayInTimeZone(shopTimezone);
        const todayParts = parseDateParts(todayStr);
        if (!todayParts) {
            return Response.json({ ok: false, error: 'Failed to read store date' }, { status: 500 });
        }
        const todayIndex = datePartsToIndex(todayParts);
        const leadTimeDays = location.lead_time_days as number;
        const minDurationDays = location.min_duration_days as number;
        const durationDays = endIndex - startIndex + 1;

        if (startIndex < todayIndex + leadTimeDays) {
            return Response.json({ ok: false, error: 'Start date violates lead time' }, { status: 400 });
        }
        if (durationDays < minDurationDays) {
            return Response.json({ ok: false, error: 'Below minimum duration' }, { status: 400 });
        }

        const uniqueProductIds = Array.from(new Set(parsed.items.map((item) => item.product_id)));
        const placeholders = uniqueProductIds.map(() => '?').join(', ');
        const productRows = await env.DB.prepare(
            `SELECT product_id, variant_id, rentable, default_capacity FROM products WHERE shop_id = ? AND product_id IN (${placeholders})`
        )
            .bind(shopId, ...uniqueProductIds)
            .all();

        const productMap = new Map<number, { variant_id: number | null; rentable: number; default_capacity: number }>();
        for (const row of productRows.results ?? []) {
            productMap.set(row.product_id as number, {
                variant_id: row.variant_id as number | null,
                rentable: row.rentable as number,
                default_capacity: row.default_capacity as number,
            });
        }

        const normalizedItems = normalizeHoldItems(parsed.items, productMap);
        if (!normalizedItems) {
            return Response.json({ ok: false, error: 'Invalid product configuration' }, { status: 400 });
        }

        const dateList = listDateStrings(parsed.start_date, parsed.end_date);
        if (!dateList) {
            return Response.json({ ok: false, error: 'Invalid date range' }, { status: 400 });
        }

        const bookingId = crypto.randomUUID();
        const bookingToken = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString();

        const statements: D1PreparedStatement[] = [];
        statements.push(
            env.DB.prepare(
                `INSERT INTO bookings (id, shop_id, booking_token, status, location_code, start_date, end_date, expires_at, created_at, updated_at)
                 VALUES (?, ?, ?, 'HOLD', ?, ?, ?, ?, datetime('now'), datetime('now'))`
            ).bind(bookingId, shopId, bookingToken, parsed.location, parsed.start_date, parsed.end_date, expiresAt)
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

        await env.DB.batch(statements);

        return Response.json({
            ok: true,
            booking_token: bookingToken,
            expires_at: expiresAt,
        });
    } catch (e) {
        console.error('Hold failed', e);
        if (String(e).includes('division')) {
            return Response.json({ ok: false, error: 'Insufficient capacity' }, { status: 409 });
        }
        return Response.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
    }
}

async function handleRelease(request: Request, env: Env, shopDomain: string): Promise<Response> {
    const body = await readJsonBody(request);
    if (!body) {
        return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const token = getString(body, 'booking_token');
    if (!token) {
        return Response.json({ ok: false, error: 'Missing booking token' }, { status: 400 });
    }

    try {
        const shopStmt = await env.DB.prepare('SELECT id FROM shops WHERE shop_domain = ?')
            .bind(shopDomain)
            .first();
        if (!shopStmt) {
            return Response.json({ ok: false, error: 'Shop not found' }, { status: 404 });
        }
        const shopId = shopStmt.id as number;

        const booking = await env.DB.prepare(
            'SELECT id, status FROM bookings WHERE shop_id = ? AND booking_token = ?'
        )
            .bind(shopId, token)
            .first();
        if (!booking) {
            return Response.json({ ok: false, error: 'Booking not found' }, { status: 404 });
        }

        if (booking.status !== 'HOLD') {
            return Response.json({ ok: true, status: booking.status });
        }

        await releaseBooking(env.DB, booking.id as string, 'RELEASED');

        return Response.json({ ok: true, status: 'RELEASED' });
    } catch (e) {
        console.error('Release failed', e);
        return Response.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
    }
}

async function handleConfig(env: Env, shopDomain: string): Promise<Response> {
    try {
        const shopStmt = await env.DB.prepare('SELECT id FROM shops WHERE shop_domain = ?')
            .bind(shopDomain)
            .first();
        if (!shopStmt) {
            return Response.json({ ok: false, error: 'Shop not found' }, { status: 404 });
        }
        const shopId = shopStmt.id as number;

        const locations = await env.DB.prepare(
            'SELECT code, name, lead_time_days, min_duration_days FROM locations WHERE shop_id = ? AND active = 1 ORDER BY name'
        )
            .bind(shopId)
            .all();

        const products = await env.DB.prepare(
            'SELECT product_id, variant_id, default_capacity, deposit_variant_id, deposit_multiplier FROM products WHERE shop_id = ? AND rentable = 1 ORDER BY product_id'
        )
            .bind(shopId)
            .all();

        return Response.json({
            ok: true,
            locations: locations.results ?? [],
            products: products.results ?? [],
        });
    } catch (e) {
        console.error('Config fetch failed', e);
        return Response.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
    }
}

function normalizeHoldItems(
    items: HoldRequestItemInput[],
    productMap: Map<number, { variant_id: number | null; rentable: number; default_capacity: number }>
): NormalizedHoldItem[] | null {
    const map = new Map<number, NormalizedHoldItem>();

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
        if (!Number.isInteger(variantId) || variantId <= 0) {
            return null;
        }
        if (product.variant_id && item.variant_id && product.variant_id !== item.variant_id) {
            return null;
        }

        const existing = map.get(item.product_id);
        if (existing) {
            if (existing.variant_id !== variantId) {
                return null;
            }
            existing.qty += item.qty;
            map.set(item.product_id, existing);
            continue;
        }

        map.set(item.product_id, {
            product_id: item.product_id,
            variant_id: variantId,
            qty: item.qty,
            default_capacity: defaultCapacity,
        });
    }

    return Array.from(map.values());
}

function parseHoldBody(body: Record<string, unknown>): HoldRequestBody | null {
    const startDate = getString(body, 'start_date');
    const endDate = getString(body, 'end_date');
    const location = getString(body, 'location');
    const items = body.items;

    if (!startDate || !endDate || !location || !Array.isArray(items) || items.length === 0) {
        return null;
    }

    const parsedItems: HoldRequestItemInput[] = [];
    for (const entry of items) {
        if (!isRecord(entry)) {
            return null;
        }
        const productId = getNumber(entry, 'product_id');
        const qty = getNumber(entry, 'qty');
        const variantId = getOptionalNumber(entry, 'variant_id');

        if (!Number.isInteger(productId) || productId <= 0) {
            return null;
        }
        if (!Number.isInteger(qty) || qty <= 0) {
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

    return {
        start_date: startDate,
        end_date: endDate,
        location,
        items: parsedItems,
    };
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
