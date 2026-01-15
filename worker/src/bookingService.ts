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
    properties?: OrderLineItemProperty[] | Record<string, unknown> | null;
}

interface OrderWebhookPayload {
    id: number;
    line_items: OrderLineItem[];
}

interface ConfirmOrderResult {
    status: number;
    body: string;
}

interface ProcessTokenResult {
    status: 'confirmed' | 'invalid';
    reason: string;
}

interface TokenExtractionResult {
    tokens: string[];
    lineItemsByToken: Map<string, OrderLineItem[]>;
}

export async function confirmBookingsFromOrder(
    db: D1Database,
    shopDomain: string,
    eventId: string,
    topic: string,
    rawBody: string
): Promise<ConfirmOrderResult> {
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

        for (const token of extraction.tokens) {
            const lineItems = extraction.lineItemsByToken.get(token) ?? [];
            const result = await processBookingToken(db, shopId, order.id, token, lineItems);
            if (result.status === 'confirmed') {
                confirmedCount += 1;
            } else {
                invalidCount += 1;
                console.warn('Booking validation failed', { token, reason: result.reason });
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
        const bookingDay = row as BookingDayRow;
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
    lineItems: OrderLineItem[]
): Promise<ProcessTokenResult> {
    const bookingRow = await db
        .prepare('SELECT id, shop_id, status, order_id FROM bookings WHERE booking_token = ?')
        .bind(bookingToken)
        .first();
    const booking = parseBookingDetailRow(bookingRow);
    if (!booking) {
        return { status: 'invalid', reason: 'Booking not found' };
    }

    if (booking.shop_id !== shopId) {
        await markBookingInvalid(db, booking.id, 'Booking shop mismatch');
        return { status: 'invalid', reason: 'Booking shop mismatch' };
    }

    if (booking.status === 'CONFIRMED' && booking.order_id === orderId) {
        return { status: 'confirmed', reason: 'Already confirmed' };
    }

    if (booking.status !== 'HOLD') {
        await markBookingInvalid(db, booking.id, `Booking status ${booking.status}`);
        return { status: 'invalid', reason: `Booking status ${booking.status}` };
    }

    if (lineItems.length === 0) {
        await markBookingInvalid(db, booking.id, 'Missing order line items for booking token');
        return { status: 'invalid', reason: 'Missing order line items' };
    }

    const bookingItemsResult = await db
        .prepare('SELECT product_id, variant_id, qty FROM booking_items WHERE booking_id = ?')
        .bind(booking.id)
        .all();
    const bookingItems = normalizeBookingItems(bookingItemsResult.results ?? []);
    if (bookingItems.length === 0) {
        await markBookingInvalid(db, booking.id, 'Booking items missing');
        return { status: 'invalid', reason: 'Booking items missing' };
    }

    const uniqueProductIds = Array.from(new Set(bookingItems.map((item) => item.product_id)));
    const productMap = await fetchProductDeposits(db, shopId, uniqueProductIds);
    if (!productMap || productMap.size !== uniqueProductIds.length) {
        await markBookingInvalid(db, booking.id, 'Product configuration missing');
        return { status: 'invalid', reason: 'Product configuration missing' };
    }

    const lineItemKeyQty = buildLineItemKeyMap(lineItems);
    const lineItemVariantQty = buildLineItemVariantMap(lineItems);

    const inventoryMismatch = validateBookingItemsMatch(bookingItems, lineItemKeyQty);
    if (inventoryMismatch) {
        await markBookingInvalid(db, booking.id, inventoryMismatch);
        return { status: 'invalid', reason: inventoryMismatch };
    }

    const depositMismatch = validateDepositLineItems(bookingItems, productMap, lineItemVariantQty);
    if (depositMismatch) {
        await markBookingInvalid(db, booking.id, depositMismatch);
        return { status: 'invalid', reason: depositMismatch };
    }

    const confirmed = await markBookingConfirmed(db, booking.id, orderId);
    if (!confirmed) {
        const refreshed = await db.prepare('SELECT status, order_id FROM bookings WHERE id = ?').bind(booking.id).first();
        const refreshedStatus = parseBookingStatusRow(refreshed);
        if (refreshedStatus && refreshedStatus.status === 'CONFIRMED' && refreshedStatus.order_id === orderId) {
            return { status: 'confirmed', reason: 'Already confirmed' };
        }
        await markBookingInvalid(db, booking.id, 'Failed to confirm booking');
        return { status: 'invalid', reason: 'Failed to confirm booking' };
    }

    return { status: 'confirmed', reason: 'Confirmed' };
}

async function markBookingConfirmed(db: D1Database, bookingId: string, orderId: number): Promise<boolean> {
    const result = await db
        .prepare(
            `UPDATE bookings
             SET status = 'CONFIRMED', order_id = ?, updated_at = datetime('now')
             WHERE id = ? AND status = 'HOLD'`
        )
        .bind(orderId, bookingId)
        .run();
    return (result.changes ?? 0) > 0;
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

    return { id: orderId, line_items: lineItems };
}

function parseLineItem(value: unknown): OrderLineItem | null {
    if (!isRecord(value)) {
        return null;
    }

    const productId = toPositiveInt(value.product_id);
    const variantId = toPositiveInt(value.variant_id);
    const quantity = toPositiveInt(value.quantity) ?? 0;

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
    const normalized = name.trim().toLowerCase().replace(/\s+/g, '_');
    const stripped = normalized.replace(/^_+/, '');
    return stripped === 'booking_token';
}

function parseBookingDetailRow(row: unknown): BookingDetailRow | null {
    if (!isRecord(row)) {
        return null;
    }
    const id = readString(row.id);
    const shopId = toPositiveInt(row.shop_id);
    const status = readBookingStatus(row.status);
    const orderId = toPositiveInt(row.order_id);
    if (!id || !shopId || !status) {
        return null;
    }
    return { id, shop_id: shopId, status, order_id: orderId ?? null };
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
