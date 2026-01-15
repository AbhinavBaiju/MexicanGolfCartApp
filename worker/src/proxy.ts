import { Env } from './types';
import { verifyProxySignature } from './security';

interface AvailabilityResponse {
    ok: boolean;
    available?: boolean;
    min_available_qty?: number;
    details?: string;
    error?: string;
}

export async function handleProxyRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');

    // 1. Verify Signature
    const valid = await verifyProxySignature(request, env.SHOPIFY_API_SECRET);
    if (!valid) {
        return new Response('Invalid signature', { status: 401 });
    }

    if (!shop) {
        return new Response('Missing shop parameter', { status: 400 });
    }

    // 2. Route
    // Path will be something like /proxy/availability or /apps/mexicangolfcart/proxy/availability
    // We can just check what the path ends with or contains
    if (url.pathname.endsWith('/availability')) {
        return handleAvailability(request, env, shop);
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

    const quantity = parseInt(quantityStr);
    const productId = parseInt(productIdStr); // Shopify Product ID is BIGINT, but JS number might encounter precision issues if really large? 
    // Usually Shopify IDs are safe integers in JS up to 2^53. 
    // Best practice is to treat them as strings or use BigInt if D1 supports it well.
    // D1 queries expect values.

    if (isNaN(quantity) || quantity < 1) {
        return Response.json({ ok: false, error: 'Invalid quantity' }, { status: 400 });
    }

    // Validate dates
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return Response.json({ ok: false, error: 'Invalid dates' }, { status: 400 });
    }
    if (start > end) {
        return Response.json({ ok: false, error: 'Start date must be before end date' }, { status: 400 });
    }

    try {
        // 1. Get Shop ID
        const shopStmt = await env.DB.prepare('SELECT id FROM shops WHERE shop_domain = ?').bind(shopDomain).first();
        if (!shopStmt) {
            return Response.json({ ok: false, error: 'Shop not found' }, { status: 404 });
        }
        const shopId = shopStmt.id as number;

        // 2. Validate Location
        const locStmt = await env.DB.prepare('SELECT id FROM locations WHERE shop_id = ? AND code = ?')
            .bind(shopId, locationCode)
            .first();
        if (!locStmt) {
            return Response.json({ ok: false, error: 'Invalid location' }, { status: 400 });
        }

        // 3. Get Product settings (default capacity)
        const productStmt = await env.DB.prepare('SELECT default_capacity, rentable FROM products WHERE shop_id = ? AND product_id = ?')
            .bind(shopId, productId)
            .first();

        if (!productStmt) {
            return Response.json({ ok: false, error: 'Product not configured for borrowing' }, { status: 404 });
        }

        if (!productStmt.rentable) {
            return Response.json({ ok: false, error: 'Product is not rentable' }, { status: 400 });
        }

        const defaultCapacity = productStmt.default_capacity as number;

        // 4. Check Inventory
        // We need to check every day in the range. 
        // Days with explicit entries in inventory_day use specific capacity.
        // Days without entries use default_capacity.

        // Approach: fetch all inventory_day records in range.
        // Check availability for found records.
        // Check availability for missing records (using default_capacity).

        const inventoryRows = await env.DB.prepare(
            'SELECT date, capacity, reserved_qty FROM inventory_day WHERE shop_id = ? AND product_id = ? AND date >= ? AND date <= ?'
        )
            .bind(shopId, productId, startDateStr, endDateStr)
            .all();

        const inventoryMap = new Map<string, { capacity: number, reserved: number }>();
        if (inventoryRows.results) {
            for (const row of inventoryRows.results) {
                inventoryMap.set(row.date as string, {
                    capacity: row.capacity as number,
                    reserved: row.reserved_qty as number
                });
            }
        }

        let minAvailable = Infinity;

        // Loop through dates
        const current = new Date(start);
        while (current <= end) {
            const dateStr = current.toISOString().split('T')[0];

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

            // Next day
            current.setDate(current.getDate() + 1);
        }

        const isAvailable = minAvailable >= quantity;

        return Response.json({
            ok: true,
            available: isAvailable,
            min_available_qty: minAvailable
        });

    } catch (e) {
        console.error('Availability check failed', e);
        return Response.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
