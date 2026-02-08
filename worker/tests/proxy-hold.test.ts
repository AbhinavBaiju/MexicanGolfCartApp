import assert from 'node:assert/strict';
import test from 'node:test';

import { handleProxyRequest } from '../src/proxy';
import type { Env } from '../src/types';
import { createMockDbController, type InspectablePreparedStatement } from './helpers/mockD1';

function createEnv(db: D1Database): Env {
    return {
        DB: db,
        ENVIRONMENT: 'dev',
        SHOPIFY_API_KEY: 'test-api-key',
        SHOPIFY_API_SECRET: 'test-api-secret',
        SHOPIFY_APP_URL: 'https://worker.example',
    };
}

test('POST /proxy/hold rejects total quantity above configured limit', async () => {
    const controller = createMockDbController({
        rules: [],
    });
    const env = createEnv(controller.db);
    const request = new Request('https://worker.example/proxy/hold?shop=demo.myshopify.com', {
        method: 'POST',
        body: JSON.stringify({
            start_date: '2099-02-01',
            end_date: '2099-02-03',
            location: 'PLAYA',
            items: [{ product_id: 101, variant_id: 202, qty: 11 }],
        }),
    });

    const response = await handleProxyRequest(request, env);
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, 'Total quantity exceeds 10');
});

test('POST /proxy/hold rejects date ranges above configured max days', async () => {
    const controller = createMockDbController({
        rules: [],
    });
    const env = createEnv(controller.db);
    const request = new Request('https://worker.example/proxy/hold?shop=demo.myshopify.com', {
        method: 'POST',
        body: JSON.stringify({
            start_date: '2099-01-01',
            end_date: '2099-05-15',
            location: 'PLAYA',
            items: [{ product_id: 101, variant_id: 202, qty: 1 }],
        }),
    });

    const response = await handleProxyRequest(request, env);
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, 'Booking range exceeds 90 days');
});

test('POST /proxy/hold happy path creates reservation batch', async () => {
    let batchStatements: InspectablePreparedStatement[] = [];
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
        onBatch: async (statements) => {
            batchStatements = statements as InspectablePreparedStatement[];
            return [];
        },
    });
    const env = createEnv(controller.db);
    const request = new Request('https://worker.example/proxy/hold?shop=demo.myshopify.com', {
        method: 'POST',
        body: JSON.stringify({
            start_date: '2099-01-10',
            end_date: '2099-01-11',
            location: 'PLAYA',
            items: [{ product_id: 101, variant_id: 202, qty: 1 }],
        }),
    });

    const response = await handleProxyRequest(request, env);
    assert.equal(response.status, 200);

    const body = (await response.json()) as { ok?: boolean; booking_token?: string; expires_at?: string };
    assert.equal(body.ok, true);
    assert.equal(typeof body.booking_token, 'string');
    assert.equal(typeof body.expires_at, 'string');

    assert.ok(batchStatements.length > 0, 'Expected transactional statements for hold reservation');
    assert.ok(
        batchStatements.some((statement) => statement.__sql.includes('INSERT INTO bookings')),
        'Expected INSERT INTO bookings in reservation batch'
    );
    assert.ok(
        batchStatements.some((statement) => statement.__sql.includes('UPDATE inventory_day')),
        'Expected inventory reservation update in reservation batch'
    );
});
