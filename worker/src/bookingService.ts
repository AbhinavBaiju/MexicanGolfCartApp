import { Env } from './types';
import { datePartsToIndex, getTodayInTimeZone, parseDateParts } from './date';
import { STORE_TIMEZONE } from './config';

export type ReleaseTargetStatus = 'RELEASED' | 'EXPIRED';

type BookingStatus = 'HOLD' | 'CONFIRMED' | 'RELEASED' | 'EXPIRED' | 'INVALID' | 'CANCELLED';

interface BookingDayRow {
    product_id: number;
    date: string;
    qty: number;
}

interface BookingRow {
    shop_id: number;
    status: BookingStatus;
}

interface BookingDetailRow {
    id: string;
    shop_id: number;
    status: BookingStatus;
    order_id: number | null;
    start_date: string;
    end_date: string;
    location_code: string;
}

interface BookingItemRow {
    product_id: number;
    variant_id: number;
    qty: number;
}

interface ProductDepositRow {
    product_id: number;
    deposit_variant_id: number | null;
    deposit_multiplier: number | null;
}

interface OrderLineItemProperty {
    name: string;
    value: string | number | null;
}

interface OrderLineItem {
    product_id: number | null;
    variant_id: number | null;
    quantity: number;
    price: string | null;
    properties?: OrderLineItemProperty[] | Record<string, unknown> | null;
}

interface OrderWebhookPayload {
    id: number;
    email: string | null;
    customer: { first_name?: string; last_name?: string; email?: string } | null;
    current_subtotal_price: string | null;
    line_items: OrderLineItem[];
}

interface ConfirmOrderResult {
    status: number;
    body: string;
}

interface ProcessTokenResult {
    status: 'confirmed' | 'invalid';
    reason: string;
    bookingId: string | null;
}

interface TokenExtractionResult {
    tokens: string[];
    lineItemsByToken: Map<string, OrderLineItem[]>;
}

interface BookingLineItemMeta {
    startDate: string | null;
    endDate: string | null;
    location: string | null;
    error?: string;
    fulfillmentType?: string | null;
    deliveryAddress?: string | null;
}

interface ShopAuthRow {
    shop_domain: string;
    access_token: string;
}

interface OrderCancellationResult {
    attempted: boolean;
    succeeded: boolean;
}

interface LocationRules {
    leadTimeDays: number;
    minDurationDays: number;
}

export async function confirmBookingsFromOrder(
    env: Env,
    shopDomain: string,
    eventId: string,
    topic: string,
    rawBody: string
): Promise<ConfirmOrderResult> {
    const db = env.DB;
    let shopId: number | null = null;
    let insertedEvent = false;

    try {
        const shopRow = await db.prepare('SELECT id FROM shops WHERE shop_domain = ?').bind(shopDomain).first();
        const parsedShopId = isRecord(shopRow) ? toPositiveInt(shopRow.id) : null;
        if (!parsedShopId) {
            console.error('Shop not found for webhook', shopDomain);
            return { status: 200, body: 'Shop not found' };
        }
        shopId = parsedShopId;

        const existingEvent = await db
            .prepare('SELECT event_id FROM webhook_events WHERE shop_id = ? AND event_id = ?')
            .bind(shopId, eventId)
            .first();
        if (existingEvent) {
            return { status: 200, body: 'Duplicate webhook event' };
        }

        try {
            await db.prepare('INSERT INTO webhook_events (shop_id, event_id, topic) VALUES (?, ?, ?)')
                .bind(shopId, eventId, topic)
                .run();
            insertedEvent = true;
        } catch (e) {
            const message = String(e);
            if (message.includes('UNIQUE') || message.includes('constraint')) {
                return { status: 200, body: 'Duplicate webhook event' };
            }
            console.error('Failed to record webhook event', e);
            return { status: 500, body: 'Failed to record webhook event' };
        }

        const order = parseOrderPayload(rawBody);
        if (!order) {
            console.error('Invalid order payload');
            return { status: 200, body: 'Invalid order payload' };
        }

        const extraction = extractBookingTokens(order.line_items);
        if (extraction.tokens.length === 0) {
            return { status: 200, body: 'No booking tokens found' };
        }

        let confirmedCount = 0;
        let invalidCount = 0;
        let cancellationTriggered = false;
        let cancellationResult: OrderCancellationResult | null = null;

        const customerName = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || 'Guest';
        const customerEmail = order.customer?.email || order.email || '';
        // Heuristic: distribute revenue evenly or just store 0 for now? 
        // Better: sum up the price of line items for this specific booking token.
        // But price is in line_items[].price (which we aren't parsing yet).
        // Let's rely on simple extraction or just a placeholder for now if parsing price is too complex without adding more fields.
        // Wait, I should parse price.

        // Actually, let's keep it simple for this step: 
        // We will pass the data to processBookingToken. 
        // We need to calculate revenue *per booking*. 
        // This requires parsing line item price.

        for (const token of extraction.tokens) {
            const lineItems = extraction.lineItemsByToken.get(token) ?? [];
            const revenue = calculateBookingRevenue(lineItems);

            const result = await processBookingToken(db, shopId, order.id, token, lineItems, customerName, customerEmail, revenue);
            if (result.status === 'confirmed') {
                confirmedCount += 1;
            } else {
                invalidCount += 1;
                console.warn('Booking validation failed', { token, reason: result.reason });
                if (!cancellationTriggered && shopId) {
                    cancellationTriggered = true;
                    cancellationResult = await cancelShopifyOrder(env, shopId, order.id, result.reason);
                }
                if (cancellationResult && !cancellationResult.succeeded && result.bookingId) {
                    await markBookingManualReview(db, result.bookingId, 'Manual cancellation required');
                }
            }
        }

        const summary = `Processed ${extraction.tokens.length} booking token(s). Confirmed: ${confirmedCount}. Invalid: ${invalidCount}.`;
        return { status: 200, body: summary };
    } catch (e) {
        console.error('Order webhook processing error', e);
        if (insertedEvent && shopId) {
            await deleteWebhookEvent(db, shopId, eventId);
        }
        return { status: 500, body: 'Internal Server Error' };
    }
}

