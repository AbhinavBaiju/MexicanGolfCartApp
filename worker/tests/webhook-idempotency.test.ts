import assert from 'node:assert/strict';
import test from 'node:test';

import { confirmBookingsFromOrder } from '../src/bookingService';
import type { Env } from '../src/types';
import { createMockDbController } from './helpers/mockD1';

function createEnv(db: D1Database): Env {
    return {
        DB: db,
        ENVIRONMENT: 'test',
        SHOPIFY_API_KEY: 'test-api-key',
        SHOPIFY_API_SECRET: 'test-api-secret',
        SHOPIFY_APP_URL: 'https://worker.example',
    };
}

test('confirmBookingsFromOrder is idempotent for duplicate webhook event ids', async () => {
    const controller = createMockDbController({
        rules: [
            {
                match: 'SELECT id FROM shops WHERE shop_domain = ?',
                first: { id: 99 },
            },
            {
                match: 'SELECT event_id FROM webhook_events WHERE shop_id = ? AND event_id = ?',
                first: { event_id: 'evt-duplicate' },
            },
            {
                match: 'INSERT INTO webhook_events',
                run: { meta: { changes: 1 } },
            },
        ],
    });
    const env = createEnv(controller.db);

    const result = await confirmBookingsFromOrder(
        env,
        'demo.myshopify.com',
        'evt-duplicate',
        'orders/create',
        '{"id":12345}'
    );

    assert.equal(result.status, 200);
    assert.equal(result.body, 'Duplicate webhook event');
    assert.equal(
        controller.calls.some((call) => call.sql.includes('INSERT INTO webhook_events')),
        false,
        'Duplicate event should not attempt another insert'
    );
});
