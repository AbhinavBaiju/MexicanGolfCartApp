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
import { isDevEnvironment, normalizeStoreTimezone, SHOPIFY_ADMIN_API_VERSION } from './config';

interface AvailabilityResponse {
    ok: boolean;
    available?: boolean;
    min_available_qty?: number;
    details?: string;
    error?: string;
}

interface LocationRules {
    leadTimeDays: number;
    minDurationDays: number;
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

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    const rate = checkRateLimit(rateLimitKey(request, 'proxy'), 240, 60_000);
    if (!rate.allowed) {
        return new Response('Rate limit exceeded', {
            status: 429,
            headers: {
                ...corsHeaders,
                ...rateLimitResponse(rate.resetAt).headers
            }
        });
    }

    if (!isDevEnvironment(env.ENVIRONMENT)) {
        const valid = await verifyProxySignature(request, env.SHOPIFY_API_SECRET);
        if (!valid) {
            return new Response('Invalid signature', { status: 401, headers: corsHeaders });
        }
    }

    if (!shop) {
        return new Response('Missing shop parameter', { status: 400, headers: corsHeaders });
    }

    let response: Response;
    if (url.pathname.endsWith('/availability')) {
        response = await handleAvailability(request, env, shop);
    } else if (url.pathname.endsWith('/hold')) {
        if (request.method.toUpperCase() !== 'POST') {
            response = new Response('Method Not Allowed', { status: 405 });
        } else {
            response = await handleHold(request, env, shop);
        }
    } else if (url.pathname.endsWith('/release')) {
        if (request.method.toUpperCase() !== 'POST') {
            response = new Response('Method Not Allowed', { status: 405 });
        } else {
            response = await handleRelease(request, env, shop);
        }
    } else if (url.pathname.endsWith('/config')) {
        if (request.method.toUpperCase() !== 'GET') {
            response = new Response('Method Not Allowed', { status: 405 });
        } else {
            response = await handleConfig(env, shop);
        }
    } else if (url.pathname.endsWith('/agreement/current')) {
        if (request.method.toUpperCase() !== 'GET') {
            response = new Response('Method Not Allowed', { status: 405 });
        } else {
            response = await handleAgreementCurrent(env, shop);
        }
    } else if (url.pathname.endsWith('/agreement/sign')) {
        if (request.method.toUpperCase() !== 'POST') {
            response = new Response('Method Not Allowed', { status: 405 });
        } else {
            response = await handleAgreementSign(request, env, shop);
        }
    } else {
        response = new Response('Not Found', { status: 404 });
    }

    // Append CORS headers to whatever response we got
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
    });
}