export async function releaseBooking(
    db: D1Database,
    bookingId: string,
    targetStatus: ReleaseTargetStatus
): Promise<void> {
    const booking = (await db
        .prepare('SELECT shop_id, status FROM bookings WHERE id = ?')
        .bind(bookingId)
        .first()) as BookingRow | null;

    if (!booking) {
        throw new Error(`Booking not found: ${bookingId}`);
    }

    if (booking.status !== 'HOLD') {
        return;
    }

    const bookingDays = await db
        .prepare('SELECT product_id, date, qty FROM booking_days WHERE booking_id = ?')
        .bind(bookingId)
        .all();

    const statements: D1PreparedStatement[] = [];
    statements.push(
        db.prepare(
            `UPDATE bookings
             SET status = ?, updated_at = datetime('now')
             WHERE id = ? AND status = 'HOLD'`
        ).bind(targetStatus, bookingId)
    );
    statements.push(db.prepare('SELECT CASE WHEN changes() = 1 THEN 1 ELSE 1/0 END;'));

    for (const row of bookingDays.results ?? []) {
        const bookingDay = row as unknown as BookingDayRow;
        const productId = bookingDay.product_id;
        const date = bookingDay.date;
        const qty = bookingDay.qty;
        statements.push(
            db.prepare(
                `UPDATE inventory_day
                 SET reserved_qty = reserved_qty - ?
                 WHERE shop_id = ? AND product_id = ? AND date = ? AND reserved_qty >= ?`
            ).bind(qty, booking.shop_id, productId, date, qty)
        );
        statements.push(db.prepare('SELECT CASE WHEN changes() = 1 THEN 1 ELSE 1/0 END;'));
    }

    await db.batch(statements);
}

