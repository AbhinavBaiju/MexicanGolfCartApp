import assert from 'node:assert/strict';
import test from 'node:test';

import { confirmBookingsFromOrder } from '../src/bookingService';
import type { Env } from '../src/types';
import { createMockDbController } from './helpers/mockD1';

interface ScenarioOptions {
    bookingStatus?: 'HOLD' | 'CONFIRMED' | 'RELEASED' | 'EXPIRED' | 'INVALID' | 'CANCELLED';
    bookingQty?: number;
    orderQty?: number;
    bookingStart?: string;
    bookingEnd?: string;
    orderStart?: string;
    orderEnd?: string;
    bookingLocation?: string;
    orderLocation?: string;
    depositVariantId?: number | null;
    includeDepositLine?: boolean;
    leadTimeDays?: number;
    minDurationDays?: number;
}

function createEnv(db: D1Database): Env {
    return {
        DB: db,
        ENVIRONMENT: 'test',
        SHOPIFY_API_KEY: 'test-api-key',
        SHOPIFY_API_SECRET: 'test-api-secret',
        SHOPIFY_APP_URL: 'https://worker.example',
    };
}

function buildOrderPayload(options: ScenarioOptions): string {
    const bookingToken = 'token-123';
    const orderQty = options.orderQty ?? 1;
    const start = options.orderStart ?? '2099-01-10';
    const end = options.orderEnd ?? '2099-01-11';
    const location = options.orderLocation ?? 'PLAYA';

    const rentalLine = {
        product_id: 101,
        variant_id: 202,
        quantity: orderQty,
        price: '100.00',
        properties: [
            { name: 'booking_token', value: bookingToken },
            { name: 'Start Date', value: start },
            { name: 'End Date', value: end },
            { name: 'Location', value: location },
        ],
    };

    const lineItems = [rentalLine];
    if (options.includeDepositLine && options.depositVariantId) {
        lineItems.push({
            product_id: null,
            variant_id: options.depositVariantId,
            quantity: orderQty,
            price: '50.00',
            properties: [{ name: 'booking_token', value: bookingToken }],
        });
    }

    return JSON.stringify({
        id: 5001,
        email: 'customer@example.com',
        customer: { first_name: 'Ada', last_name: 'Lovelace', email: 'customer@example.com' },
        line_items: lineItems,
        note_attributes: [],
    });
}

function createController(options: ScenarioOptions) {
    const bookingStatus = options.bookingStatus ?? 'HOLD';
    const bookingQty = options.bookingQty ?? 1;
    const bookingStart = options.bookingStart ?? '2099-01-10';
    const bookingEnd = options.bookingEnd ?? '2099-01-11';
    const bookingLocation = options.bookingLocation ?? 'PLAYA';
    const leadTimeDays = options.leadTimeDays ?? 0;
    const minDurationDays = options.minDurationDays ?? 1;

    return createMockDbController({
        rules: [
            {
                match: 'SELECT id FROM shops WHERE shop_domain = ?',
                first: { id: 99 },
            },
            {
                match: 'SELECT event_id FROM webhook_events WHERE shop_id = ? AND event_id = ?',
                first: null,
            },
            {
                match: 'INSERT INTO webhook_events',
                run: { meta: { changes: 1 } },
            },
            {
                match: 'SELECT id, shop_id, status, order_id, start_date, end_date, location_code FROM bookings WHERE booking_token = ?',
                first: {
                    id: 'booking-abc',
                    shop_id: 99,
                    status: bookingStatus,
                    order_id: null,
                    start_date: bookingStart,
                    end_date: bookingEnd,
                    location_code: bookingLocation,
                },
            },
            {
                match: 'SELECT lead_time_days, min_duration_days FROM locations WHERE shop_id = ? AND code = ? AND active = 1',
                first: {
                    lead_time_days: leadTimeDays,
                    min_duration_days: minDurationDays,
                },
            },
            {
                match: 'SELECT timezone FROM shops WHERE id = ?',
                first: {
                    timezone: 'America/Mazatlan',
                },
            },
            {
                match: 'SELECT product_id, variant_id, qty FROM booking_items WHERE booking_id = ?',
                all: {
                    results: [{ product_id: 101, variant_id: 202, qty: bookingQty }],
                },
            },
            {
                match: 'SELECT product_id, deposit_variant_id, deposit_multiplier',
                all: {
                    results: [{
                        product_id: 101,
                        deposit_variant_id: options.depositVariantId ?? null,
                        deposit_multiplier: 1,
                    }],
                },
            },
            {
                match: 'SELECT COUNT(*) as count FROM booking_days WHERE booking_id = ?',
                first: { count: 2 },
            },
            {
                match: "SET status = 'CONFIRMED'",
                run: { meta: { changes: 1 } },
            },
            {
                match: "SET status = 'INVALID'",
                run: { meta: { changes: 1 } },
            },
            {
                match: 'SELECT shop_domain, access_token FROM shops WHERE id = ?',
                first: { shop_domain: 'demo.myshopify.com', access_token: 'offline-token' },
            },
        ],
    });
}

