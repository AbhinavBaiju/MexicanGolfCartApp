import assert from 'node:assert/strict';
import test from 'node:test';

import { cancelBooking, releaseBooking } from '../src/bookingService';
import { handleScheduled } from '../src/scheduled';
import type { Env } from '../src/types';
import { createMockDbController, type InspectablePreparedStatement } from './helpers/mockD1';

function createEnv(db: D1Database): Env {
    return {
        DB: db,
        ENVIRONMENT: 'test',
        SHOPIFY_API_KEY: 'test-api-key',
        SHOPIFY_API_SECRET: 'test-api-secret',
        SHOPIFY_APP_URL: 'https://worker.example',
    };
}

test('releaseBooking decrements inventory reservations for HOLD bookings', async () => {
    let batchedStatements: InspectablePreparedStatement[] = [];
    const controller = createMockDbController({
        rules: [
            {
                match: 'SELECT shop_id, status FROM bookings WHERE id = ?',
                first: { shop_id: 1, status: 'HOLD' },
            },
            {
                match: 'SELECT product_id, date, qty FROM booking_days WHERE booking_id = ?',
                all: { results: [{ product_id: 101, date: '2099-01-10', qty: 2 }] },
            },
        ],
        onBatch: async (statements) => {
            batchedStatements = statements as InspectablePreparedStatement[];
            return [];
        },
    });

    await releaseBooking(controller.db, 'booking-1', 'EXPIRED');
    assert.ok(
        batchedStatements.some((statement) => statement.__sql.includes("SET status = ?")),
        'Expected guarded status transition in release batch'
    );
    assert.ok(
        batchedStatements.some((statement) => statement.__sql.includes('SET reserved_qty = reserved_qty - ?')),
        'Expected inventory decrement in release batch'
    );
});

test('cancelBooking transitions HOLD/CONFIRMED to CANCELLED and releases inventory', async () => {
    let batchedStatements: InspectablePreparedStatement[] = [];
    const controller = createMockDbController({
        rules: [
            {
                match: 'SELECT shop_id, status FROM bookings WHERE id = ?',
                first: { shop_id: 1, status: 'CONFIRMED' },
            },
            {
                match: 'SELECT product_id, date, qty FROM booking_days WHERE booking_id = ?',
                all: { results: [{ product_id: 101, date: '2099-01-10', qty: 1 }] },
            },
        ],
        onBatch: async (statements) => {
            batchedStatements = statements as InspectablePreparedStatement[];
            return [];
        },
    });

    const result = await cancelBooking(controller.db, 'booking-2');
    assert.equal(result.ok, true);
    assert.equal(result.previousStatus, 'CONFIRMED');
    assert.ok(
        batchedStatements.some((statement) => statement.__sql.includes("SET status = 'CANCELLED'")),
        'Expected CANCELLED transition in cancellation batch'
    );
});

test('handleScheduled expires HOLD bookings via releaseBooking flow', async () => {
    let batchCalls = 0;
    const controller = createMockDbController({
        rules: [
            {
                match: "SELECT id FROM bookings WHERE status = 'HOLD'",
                all: { results: [{ id: 'booking-3' }] },
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
        onBatch: async () => {
            batchCalls += 1;
            return [];
        },
    });

    const env = createEnv(controller.db);
    await handleScheduled({ cron: '*/5 * * * *' } as ScheduledEvent, env);

    assert.equal(batchCalls, 1);
});
