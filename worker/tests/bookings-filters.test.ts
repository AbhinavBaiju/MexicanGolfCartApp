import assert from 'node:assert/strict';
import test from 'node:test';

import { __resetAdminSchemaCache, __testHandleBookingsGet } from '../src/admin';
import { getTodayInTimeZone } from '../src/date';
import type { Env } from '../src/types';
import { createMockDbController } from './helpers/mockD1';

const BOOKING_COLUMNS = [
    'invalid_reason',
    'customer_name',
    'customer_email',
    'revenue',
    'fulfillment_type',
    'delivery_address',
];

function createEnv(db: D1Database): Env {
    return {
        DB: db,
        ENVIRONMENT: 'test',
        SHOPIFY_API_KEY: 'test-api-key',
        SHOPIFY_API_SECRET: 'test-api-secret',
        SHOPIFY_APP_URL: 'https://worker.example',
    };
}

function createController() {
    return createMockDbController({
        rules: [
            {
                match: 'PRAGMA table_info(bookings)',
                all: { results: BOOKING_COLUMNS.map((name) => ({ name })) },
            },
            {
                match: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
                first: { name: 'signed_agreements' },
            },
            {
                match: 'FROM bookings b',
                all: { results: [] },
            },
        ],
    });
}

test('GET /admin/bookings rejects invalid status filter values', async () => {
    __resetAdminSchemaCache();
    const controller = createController();
    const env = createEnv(controller.db);
    const request = new Request('https://worker.example/admin/bookings?status=NOT_A_STATUS');

    const response = await __testHandleBookingsGet(request, env, {
        shopId: 1,
        shopDomain: 'demo.myshopify.com',
        shopTimezone: 'America/Mazatlan',
    });

    assert.equal(response.status, 400);
    const body = (await response.json()) as { ok: boolean; error?: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, 'Invalid status filter');
});

test('GET /admin/bookings accepts WAITLIST filter and binds it in SQL query', async () => {
    __resetAdminSchemaCache();
    const controller = createController();
    const env = createEnv(controller.db);
    const request = new Request('https://worker.example/admin/bookings?status=WAITLIST&sort_direction=desc');

    const response = await __testHandleBookingsGet(request, env, {
        shopId: 42,
        shopDomain: 'demo.myshopify.com',
        shopTimezone: 'America/Mazatlan',
    });

    assert.equal(response.status, 200);

    const queryCall = controller.calls.find(
        (call) => call.method === 'all' && call.sql.includes('FROM bookings b')
    );
    assert.ok(queryCall, 'Expected bookings query to be executed');
    assert.ok(queryCall.bindings.includes('WAITLIST'), 'WAITLIST should be included in SQL bindings');
});

test('GET /admin/bookings date_preset=upcoming uses shop-specific timezone date', async () => {
    __resetAdminSchemaCache();
    const controller = createController();
    const env = createEnv(controller.db);
    const timezone = 'Pacific/Kiritimati';
    const expectedToday = getTodayInTimeZone(timezone);
    const request = new Request(
        'https://worker.example/admin/bookings?date_preset=upcoming&sort_direction=asc'
    );

    const response = await __testHandleBookingsGet(request, env, {
        shopId: 77,
        shopDomain: 'demo.myshopify.com',
        shopTimezone: timezone,
    });

    assert.equal(response.status, 200);

    const queryCall = controller.calls.find(
        (call) => call.method === 'all' && call.sql.includes('FROM bookings b')
    );
    assert.ok(queryCall, 'Expected bookings query to be executed');
    assert.ok(
        queryCall.bindings.includes(expectedToday),
        `Expected date_preset binding to include ${expectedToday}`
    );
    assert.match(queryCall.sql, /ORDER BY b\.start_date ASC/);
});
