import { describe, expect, it } from 'vitest';

import { buildBookingRanges, countBookingsForDate, countBookingsForMonth } from '../bookingsCalendarUtils';
import type { Booking } from '../BookingCard';

function createBooking(startDate: string, endDate: string): Booking {
    return {
        booking_token: `${startDate}-${endDate}`,
        status: 'CONFIRMED',
        location_code: 'PLAYA',
        start_date: startDate,
        end_date: endDate,
        order_id: 123,
        invalid_reason: null,
        created_at: '2026-02-01T00:00:00Z',
    };
}

function createCancelledBooking(startDate: string, endDate: string): Booking {
    return {
        booking_token: `cancelled-${startDate}-${endDate}`,
        status: 'CANCELLED',
        location_code: 'PLAYA',
        start_date: startDate,
        end_date: endDate,
        order_id: 456,
        invalid_reason: null,
        created_at: '2026-02-01T00:00:00Z',
    };
}

describe('BookingsCalendar range logic', () => {
    it('counts bookings across all days in an inclusive range', () => {
        const ranges = buildBookingRanges([
            createBooking('2026-02-05', '2026-02-07'),
        ]);

        expect(countBookingsForDate(ranges, '2026-02-04')).toBe(0);
        expect(countBookingsForDate(ranges, '2026-02-05')).toBe(1);
        expect(countBookingsForDate(ranges, '2026-02-06')).toBe(1);
        expect(countBookingsForDate(ranges, '2026-02-07')).toBe(1);
        expect(countBookingsForDate(ranges, '2026-02-08')).toBe(0);
    });

    it('counts month overlaps rather than start-date-only matches', () => {
        const ranges = buildBookingRanges([
            createBooking('2026-01-31', '2026-02-02'),
            createBooking('2026-02-15', '2026-02-16'),
        ]);

        // 2026-02 in zero-based month index.
        expect(countBookingsForMonth(ranges, 2026, 1)).toBe(2);
        // 2026-03 should have no overlaps.
        expect(countBookingsForMonth(ranges, 2026, 2)).toBe(0);
    });

    it('ignores non-active booking statuses in calendar counts', () => {
        const ranges = buildBookingRanges([
            createBooking('2026-02-10', '2026-02-10'),
            createCancelledBooking('2026-02-10', '2026-02-10'),
        ]);
        expect(countBookingsForDate(ranges, '2026-02-10')).toBe(1);
    });
});
