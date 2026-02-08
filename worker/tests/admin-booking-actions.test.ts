import assert from 'node:assert/strict';
import test from 'node:test';

import { __testHandleBookingCancel, __testHandleBookingComplete } from '../src/admin';
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

const auth = {
    shopId: 1,
    shopDomain: 'demo.myshopify.com',
    shopTimezone: 'America/Mazatlan',
};

test('handleBookingComplete rejects invalid source status', async () => {
    const controller = createMockDbController({
        rules: [
            {
                match: 'SELECT id, order_id, status FROM bookings WHERE shop_id = ? AND booking_token = ?',
                first: { id: 'booking-1', order_id: null, status: 'RELEASED' },
            },
        ],
    });
    const env = createEnv(controller.db);

    const response = await __testHandleBookingComplete(env, auth, 'token-1');
    assert.equal(response.status, 409);
});

test('handleBookingComplete allows HOLD/CONFIRMED and applies guarded update', async () => {
    const controller = createMockDbController({
        rules: [
            {
                match: 'SELECT id, order_id, status FROM bookings WHERE shop_id = ? AND booking_token = ?',
                first: { id: 'booking-2', order_id: null, status: 'CONFIRMED' },
            },
            {
                match: "SET status = 'RELEASED'",
                run: { meta: { changes: 1 } },
            },
        ],
    });
    const env = createEnv(controller.db);

    const response = await __testHandleBookingComplete(env, auth, 'token-2');
    assert.equal(response.status, 200);
});

test('handleBookingCancel rejects non-cancellable statuses', async () => {
    const controller = createMockDbController({
        rules: [
            {
                match: 'SELECT id, status FROM bookings WHERE shop_id = ? AND booking_token = ?',
                first: { id: 'booking-3', status: 'RELEASED' },
            },
            {
                match: 'SELECT shop_id, status FROM bookings WHERE id = ?',
                first: { shop_id: 1, status: 'RELEASED' },
            },
        ],
    });
    const env = createEnv(controller.db);

    const response = await __testHandleBookingCancel(env, auth, 'token-3');
    assert.equal(response.status, 409);
});

test('handleBookingCancel allows HOLD/CONFIRMED and returns CANCELLED', async () => {
    const controller = createMockDbController({
        rules: [
            {
                match: 'SELECT id, status FROM bookings WHERE shop_id = ? AND booking_token = ?',
                first: { id: 'booking-4', status: 'HOLD' },
            },
            {
                match: 'SELECT shop_id, status FROM bookings WHERE id = ?',
                first: { shop_id: 1, status: 'HOLD' },
            },
            {
                match: 'SELECT product_id, date, qty FROM booking_days WHERE booking_id = ?',
                all: { results: [{ product_id: 101, date: '2099-01-10', qty: 1 }] },
            },
        ],
        onBatch: async () => [],
    });
    const env = createEnv(controller.db);

    const response = await __testHandleBookingCancel(env, auth, 'token-4');
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status?: string };
    assert.equal(body.status, 'CANCELLED');
});
