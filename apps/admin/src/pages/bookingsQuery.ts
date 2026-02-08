export function getTabStatus(selectedTab: number): string | null {
    if (selectedTab === 0) {
        return 'CONFIRMED';
    }
    if (selectedTab === 1) {
        return 'CANCELLED';
    }
    if (selectedTab === 2) {
        return 'HOLD';
    }
    if (selectedTab === 3) {
        return 'EXPIRED';
    }
    return null;
}

export interface BookingsQueryParamsInput {
    selectedTab: number;
    selectedStatus: string;
    upcomingOnly: boolean;
    selectedService: string;
    selectedType: string;
    sortDirection: 'asc' | 'desc';
    search: string;
    limit?: number;
    offset?: number;
}

export function buildBookingsQueryParams(input: BookingsQueryParamsInput): URLSearchParams {
    const params = new URLSearchParams();
    const isCalendarView = input.selectedTab === 4;

    if (!isCalendarView) {
        const tabStatus = getTabStatus(input.selectedTab);
        if (tabStatus) {
            params.set('status', tabStatus);
        }

        if (input.selectedStatus !== 'all') {
            params.set('status', input.selectedStatus);
        }

        if (input.upcomingOnly) {
            params.set('date_preset', 'upcoming');
        }

        if (input.selectedService !== 'all') {
            params.set('product_id', input.selectedService);
        }

        if (input.selectedType !== 'all') {
            params.set('fulfillment_type', input.selectedType);
        }

        const trimmedSearch = input.search.trim();
        if (trimmedSearch.length > 0) {
            params.set('search', trimmedSearch);
        }
    }

    params.set('sort_direction', input.sortDirection);
    if (typeof input.limit === 'number' && Number.isInteger(input.limit) && input.limit > 0) {
        params.set('limit', String(input.limit));
    }
    if (typeof input.offset === 'number' && Number.isInteger(input.offset) && input.offset >= 0) {
        params.set('offset', String(input.offset));
    }
    return params;
}
