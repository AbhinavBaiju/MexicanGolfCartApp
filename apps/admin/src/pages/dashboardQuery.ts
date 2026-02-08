interface DashboardProductConfig {
    product_id: string | number;
}

interface DashboardShopifyProduct {
    id: string | number;
    title?: string | null;
}

interface FilterOption {
    label: string;
    value: string;
}

export interface DashboardBookingsQueryParamsInput {
    sortDirection: 'asc' | 'desc';
    upcomingOnly: boolean;
    selectedService: string;
    selectedLocation: string;
    selectedType: string;
    selectedStatus: string;
    selectedUpsell: string;
    search: string;
}

function toNumber(value: string | number | null | undefined): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return 0;
}

export function buildDashboardBookingsQueryParams(input: DashboardBookingsQueryParamsInput): URLSearchParams {
    const params = new URLSearchParams();
    params.set('sort_direction', input.sortDirection);

    if (input.upcomingOnly) {
        params.set('date_preset', 'upcoming');
    }
    if (input.selectedService !== 'all') {
        params.set('product_id', input.selectedService);
    }
    if (input.selectedLocation !== 'all') {
        params.set('location_code', input.selectedLocation);
    }
    if (input.selectedType !== 'all') {
        params.set('fulfillment_type', input.selectedType);
    }
    if (input.selectedStatus !== 'all') {
        params.set('status', input.selectedStatus);
    }
    if (input.selectedUpsell !== 'all') {
        params.set('upsell', input.selectedUpsell);
    }

    const trimmedSearch = input.search.trim();
    if (trimmedSearch.length > 0) {
        params.set('search', trimmedSearch);
    }

    return params;
}

export function buildDashboardServiceOptions(
    products: DashboardProductConfig[] | undefined,
    shopifyProducts: DashboardShopifyProduct[] | undefined
): FilterOption[] {
    const serviceIds = (products || [])
        .map((entry) => toNumber(entry.product_id))
        .filter((id) => Number.isInteger(id) && id > 0)
        .sort((a, b) => a - b);

    const shopifyTitleById = new Map<number, string>();
    for (const product of shopifyProducts || []) {
        const productId = toNumber(product.id);
        if (!Number.isInteger(productId) || productId <= 0) {
            continue;
        }
        const title = product.title?.trim();
        if (title) {
            shopifyTitleById.set(productId, title);
        }
    }

    const nextServiceOptions = serviceIds
        .map((id) => ({
            label: shopifyTitleById.get(id) ?? `Service ${id}`,
            value: String(id),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

    return [{ label: 'All services', value: 'all' }, ...nextServiceOptions];
}
