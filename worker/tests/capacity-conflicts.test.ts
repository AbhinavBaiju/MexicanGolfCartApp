import assert from 'node:assert/strict';
import test from 'node:test';

import { __resetAdminSchemaCache, __testHandleBookingsPost } from '../src/admin';
import { handleProxyRequest } from '../src/proxy';
import type { Env } from '../src/types';
import { createMockDbController } from './helpers/mockD1';

function createEnv(db: D1Database, environment = 'test'): Env {
    return {
        DB: db,
        ENVIRONMENT: environment,
        SHOPIFY_API_KEY: 'test-api-key',
        SHOPIFY_API_SECRET: 'test-api-secret',
        SHOPIFY_APP_URL: 'https://worker.example',
    };
}

test('POST /proxy/hold returns 409 when atomic inventory reservation fails', async () => {
    const controller = createMockDbController({
        rules: [
            {
                match: 'SELECT id, timezone FROM shops WHERE shop_domain = ?',
                first: { id: 1, timezone: 'America/Mazatlan' },
            },
            {
                match: 'SELECT code, lead_time_days, min_duration_days FROM locations',
                first: { code: 'PLAYA', lead_time_days: 0, min_duration_days: 1 },
            },
            {
                match: 'SELECT product_id, variant_id, rentable, default_capacity FROM products',
                all: {
                    results: [{ product_id: 101, variant_id: 202, rentable: 1, default_capacity: 5 }],
                },
            },
        ],
        onBatch: async () => {
            throw new Error('division by zero');
        },
    });
    const env = createEnv(controller.db, 'dev');
    const request = new Request('https://worker.example/proxy/hold?shop=demo.myshopify.com', {
        method: 'POST',
        body: JSON.stringify({
            start_date: '2099-01-10',
            end_date: '2099-01-12',
            location: 'PLAYA',
            items: [{ product_id: 101, variant_id: 202, qty: 1 }],
        }),
    });

    const response = await handleProxyRequest(request, env);
    assert.equal(response.status, 409);

    const body = (await response.json()) as { ok: boolean; error?: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, 'Insufficient capacity');
});

test('POST /admin/bookings returns 409 when atomic inventory reservation fails', async () => {
    __resetAdminSchemaCache();

    const controller = createMockDbController({
        rules: [
            {
                match: 'SELECT code, lead_time_days, min_duration_days FROM locations',
                first: { code: 'PLAYA', lead_time_days: 0, min_duration_days: 1 },
            },
            {
                match: 'SELECT product_id, variant_id, rentable, default_capacity',
                all: {
                    results: [{ product_id: 101, variant_id: 202, rentable: 1, default_capacity: 5 }],
                },
            },
            {
                match: 'PRAGMA table_info(bookings)',
                all: {
                    results: [
                        { name: 'invalid_reason' },
                        { name: 'customer_name' },
                        { name: 'customer_email' },
                        { name: 'revenue' },
                        { name: 'fulfillment_type' },
                        { name: 'delivery_address' },
                    ],
                },
            },
            {
                match: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
                first: null,
            },
        ],
        onBatch: async () => {
            throw new Error('division by zero');
        },
    });
    const env = createEnv(controller.db);
    const request = new Request('https://worker.example/admin/bookings', {
        method: 'POST',
        body: JSON.stringify({
            start_date: '2099-01-10',
            end_date: '2099-01-12',
            location: 'PLAYA',
            fulfillment_type: 'Pick Up',
            items: [{ product_id: 101, variant_id: 202, qty: 1 }],
        }),
    });

    const response = await __testHandleBookingsPost(request, env, {
        shopId: 1,
        shopDomain: 'demo.myshopify.com',
        shopTimezone: 'America/Mazatlan',
    });
    assert.equal(response.status, 409);

    const body = (await response.json()) as { ok: boolean; error?: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, 'Insufficient capacity');
});