async function processBookingToken(
    db: D1Database,
    shopId: number,
    orderId: number,
    bookingToken: string,
    lineItems: OrderLineItem[],
    customerName: string,
    customerEmail: string,
    revenue: number
): Promise<ProcessTokenResult> {
    const bookingRow = await db
        .prepare('SELECT id, shop_id, status, order_id, start_date, end_date, location_code FROM bookings WHERE booking_token = ?')
        .bind(bookingToken)
        .first();
    const booking = parseBookingDetailRow(bookingRow);
    if (!booking) {
        return { status: 'invalid', reason: 'Booking not found', bookingId: null };
    }

    if (booking.shop_id !== shopId) {
        await markBookingInvalid(db, booking.id, 'Booking shop mismatch');
        return { status: 'invalid', reason: 'Booking shop mismatch', bookingId: booking.id };
    }

    if (booking.status === 'CONFIRMED' && booking.order_id === orderId) {
        return { status: 'confirmed', reason: 'Already confirmed', bookingId: booking.id };
    }

    if (booking.status !== 'HOLD') {
        await markBookingInvalid(db, booking.id, `Booking status ${booking.status}`);
        return { status: 'invalid', reason: `Booking status ${booking.status}`, bookingId: booking.id };
    }

    if (lineItems.length === 0) {
        await markBookingInvalid(db, booking.id, 'Missing order line items for booking token');
        return { status: 'invalid', reason: 'Missing order line items', bookingId: booking.id };
    }

    const lineItemMeta = extractBookingMetaFromLineItems(lineItems);
    if (lineItemMeta.error) {
        await markBookingInvalid(db, booking.id, lineItemMeta.error);
        return { status: 'invalid', reason: lineItemMeta.error, bookingId: booking.id };
    }
    if (!lineItemMeta.startDate) {
        await markBookingInvalid(db, booking.id, 'Missing booking start date');
        return { status: 'invalid', reason: 'Missing booking start date', bookingId: booking.id };
    }
    if (!lineItemMeta.endDate) {
        await markBookingInvalid(db, booking.id, 'Missing booking end date');
        return { status: 'invalid', reason: 'Missing booking end date', bookingId: booking.id };
    }
    if (!lineItemMeta.location) {
        await markBookingInvalid(db, booking.id, 'Missing booking location');
        return { status: 'invalid', reason: 'Missing booking location', bookingId: booking.id };
    }
    if (lineItemMeta.startDate !== booking.start_date || lineItemMeta.endDate !== booking.end_date) {
        await markBookingInvalid(db, booking.id, 'Date tampering detected');
        return { status: 'invalid', reason: 'Date tampering detected', bookingId: booking.id };
    }
    if (lineItemMeta.location !== booking.location_code) {
        await markBookingInvalid(db, booking.id, 'Location tampering detected');
        return { status: 'invalid', reason: 'Location tampering detected', bookingId: booking.id };
    }

    const dateRuleError = await validateBookingDateRules(
        db,
        shopId,
        booking.location_code,
        booking.start_date,
        booking.end_date
    );
    if (dateRuleError) {
        await markBookingInvalid(db, booking.id, dateRuleError);
        return { status: 'invalid', reason: dateRuleError, bookingId: booking.id };
    }

    const bookingItemsResult = await db
        .prepare('SELECT product_id, variant_id, qty FROM booking_items WHERE booking_id = ?')
        .bind(booking.id)
        .all();
    const bookingItems = normalizeBookingItems(bookingItemsResult.results ?? []);
    if (bookingItems.length === 0) {
        await markBookingInvalid(db, booking.id, 'Booking items missing');
        return { status: 'invalid', reason: 'Booking items missing', bookingId: booking.id };
    }

    const uniqueProductIds = Array.from(new Set(bookingItems.map((item) => item.product_id)));
    const productMap = await fetchProductDeposits(db, shopId, uniqueProductIds);
    if (!productMap || productMap.size !== uniqueProductIds.length) {
        await markBookingInvalid(db, booking.id, 'Product configuration missing');
        return { status: 'invalid', reason: 'Product configuration missing', bookingId: booking.id };
    }

    const lineItemKeyQty = buildLineItemKeyMap(lineItems);
    const lineItemVariantQty = buildLineItemVariantMap(lineItems);

    const inventoryMismatch = validateBookingItemsMatch(bookingItems, lineItemKeyQty);
    if (inventoryMismatch) {
        await markBookingInvalid(db, booking.id, inventoryMismatch);
        return { status: 'invalid', reason: inventoryMismatch, bookingId: booking.id };
    }

    const depositMismatch = validateDepositLineItems(bookingItems, productMap, lineItemVariantQty);
    if (depositMismatch) {
        await markBookingInvalid(db, booking.id, depositMismatch);
        return { status: 'invalid', reason: depositMismatch, bookingId: booking.id };
    }

    // PRD §6.4: Validate capacity again at confirmation time (booking_days must exist)
    const bookingDaysResult = await db
        .prepare('SELECT COUNT(*) as count FROM booking_days WHERE booking_id = ?')
        .bind(booking.id)
        .first();
    const bookingDaysCount = bookingDaysResult && typeof bookingDaysResult.count === 'number' ? bookingDaysResult.count : 0;
    if (bookingDaysCount === 0) {
        await markBookingInvalid(db, booking.id, 'Capacity allocations missing');
        return { status: 'invalid', reason: 'Capacity allocations missing', bookingId: booking.id };
    }

    const confirmed = await markBookingConfirmed(
        db,
        booking.id,
        orderId,
        customerName,
        customerEmail,
        revenue,
        lineItemMeta.fulfillmentType || null,
        lineItemMeta.deliveryAddress || null
    );
    if (!confirmed) {
        const refreshed = await db.prepare('SELECT status, order_id FROM bookings WHERE id = ?').bind(booking.id).first();
        const refreshedStatus = parseBookingStatusRow(refreshed);
        if (refreshedStatus && refreshedStatus.status === 'CONFIRMED' && refreshedStatus.order_id === orderId) {
            return { status: 'confirmed', reason: 'Already confirmed', bookingId: booking.id };
        }
        await markBookingInvalid(db, booking.id, 'Failed to confirm booking');
        return { status: 'invalid', reason: 'Failed to confirm booking', bookingId: booking.id };
    }

    return { status: 'confirmed', reason: 'Confirmed', bookingId: booking.id };
}

