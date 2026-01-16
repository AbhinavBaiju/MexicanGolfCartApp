import assert from 'node:assert/strict';
import test from 'node:test';

import { STORE_TIMEZONE } from '../src/config';
import { getTodayInTimeZone } from '../src/date';

test('STORE_TIMEZONE is fixed to America/Mazatlan', () => {
    assert.equal(STORE_TIMEZONE, 'America/Mazatlan');
});

test('getTodayInTimeZone respects store timezone date boundary', () => {
    const now = new Date('2024-01-01T06:00:00.000Z');
    assert.equal(getTodayInTimeZone(STORE_TIMEZONE, now), '2023-12-31');
});

test('getTodayInTimeZone formats dates as YYYY-MM-DD', () => {
    const now = new Date('2024-01-15T12:00:00.000Z');
    assert.equal(getTodayInTimeZone(STORE_TIMEZONE, now), '2024-01-15');
});
