import { describe, expect, it } from 'vitest';

import { buildDashboardBookingsQueryParams, buildDashboardServiceOptions } from '../dashboardQuery';

describe('Dashboard query params', () => {
    it('builds bookings query with active filters', () => {
        const params = buildDashboardBookingsQueryParams({
            sortDirection: 'asc',
            upcomingOnly: true,
            selectedService: '101',
            selectedLocation: 'PLAYA',
            selectedType: 'Delivery',
            selectedStatus: 'CONFIRMED',
            selectedUpsell: 'with_upsell',
            search: '  token-123  ',
        });

        expect(params.get('sort_direction')).toBe('asc');
        expect(params.get('date_preset')).toBe('upcoming');
        expect(params.get('product_id')).toBe('101');
        expect(params.get('location_code')).toBe('PLAYA');
        expect(params.get('fulfillment_type')).toBe('Delivery');
        expect(params.get('status')).toBe('CONFIRMED');
        expect(params.get('upsell')).toBe('with_upsell');
        expect(params.get('search')).toBe('token-123');
    });

    it('omits optional filters when set to all', () => {
        const params = buildDashboardBookingsQueryParams({
            sortDirection: 'desc',
            upcomingOnly: false,
            selectedService: 'all',
            selectedLocation: 'all',
            selectedType: 'all',
            selectedStatus: 'all',
            selectedUpsell: 'all',
            search: '   ',
        });

        expect(params.get('sort_direction')).toBe('desc');
        expect(params.get('date_preset')).toBeNull();
        expect(params.get('product_id')).toBeNull();
        expect(params.get('location_code')).toBeNull();
        expect(params.get('fulfillment_type')).toBeNull();
        expect(params.get('status')).toBeNull();
        expect(params.get('upsell')).toBeNull();
        expect(params.get('search')).toBeNull();
    });
});

describe('Dashboard service options', () => {
    it('prefers Shopify product titles and falls back to Service <id>', () => {
        const options = buildDashboardServiceOptions(
            [{ product_id: 303 }, { product_id: 101 }, { product_id: 202 }],
            [{ id: 101, title: 'Four Seater' }, { id: 303, title: '' }]
        );

        expect(options[0]).toEqual({ label: 'All services', value: 'all' });
        expect(options).toContainEqual({ label: 'Four Seater', value: '101' });
        expect(options).toContainEqual({ label: 'Service 202', value: '202' });
        expect(options).toContainEqual({ label: 'Service 303', value: '303' });
    });
});