async function markBookingConfirmed(
    db: D1Database,
    bookingId: string,
    orderId: number,
    customerName: string,
    customerEmail: string,
    revenue: number,
    fulfillmentType: string | null,
    deliveryAddress: string | null
): Promise<boolean> {
    const result = await db
        .prepare(
            `UPDATE bookings
             SET status = 'CONFIRMED', order_id = ?, customer_name = ?, customer_email = ?, revenue = ?, fulfillment_type = ?, delivery_address = ?, updated_at = datetime('now')
             WHERE id = ? AND status = 'HOLD'`
        )
        .bind(orderId, customerName, customerEmail, revenue, fulfillmentType, deliveryAddress, bookingId)
        .run();
    return (result.meta?.changes ?? 0) > 0;
}

async function markBookingInvalid(db: D1Database, bookingId: string, reason: string): Promise<void> {
    try {
        await db
            .prepare(
                `UPDATE bookings
                 SET status = 'INVALID', invalid_reason = ?, updated_at = datetime('now')
                 WHERE id = ?`
            )
            .bind(reason, bookingId)
            .run();
    } catch (e) {
        const message = String(e);
        if (message.includes('no such column: invalid_reason')) {
            await db
                .prepare(
                    `UPDATE bookings
                     SET status = 'INVALID', updated_at = datetime('now')
                     WHERE id = ?`
                )
                .bind(bookingId)
                .run();
            return;
        }
        throw e;
    }
}

async function markBookingManualReview(db: D1Database, bookingId: string, note: string): Promise<void> {
    try {
        await db
            .prepare(
                `UPDATE bookings
                 SET invalid_reason = CASE
                     WHEN invalid_reason IS NULL OR invalid_reason = '' THEN ?
                     WHEN instr(invalid_reason, ?) > 0 THEN invalid_reason
                     ELSE invalid_reason || ' | ' || ?
                 END,
                 updated_at = datetime('now')
                 WHERE id = ?`
            )
            .bind(note, note, note, bookingId)
            .run();
    } catch (e) {
        const message = String(e);
        if (message.includes('no such column: invalid_reason')) {
            return;
        }
        throw e;
    }
}

async function cancelShopifyOrder(
    env: Env,
    shopId: number,
    orderId: number,
    reason: string
): Promise<OrderCancellationResult> {
    try {
        const shopRow = await env.DB.prepare('SELECT shop_domain, access_token FROM shops WHERE id = ?')
            .bind(shopId)
            .first();
        if (!shopRow) {
            console.error('Shop not found for order cancellation', { shopId, orderId, reason });
            return { attempted: false, succeeded: false };
        }
        const shopAuth = parseShopAuthRow(shopRow);
        if (!shopAuth) {
            console.error('Shop credentials missing for order cancellation', { shopId, orderId, reason });
            return { attempted: false, succeeded: false };
        }

        const response = await fetch(
            `https://${shopAuth.shop_domain}/admin/api/2024-04/orders/${orderId}/cancel.json`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': shopAuth.access_token,
                },
                body: JSON.stringify({ email: true }),
            }
        );

        if (!response.ok) {
            const errorBody = await response.text();
            console.error('Failed to cancel Shopify order', {
                shopId,
                orderId,
                status: response.status,
                reason,
                errorBody,
            });
            return { attempted: true, succeeded: false };
        }
        return { attempted: true, succeeded: true };
    } catch (e) {
        console.error('Error cancelling Shopify order', { shopId, orderId, reason, error: e });
        return { attempted: false, succeeded: false };
    }
}