test('confirmBookingsFromOrder confirms HOLD booking on happy path', async () => {
    const controller = createController({});
    const env = createEnv(controller.db);

    const result = await confirmBookingsFromOrder(
        env,
        'demo.myshopify.com',
        'evt-1',
        'orders/create',
        buildOrderPayload({})
    );

    assert.equal(result.status, 200);
    assert.match(result.body, /Confirmed: 1/);
    assert.match(result.body, /Invalid: 0/);
});

test('confirmBookingsFromOrder invalidates when booking status is expired', async () => {
    const controller = createController({ bookingStatus: 'EXPIRED' });
    const env = createEnv(controller.db);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 200 });

    try {
        const result = await confirmBookingsFromOrder(
            env,
            'demo.myshopify.com',
            'evt-2',
            'orders/create',
            buildOrderPayload({})
        );

        assert.equal(result.status, 200);
        assert.match(result.body, /Invalid: 1/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('confirmBookingsFromOrder invalidates on quantity mismatch', async () => {
    const controller = createController({ bookingQty: 2, orderQty: 1 });
    const env = createEnv(controller.db);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 200 });

    try {
        const result = await confirmBookingsFromOrder(
            env,
            'demo.myshopify.com',
            'evt-3',
            'orders/create',
            buildOrderPayload({ orderQty: 1 })
        );
        assert.equal(result.status, 200);
        assert.match(result.body, /Invalid: 1/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('confirmBookingsFromOrder invalidates when required deposit line is missing', async () => {
    const controller = createController({ depositVariantId: 909, includeDepositLine: false });
    const env = createEnv(controller.db);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 200 });

    try {
        const result = await confirmBookingsFromOrder(
            env,
            'demo.myshopify.com',
            'evt-4',
            'orders/create',
            buildOrderPayload({ depositVariantId: 909 })
        );
        assert.equal(result.status, 200);
        assert.match(result.body, /Invalid: 1/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('confirmBookingsFromOrder invalidates when dates are tampered', async () => {
    const controller = createController({ bookingStart: '2099-01-10', orderStart: '2099-01-11' });
    const env = createEnv(controller.db);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 200 });

    try {
        const result = await confirmBookingsFromOrder(
            env,
            'demo.myshopify.com',
            'evt-5',
            'orders/create',
            buildOrderPayload({ orderStart: '2099-01-11' })
        );
        assert.equal(result.status, 200);
        assert.match(result.body, /Invalid: 1/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('confirmBookingsFromOrder invalidates when booking status is already released', async () => {
    const controller = createController({ bookingStatus: 'RELEASED' });
    const env = createEnv(controller.db);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 200 });

    try {
        const result = await confirmBookingsFromOrder(
            env,
            'demo.myshopify.com',
            'evt-6',
            'orders/create',
            buildOrderPayload({})
        );
        assert.equal(result.status, 200);
        assert.match(result.body, /Invalid: 1/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('confirmBookingsFromOrder enforces lead-time rules at confirmation', async () => {
    const controller = createController({ leadTimeDays: 100000 });
    const env = createEnv(controller.db);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 200 });

    try {
        const result = await confirmBookingsFromOrder(
            env,
            'demo.myshopify.com',
            'evt-7',
            'orders/create',
            buildOrderPayload({})
        );
        assert.equal(result.status, 200);
        assert.match(result.body, /Invalid: 1/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('confirmBookingsFromOrder enforces minimum-duration rules at confirmation', async () => {
    const controller = createController({ minDurationDays: 5 });
    const env = createEnv(controller.db);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 200 });

    try {
        const result = await confirmBookingsFromOrder(
            env,
            'demo.myshopify.com',
            'evt-8',
            'orders/create',
            buildOrderPayload({})
        );
        assert.equal(result.status, 200);
        assert.match(result.body, /Invalid: 1/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
