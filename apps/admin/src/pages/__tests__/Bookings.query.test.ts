import { describe, expect, it } from 'vitest';

import { buildBookingsQueryParams, getTabStatus } from '../bookingsQuery';

describe('Bookings query params', () => {
    it('maps tab indices to expected default statuses', () => {
        expect(getTabStatus(0)).toBe('CONFIRMED');
        expect(getTabStatus(1)).toBe('CANCELLED');
        expect(getTabStatus(2)).toBe('HOLD');
        expect(getTabStatus(3)).toBe('EXPIRED');
        expect(getTabStatus(4)).toBeNull();
    });

    it('builds list-view params with selected filters and trimmed search', () => {
        const params = buildBookingsQueryParams({
            selectedTab: 0,
            selectedStatus: 'HOLD',
            upcomingOnly: true,
            selectedService: '123',
            selectedType: 'Delivery',
            sortDirection: 'asc',
            search: '  alice@example.com  ',
            limit: 25,
            offset: 50,
        });

        expect(params.get('status')).toBe('HOLD');
        expect(params.get('date_preset')).toBe('upcoming');
        expect(params.get('product_id')).toBe('123');
        expect(params.get('fulfillment_type')).toBe('Delivery');
        expect(params.get('sort_direction')).toBe('asc');
        expect(params.get('search')).toBe('alice@example.com');
        expect(params.get('limit')).toBe('25');
        expect(params.get('offset')).toBe('50');
    });

    it('keeps calendar view query minimal to prevent list-only filters leaking', () => {
        const params = buildBookingsQueryParams({
            selectedTab: 4,
            selectedStatus: 'CONFIRMED',
            upcomingOnly: true,
            selectedService: '123',
            selectedType: 'Pick Up',
            sortDirection: 'desc',
            search: 'token-1',
        });

        expect(params.get('sort_direction')).toBe('desc');
        expect(params.get('status')).toBeNull();
        expect(params.get('date_preset')).toBeNull();
        expect(params.get('product_id')).toBeNull();
        expect(params.get('fulfillment_type')).toBeNull();
        expect(params.get('search')).toBeNull();
    });
});