async function handleAvailability(request: Request, env: Env, shopDomain: string): Promise<Response> {
    const url = new URL(request.url);
    const startDateStr = url.searchParams.get('start_date');
    const endDateStr = url.searchParams.get('end_date');
    const locationCode = url.searchParams.get('location');
    const quantityStr = url.searchParams.get('quantity');
    const productIdStr = url.searchParams.get('product_id');

    // Validation
    if (!startDateStr || !endDateStr || !quantityStr || !productIdStr) {
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
        const shopTimezone = normalizeStoreTimezone(shopStmt.timezone);

        if (locationCode) {
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
        const shopTimezone = normalizeStoreTimezone(shopStmt.timezone);

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
        const shopStmt = await env.DB.prepare('SELECT id, shop_domain, access_token FROM shops WHERE shop_domain = ?')
            .bind(shopDomain)
            .first();
        if (!shopStmt) {
            return Response.json({ ok: false, error: 'Shop not found' }, { status: 404 });
        }
        const shopId = shopStmt.id as number;
        const accessToken = shopStmt.access_token as string;

        const locations = await env.DB.prepare(
            'SELECT code, name, lead_time_days, min_duration_days FROM locations WHERE shop_id = ? AND active = 1 ORDER BY name'
        )
            .bind(shopId)
            .all();

        const productsRows = await env.DB.prepare(
            'SELECT product_id, variant_id, default_capacity, deposit_variant_id, deposit_multiplier FROM products WHERE shop_id = ? AND rentable = 1 ORDER BY product_id'
        )
            .bind(shopId)
            .all();

        const products = productsRows.results ?? [];

        // Fetch product details from Shopify if we have products
        if (products.length > 0) {
            const productIds = products.map((p: any) => `gid://shopify/Product/${p.product_id}`);
            const query = `
            query ($ids: [ID!]!) {
              nodes(ids: $ids) {
                ... on Product {
                  id
                  title
                  featuredImage {
                    url
                    altText
                  }
                  images(first: 1) {
                    nodes {
                      url
                      altText
                    }
                  }
                }
              }
            }
            `;

            try {
                const shopifyRes = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`, {
                    method: 'POST',
                    headers: {
                        'X-Shopify-Access-Token': accessToken,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query,
                        variables: { ids: productIds }
                    }),
                });

                if (shopifyRes.ok) {
                    const shopifyData = await shopifyRes.json() as unknown;
                    const nodes = isRecord(shopifyData) && isRecord(shopifyData.data) && Array.isArray(shopifyData.data.nodes)
                        ? shopifyData.data.nodes
                        : [];

                    const titleMap = new Map<number, string>();
                    const imageMap = new Map<number, { url: string; altText: string | null }>();

                    nodes.forEach((node) => {
                        if (!isRecord(node)) return;
                        const idValue = node.id;
                        const titleValue = node.title;
                        if (typeof idValue !== 'string') return;

                        const id = parseInt(idValue.split('/').pop() || '0');
                        if (!Number.isFinite(id) || id <= 0) return;

                        if (typeof titleValue === 'string' && titleValue.trim().length > 0) {
                            titleMap.set(id, titleValue);
                        }

                        const images = node.images;
                        const featuredImage = node.featuredImage;
                        if (isRecord(featuredImage) && typeof featuredImage.url === 'string' && featuredImage.url.trim().length > 0) {
                            imageMap.set(id, {
                                url: featuredImage.url,
                                altText: typeof featuredImage.altText === 'string' ? featuredImage.altText : null,
                            });
                            return;
                        }

                        if (isRecord(images) && Array.isArray(images.nodes) && images.nodes.length > 0) {
                            const first = images.nodes[0];
                            if (isRecord(first) && typeof first.url === 'string' && first.url.trim().length > 0) {
                                imageMap.set(id, {
                                    url: first.url,
                                    altText: typeof first.altText === 'string' ? first.altText : null,
                                });
                            }
                        }
                    });

                    // Merge titles/images into products
                    products.forEach((p: any) => {
                        p.title = titleMap.get(p.product_id) || p.title || `Product ${p.product_id}`;
                        const img = imageMap.get(p.product_id);
                        if (img) {
                            p.image_url = img.url;
                            p.image_alt = img.altText;
                        }
                    });
                } else {
                    console.error('Failed to fetch Shopify products', await shopifyRes.text());
                }
            } catch (err) {
                console.error('Error fetching Shopify products', err);
            }
        }

        return Response.json({
            ok: true,
            locations: locations.results ?? [],
            products: products,
        });
    } catch (e) {
        console.error('Config fetch failed', e);
        return Response.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
    }
}

interface AgreementPublicResponse {
    id: string;
    version: number;
    title: string | null;
    pdf_url: string;
    pdf_storage_type: string;
    pdf_sha256: string | null;
    page_number: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

async function handleAgreementCurrent(env: Env, shopDomain: string): Promise<Response> {
    try {
        const shopStmt = await env.DB.prepare('SELECT id FROM shops WHERE shop_domain = ?')
            .bind(shopDomain)
            .first();
        if (!shopStmt) {
            return Response.json({ ok: false, error: 'Shop not found' }, { status: 404 });
        }
        const shopId = shopStmt.id as number;

        const agreementRow = await env.DB.prepare(
            `SELECT id, version, title, pdf_storage_type, pdf_storage_key, pdf_sha256,
                    page_number, x, y, width, height
             FROM agreements
             WHERE shop_domain = ? AND active = 1
             ORDER BY version DESC
             LIMIT 1`
        )
            .bind(shopDomain)
            .first();

        const productsRows = await env.DB.prepare(
            'SELECT product_id FROM products WHERE shop_id = ? AND rentable = 1 ORDER BY product_id'
        )
            .bind(shopId)
            .all();
        const rentableProductIds = (productsRows.results ?? [])
            .filter(isRecord)
            .map((row) => toNumber(row.product_id))
            .filter((value): value is number => typeof value === 'number');

        if (!agreementRow || !isRecord(agreementRow)) {
            return Response.json({ ok: true, agreement: null, rentable_product_ids: rentableProductIds });
        }

        const agreement = mapAgreementPublicRow(agreementRow);
        if (!agreement) {
            return Response.json({ ok: false, error: 'Agreement data invalid' }, { status: 500 });
        }

        return Response.json({ ok: true, agreement, rentable_product_ids: rentableProductIds });
    } catch (e) {
        console.error('Agreement current failed', e);
        return Response.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
    }
}

async function handleAgreementSign(request: Request, env: Env, shopDomain: string): Promise<Response> {
    const body = await readJsonBody(request);
    if (!body) {
        return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const cartToken = getString(body, 'cart_token');
    const agreementId = getString(body, 'agreement_id');
    const signatureDataUrl = getString(body, 'signature_data_url');

    if (!cartToken || !agreementId || !signatureDataUrl) {
        return Response.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
    }

    if (!isPngDataUrl(signatureDataUrl)) {
        return Response.json({ ok: false, error: 'Signature must be a PNG data URL' }, { status: 400 });
    }

    try {
        const agreementRow = await env.DB.prepare(
            'SELECT id FROM agreements WHERE shop_domain = ? AND id = ? AND active = 1'
        )
            .bind(shopDomain, agreementId)
            .first();

        if (!agreementRow) {
            return Response.json({ ok: false, error: 'Agreement not found' }, { status: 404 });
        }

        const signedId = crypto.randomUUID();
        const signedAt = new Date().toISOString();

        await env.DB.prepare(
            `INSERT INTO signed_agreements (
                id, shop_domain, agreement_id, cart_token, signature_png_base64, signed_at, status
            )
            VALUES (?, ?, ?, ?, ?, ?, 'pending')`
        )
            .bind(signedId, shopDomain, agreementId, cartToken, signatureDataUrl, signedAt)
            .run();

        return Response.json({ ok: true, signed_agreement_id: signedId });
    } catch (e) {
        console.error('Agreement sign failed', e);
        return Response.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
    }
}

function mapAgreementPublicRow(row: Record<string, unknown>): AgreementPublicResponse | null {
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
        title: readStringField(row, 'title'),
        pdf_url: pdfStorageKey,
        pdf_storage_type: pdfStorageType,
        pdf_sha256: readStringField(row, 'pdf_sha256'),
        page_number: pageNumber,
        x,
        y,
        width,
        height
    };
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
        if (variantId === undefined || variantId === null || !Number.isInteger(variantId) || variantId <= 0) {
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

function isPngDataUrl(value: string): boolean {
    return value.startsWith('data:image/png;base64,') && value.length > 'data:image/png;base64,'.length;
}