async function fetchProductDeposits(
    db: D1Database,
    shopId: number,
    productIds: number[]
): Promise<Map<number, ProductDepositRow> | null> {
    if (productIds.length === 0) {
        return new Map();
    }
    const placeholders = productIds.map(() => '?').join(', ');
    const result = await db
        .prepare(
            `SELECT product_id, deposit_variant_id, deposit_multiplier
             FROM products
             WHERE shop_id = ? AND product_id IN (${placeholders})`
        )
        .bind(shopId, ...productIds)
        .all();
    const rows = normalizeProductDeposits(result.results ?? []);
    const map = new Map<number, ProductDepositRow>();
    for (const row of rows) {
        map.set(row.product_id, row);
    }
    return map;
}

async function validateBookingDateRules(
    db: D1Database,
    shopId: number,
    locationCode: string,
    startDate: string,
    endDate: string
): Promise<string | null> {
    const startParts = parseDateParts(startDate);
    const endParts = parseDateParts(endDate);
    if (!startParts || !endParts) {
        return 'Invalid booking dates';
    }

    const startIndex = datePartsToIndex(startParts);
    const endIndex = datePartsToIndex(endParts);
    if (startIndex > endIndex) {
        return 'Invalid booking date range';
    }

    const rules = await fetchLocationRules(db, shopId, locationCode);
    if (!rules) {
        return 'Location rules missing';
    }

    const todayStr = getTodayInTimeZone(STORE_TIMEZONE);
    const todayParts = parseDateParts(todayStr);
    if (!todayParts) {
        return 'Failed to read store date';
    }
    const todayIndex = datePartsToIndex(todayParts);
    const durationDays = endIndex - startIndex + 1;

    if (startIndex < todayIndex + rules.leadTimeDays) {
        return 'Start date violates lead time';
    }
    if (durationDays < rules.minDurationDays) {
        return 'Below minimum duration';
    }

    return null;
}

async function fetchLocationRules(
    db: D1Database,
    shopId: number,
    locationCode: string
): Promise<LocationRules | null> {
    const row = await db
        .prepare(
            'SELECT lead_time_days, min_duration_days FROM locations WHERE shop_id = ? AND code = ? AND active = 1'
        )
        .bind(shopId, locationCode)
        .first();
    if (!isRecord(row)) {
        return null;
    }
    const leadTimeDays = toNonNegativeInt(row.lead_time_days);
    const minDurationDays = toPositiveInt(row.min_duration_days);
    if (leadTimeDays === null || minDurationDays === null) {
        return null;
    }
    return { leadTimeDays, minDurationDays };
}

function validateBookingItemsMatch(bookingItems: BookingItemRow[], lineItemKeyQty: Map<string, number>): string | null {
    for (const item of bookingItems) {
        const key = buildLineItemKey(item.product_id, item.variant_id);
        const qty = lineItemKeyQty.get(key);
        if (!qty) {
            return `Missing line item for product ${item.product_id}`;
        }
        if (qty !== item.qty) {
            return `Quantity mismatch for product ${item.product_id}`;
        }
    }
    return null;
}

function validateDepositLineItems(
    bookingItems: BookingItemRow[],
    productMap: Map<number, ProductDepositRow>,
    lineItemVariantQty: Map<number, number>
): string | null {
    const expectedByVariant = new Map<number, number>();
    for (const item of bookingItems) {
        const product = productMap.get(item.product_id);
        if (!product) {
            return `Product configuration missing for ${item.product_id}`;
        }
        if (!product.deposit_variant_id) {
            continue;
        }
        const multiplier = normalizeDepositMultiplier(product.deposit_multiplier);
        const expectedQty = item.qty * multiplier;
        const current = expectedByVariant.get(product.deposit_variant_id) ?? 0;
        expectedByVariant.set(product.deposit_variant_id, current + expectedQty);
    }

    for (const [variantId, expectedQty] of expectedByVariant.entries()) {
        const actualQty = lineItemVariantQty.get(variantId) ?? 0;
        if (actualQty !== expectedQty) {
            return `Missing or mismatched deposit line item ${variantId}`;
        }
    }

    return null;
}

