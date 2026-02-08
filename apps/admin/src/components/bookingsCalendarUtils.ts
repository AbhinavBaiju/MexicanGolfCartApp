import type { Booking } from './BookingCard';
import { toDateIndex, toLocalYyyyMmDd } from '../utils/date';

export interface BookingRange {
    start: number;
    end: number;
}

export function buildBookingRanges(bookings: Booking[]): BookingRange[] {
    const ranges: BookingRange[] = [];
    for (const booking of bookings) {
        const start = toDateIndex(booking.start_date);
        const end = toDateIndex(booking.end_date);
        if (start === null || end === null || start > end) {
            continue;
        }
        ranges.push({ start, end });
    }
    return ranges;
}

export function countBookingsForDate(ranges: BookingRange[], dateKey: string): number {
    const dayIndex = toDateIndex(dateKey);
    if (dayIndex === null) {
        return 0;
    }

    return ranges.filter((range) => range.start <= dayIndex && range.end >= dayIndex).length;
}

export function countBookingsForMonth(ranges: BookingRange[], year: number, month: number): number {
    const monthStartIndex = toDateIndex(toLocalYyyyMmDd(new Date(year, month, 1)));
    const monthEndIndex = toDateIndex(toLocalYyyyMmDd(new Date(year, month + 1, 0)));
    if (monthStartIndex === null || monthEndIndex === null) {
        return 0;
    }

    return ranges.filter((range) => range.start <= monthEndIndex && range.end >= monthStartIndex).length;
}