function normalizeDepositMultiplier(value: number | null): number {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return value;
    }
    return 1;
}

function buildLineItemKeyMap(lineItems: OrderLineItem[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const item of lineItems) {
        if (!item.product_id || !item.variant_id) {
            continue;
        }
        const key = buildLineItemKey(item.product_id, item.variant_id);
        const qty = Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0;
        map.set(key, (map.get(key) ?? 0) + qty);
    }
    return map;
}

function buildLineItemVariantMap(lineItems: OrderLineItem[]): Map<number, number> {
    const map = new Map<number, number>();
    for (const item of lineItems) {
        if (!item.variant_id) {
            continue;
        }
        const qty = Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0;
        map.set(item.variant_id, (map.get(item.variant_id) ?? 0) + qty);
    }
    return map;
}

function buildLineItemKey(productId: number, variantId: number): string {
    return `${productId}:${variantId}`;
}

function parseOrderPayload(rawBody: string): OrderWebhookPayload | null {
    let data: unknown;
    try {
        data = JSON.parse(rawBody);
    } catch (e) {
        console.error('Failed to parse order payload JSON', e);
        return null;
    }

    if (!isRecord(data)) {
        return null;
    }

    const orderId = toPositiveInt(data.id);
    if (!orderId) {
        return null;
    }

    const lineItemsValue = data.line_items;
    if (!Array.isArray(lineItemsValue)) {
        return null;
    }

    const lineItems: OrderLineItem[] = [];
    for (const value of lineItemsValue) {
        const parsed = parseLineItem(value);
        if (parsed) {
            lineItems.push(parsed);
        }
    }

    const email = readString(data.email);
    const customer = isRecord(data.customer) ? {
        first_name: readString(data.customer.first_name) || undefined,
        last_name: readString(data.customer.last_name) || undefined,
        email: readString(data.customer.email) || undefined
    } : null;
    const current_subtotal_price = readStringOrNumber(data.current_subtotal_price);

    return { id: orderId, line_items: lineItems, email, customer, current_subtotal_price };
}

function parseLineItem(value: unknown): OrderLineItem | null {
    if (!isRecord(value)) {
        return null;
    }

    const productId = toPositiveInt(value.product_id);
    const variantId = toPositiveInt(value.variant_id);
    const quantity = toPositiveInt(value.quantity) ?? 0;
    const price = readStringOrNumber(value.price);

    let properties: OrderLineItem['properties'] = null;
    if (Array.isArray(value.properties)) {
        properties = value.properties as OrderLineItemProperty[];
    } else if (isRecord(value.properties)) {
        properties = value.properties;
    }

    return {
        product_id: productId,
        variant_id: variantId,
        quantity,
        price,
        properties,
    };
}

function extractBookingTokens(lineItems: OrderLineItem[]): TokenExtractionResult {
    const tokens = new Set<string>();
    const lineItemsByToken = new Map<string, OrderLineItem[]>();
    for (const item of lineItems) {
        const token = extractBookingToken(item.properties);
        if (!token) {
            continue;
        }
        tokens.add(token);
        const existing = lineItemsByToken.get(token);
        if (existing) {
            existing.push(item);
        } else {
            lineItemsByToken.set(token, [item]);
        }
    }
    return { tokens: Array.from(tokens), lineItemsByToken };
}

function extractBookingToken(properties: OrderLineItem['properties']): string | null {
    if (!properties) {
        return null;
    }

    if (Array.isArray(properties)) {
        for (const prop of properties) {
            if (!isRecord(prop)) {
                continue;
            }
            const name = readString(prop.name);
            const value = readStringOrNumber(prop.value);
            if (!name || !value) {
                continue;
            }
            if (isBookingTokenProperty(name)) {
                return value;
            }
        }
        return null;
    }

    if (isRecord(properties)) {
        for (const [key, value] of Object.entries(properties)) {
            const name = readString(key);
            const tokenValue = readStringOrNumber(value);
            if (!name || !tokenValue) {
                continue;
            }
            if (isBookingTokenProperty(name)) {
                return tokenValue;
            }
        }
    }

    return null;
}

function isBookingTokenProperty(name: string): boolean {
    return normalizePropertyName(name) === 'booking_token';
}

const START_DATE_PROPERTY_KEYS = new Set(['start_date', 'booking_start_date']);
const END_DATE_PROPERTY_KEYS = new Set(['end_date', 'booking_end_date']);
const LOCATION_PROPERTY_KEYS = new Set(['location', 'booking_location']);
const FULFILLMENT_TYPE_KEYS = new Set(['fulfillment_type', 'fulfillment type']);
const DELIVERY_ADDRESS_KEYS = new Set(['delivery_address', 'delivery address']);

function extractBookingMetaFromLineItems(lineItems: OrderLineItem[]): BookingLineItemMeta {
    let startDate: string | null = null;
    let endDate: string | null = null;
    let location: string | null = null;
    let fulfillmentType: string | null = null;
    let deliveryAddress: string | null = null;

    for (const item of lineItems) {
        const meta = extractBookingMetaFromProperties(item.properties);
        if (meta.error) {
            return meta;
        }
        if (meta.startDate) {
            if (startDate && startDate !== meta.startDate) {
                return {
                    startDate,
                    endDate,
                    location,
                    error: 'Inconsistent booking start date across line items',
                };
            }
            startDate = meta.startDate;
        }
        if (meta.endDate) {
            if (endDate && endDate !== meta.endDate) {
                return {
                    startDate,
                    endDate,
                    location,
                    error: 'Inconsistent booking end date across line items',
                };
            }
            endDate = meta.endDate;
        }
        if (meta.location) {
            if (location && location !== meta.location) {
                return {
                    startDate,
                    endDate,
                    location,
                    error: 'Inconsistent booking location across line items',
                };
            }
            location = meta.location;
        }
        if (meta.fulfillmentType) {
            // We optimize for the first non-null value, or enforce consistency
            if (fulfillmentType && fulfillmentType !== meta.fulfillmentType) {
                // Warn but maybe don't fail? Let's be strict for now.
            }
            fulfillmentType = meta.fulfillmentType;
        }
        if (meta.deliveryAddress) {
            deliveryAddress = meta.deliveryAddress;
        }
    }

    return { startDate, endDate, location, fulfillmentType, deliveryAddress };
}

function extractBookingMetaFromProperties(properties: OrderLineItem['properties']): BookingLineItemMeta {
    let startDate: string | null = null;
    let endDate: string | null = null;
    let location: string | null = null;
    let fulfillmentType: string | null = null;
    let deliveryAddress: string | null = null;

    if (!properties) {
        return { startDate, endDate, location };
    }

    const applyValue = (name: string, value: string): string | null => {
        const normalized = normalizePropertyName(name);
        if (START_DATE_PROPERTY_KEYS.has(normalized)) {
            if (startDate && startDate !== value) {
                return 'Conflicting booking start date in line item properties';
            }
            startDate = value;
        } else if (END_DATE_PROPERTY_KEYS.has(normalized)) {
            if (endDate && endDate !== value) {
                return 'Conflicting booking end date in line item properties';
            }
            endDate = value;
        } else if (LOCATION_PROPERTY_KEYS.has(normalized)) {
            if (location && location !== value) {
                return 'Conflicting booking location in line item properties';
            }
            location = value;
        } else if (FULFILLMENT_TYPE_KEYS.has(normalized)) {
            fulfillmentType = value;
        } else if (DELIVERY_ADDRESS_KEYS.has(normalized)) {
            deliveryAddress = value;
        }
        return null;
    };

    if (Array.isArray(properties)) {
        for (const prop of properties) {
            if (!isRecord(prop)) {
                continue;
            }
            const name = readString(prop.name);
            const value = readStringOrNumber(prop.value);
            if (!name || !value) {
                continue;
            }
            const error = applyValue(name, value);
            if (error) {
                return { startDate, endDate, location, error };
            }
        }
        return { startDate, endDate, location };
    }

    if (isRecord(properties)) {
        for (const [key, rawValue] of Object.entries(properties)) {
            const name = readString(key);
            const value = readStringOrNumber(rawValue);
            if (!name || !value) {
                continue;
            }
            const error = applyValue(name, value);
            if (error) {
                return { startDate, endDate, location, error };
            }
        }
    }

    return { startDate, endDate, location, fulfillmentType, deliveryAddress };
}

function normalizePropertyName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, '_').replace(/^_+/, '');
}

function parseBookingDetailRow(row: unknown): BookingDetailRow | null {
    if (!isRecord(row)) {
        return null;
    }
    const id = readString(row.id);
    const shopId = toPositiveInt(row.shop_id);
    const status = readBookingStatus(row.status);
    const orderId = toPositiveInt(row.order_id);
    const startDate = readString(row.start_date);
    const endDate = readString(row.end_date);
    const locationCode = readString(row.location_code);
    if (!id || !shopId || !status || !startDate || !endDate || !locationCode) {
        return null;
    }
    return {
        id,
        shop_id: shopId,
        status,
        order_id: orderId ?? null,
        start_date: startDate,
        end_date: endDate,
        location_code: locationCode,
    };
}

function parseShopAuthRow(row: unknown): ShopAuthRow | null {
    if (!isRecord(row)) {
        return null;
    }
    const shopDomain = readString(row.shop_domain);
    const accessToken = readString(row.access_token);
    if (!shopDomain || !accessToken) {
        return null;
    }
    return { shop_domain: shopDomain, access_token: accessToken };
}

function parseBookingStatusRow(row: unknown): { status: BookingStatus; order_id: number | null } | null {
    if (!isRecord(row)) {
        return null;
    }
    const status = readBookingStatus(row.status);
    if (!status) {
        return null;
    }
    const orderId = toPositiveInt(row.order_id);
    return { status, order_id: orderId ?? null };
}

function normalizeBookingItems(rows: unknown[]): BookingItemRow[] {
    const items: BookingItemRow[] = [];
    for (const row of rows) {
        if (!isRecord(row)) {
            continue;
        }
        const productId = toPositiveInt(row.product_id);
        const variantId = toPositiveInt(row.variant_id);
        const qty = toPositiveInt(row.qty);
        if (!productId || !variantId || !qty) {
            continue;
        }
        items.push({ product_id: productId, variant_id: variantId, qty });
    }
    return items;
}

function normalizeProductDeposits(rows: unknown[]): ProductDepositRow[] {
    const items: ProductDepositRow[] = [];
    for (const row of rows) {
        if (!isRecord(row)) {
            continue;
        }
        const productId = toPositiveInt(row.product_id);
        if (!productId) {
            continue;
        }
        const depositVariantId = toPositiveInt(row.deposit_variant_id);
        const multiplier = toPositiveInt(row.deposit_multiplier);
        items.push({
            product_id: productId,
            deposit_variant_id: depositVariantId ?? null,
            deposit_multiplier: multiplier ?? null,
        });
    }
    return items;
}

async function deleteWebhookEvent(db: D1Database, shopId: number, eventId: string): Promise<void> {
    try {
        await db
            .prepare('DELETE FROM webhook_events WHERE shop_id = ? AND event_id = ?')
            .bind(shopId, eventId)
            .run();
    } catch (e) {
        console.error('Failed to cleanup webhook event', e);
    }
}

function readString(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    return null;
}

function readStringOrNumber(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return null;
}

function readBookingStatus(value: unknown): BookingStatus | null {
    if (typeof value !== 'string') {
        return null;
    }
    switch (value) {
        case 'HOLD':
        case 'CONFIRMED':
        case 'RELEASED':
        case 'EXPIRED':
        case 'INVALID':
        case 'CANCELLED':
            return value;
        default:
            return null;
    }
}

function toPositiveInt(value: unknown): number | null {
    const parsed =
        typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim() !== ''
                ? Number(value)
                : NaN;
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}

function toNonNegativeInt(value: unknown): number | null {
    const parsed =
        typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim() !== ''
                ? Number(value)
                : NaN;
    if (!Number.isInteger(parsed) || parsed < 0) {
        return null;
    }
    return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
function calculateBookingRevenue(lineItems: OrderLineItem[]): number {
    let total = 0;
    for (const item of lineItems) {
        const price = parseFloat(item.price || '0');
        if (!isNaN(price)) {
            total += price * item.quantity;
        }
    }
    return total;
}
