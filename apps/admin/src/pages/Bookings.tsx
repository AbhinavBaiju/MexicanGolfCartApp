import {
    ActionList,
    Badge,
    Box,
    Button,
    FormLayout,
    InlineError,
    InlineStack,
    Layout,
    Modal,
    Page,
    Popover,
    Select,
    Spinner,
    Tabs,
    Text,
    TextField,
} from '@shopify/polaris';
import { useAuthenticatedFetch } from '../api';
import { useEffect, useState, useCallback } from 'react';
import { BookingCard, type Booking } from '../components/BookingCard';
import { BookingsCalendar } from '../components/BookingsCalendar';
import { SearchIcon, ExportIcon, ArrowUpIcon, PlusIcon } from '@shopify/polaris-icons';
import { showShopifyToast } from '../utils/shopifyToast';
import { buildBookingsQueryParams } from './bookingsQuery';

interface FilterOption {
    label: string;
    value: string;
}

interface FilterPopoverProps {
    options: FilterOption[];
    selectedValue: string;
    onSelect: (value: string) => void;
}

interface BookingsResponse {
    bookings?: Booking[];
}

interface ProductConfigResponse {
    products?: Array<{
        product_id: string | number;
        variant_id?: string | number | null;
        rentable?: boolean | number;
    }>;
}

interface LocationsResponse {
    locations?: Array<{
        code: string;
        name: string;
        active?: boolean | number;
    }>;
}

interface ShopifyProductsResponse {
    products?: Array<{
        id: string | number;
        title: string;
        variants?: Array<{
            id: string | number;
            title: string;
        }>;
    }>;
}

interface ManualBookingCreateResponse {
    ok?: boolean;
    booking_token?: string;
    error?: string;
}

interface BookingCompleteResponse {
    ok?: boolean;
    error?: string;
    fulfillment?: {
        success?: boolean;
        message?: string;
    };
}

interface ManualProductCatalog {
    product_id: number;
    title: string;
    configured_variant_id: number | null;
    variants: Array<{
        id: number;
        title: string;
    }>;
}

interface ManualBookingFormState {
    customerName: string;
    customerEmail: string;
    locationCode: string;
    startDate: string;
    endDate: string;
    productId: string;
    variantId: string;
    quantity: string;
    fulfillmentType: 'Pick Up' | 'Delivery';
    deliveryAddress: string;
}

const DEFAULT_MANUAL_FORM: ManualBookingFormState = {
    customerName: '',
    customerEmail: '',
    locationCode: '',
    startDate: '',
    endDate: '',
    productId: '',
    variantId: '',
    quantity: '1',
    fulfillmentType: 'Pick Up',
    deliveryAddress: '',
};

const TYPE_OPTIONS: FilterOption[] = [
    { label: 'All types', value: 'all' },
    { label: 'Pick Up', value: 'Pick Up' },
    { label: 'Delivery', value: 'Delivery' },
];

const STATUS_OPTIONS: FilterOption[] = [
    { label: 'All statuses', value: 'all' },
    { label: 'Confirmed', value: 'CONFIRMED' },
    { label: 'Hold', value: 'HOLD' },
    { label: 'Cancelled', value: 'CANCELLED' },
    { label: 'Released', value: 'RELEASED' },
    { label: 'Expired', value: 'EXPIRED' },
    { label: 'Invalid', value: 'INVALID' },
];

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

function toBoolean(value: boolean | number | null | undefined, fallback = false): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    return fallback;
}

function parseServiceIds(value: string | null | undefined): string[] {
    if (!value) {
        return [];
    }

    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function hasUpsell(booking: Booking): boolean {
    if (typeof booking.has_upsell === 'boolean') {
        return booking.has_upsell;
    }

    if (typeof booking.has_upsell === 'number') {
        return booking.has_upsell > 0;
    }

    const serviceCount = toNumber(booking.service_count);
    if (serviceCount > 1) {
        return true;
    }

    return parseServiceIds(booking.service_product_ids).length > 1;
}

function escapeCsvValue(value: string | number | null | undefined): string {
    const raw = value === null || value === undefined ? '' : String(value);
    const escaped = raw.replace(/"/g, '""');
    return `"${escaped}"`;
}

function FilterPopover({ options, selectedValue, onSelect }: FilterPopoverProps) {
    const [active, setActive] = useState(false);
    const selected = options.find((option) => option.value === selectedValue);

    const items = options.map((option) => ({
        content: option.label,
        active: option.value === selectedValue,
        onAction: () => {
            onSelect(option.value);
            setActive(false);
        },
    }));

    return (
        <Popover
            active={active}
            activator={
                <Button disclosure onClick={() => setActive((prev) => !prev)}>
                    {selected?.label ?? options[0]?.label ?? 'Filter'}
                </Button>
            }
            onClose={() => setActive(false)}
            autofocusTarget="first-node"
        >
            <ActionList items={items} />
        </Popover>
    );
}

function getVariantChoicesForProduct(
    productCatalog: ManualProductCatalog[],
    productId: string
): Array<{ label: string; value: string }> {
    const selected = productCatalog.find((entry) => String(entry.product_id) === productId);
    if (!selected) {
        return [];
    }

    return selected.variants.map((variant) => ({
        label: variant.title,
        value: String(variant.id),
    }));
}

export default function Bookings() {
    const fetch = useAuthenticatedFetch();
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTab, setSelectedTab] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [upcomingOnly, setUpcomingOnly] = useState(false);
    const [selectedService, setSelectedService] = useState('all');
    const [selectedType, setSelectedType] = useState('all');
    const [selectedStatus, setSelectedStatus] = useState('all');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [serviceOptions, setServiceOptions] = useState<FilterOption[]>([{ label: 'All services', value: 'all' }]);
    const [manualBookingOpen, setManualBookingOpen] = useState(false);
    const [manualBookingLoadingOptions, setManualBookingLoadingOptions] = useState(false);
    const [manualBookingSubmitting, setManualBookingSubmitting] = useState(false);
    const [manualBookingError, setManualBookingError] = useState<string | null>(null);
    const [manualForm, setManualForm] = useState<ManualBookingFormState>(DEFAULT_MANUAL_FORM);
    const [manualProductCatalog, setManualProductCatalog] = useState<ManualProductCatalog[]>([]);
    const [manualLocationOptions, setManualLocationOptions] = useState<Array<{ label: string; value: string }>>([]);

    const tabs = [
        { id: 'bookings', content: 'Bookings', panelID: 'bookings-content' },
        { id: 'canceled', content: 'Canceled', panelID: 'canceled-content' },
        { id: 'pre-payment', content: 'Pre-payment', panelID: 'pre-payment-content' },
        { id: 'abandoned', content: 'Abandoned', panelID: 'abandoned-content' },
        { id: 'calendar', content: 'Bookings calendar', panelID: 'calendar-content' },
    ];

    const loadFilterOptions = useCallback(async () => {
        try {
            const [productsResponse, shopifyProductsResponse] = await Promise.all([
                fetch('/products'),
                fetch('/shopify-products'),
            ]);

            if (!productsResponse.ok) {
                return;
            }

            const productsData = (await productsResponse.json()) as ProductConfigResponse;
            const serviceIds = (productsData.products || [])
                .map((entry) => toNumber(entry.product_id))
                .filter((id) => Number.isInteger(id) && id > 0)
                .sort((a, b) => a - b);
            const shopifyTitleById = new Map<number, string>();

            if (shopifyProductsResponse.ok) {
                const shopifyProductsData = (await shopifyProductsResponse.json()) as ShopifyProductsResponse;
                for (const product of shopifyProductsData.products || []) {
                    const productId = toNumber(product.id);
                    if (!Number.isInteger(productId) || productId <= 0) {
                        continue;
                    }
                    const title = product.title?.trim();
                    if (title) {
                        shopifyTitleById.set(productId, title);
                    }
                }
            }

            const nextServiceOptions = serviceIds
                .map((id) => ({
                    label: shopifyTitleById.get(id) ?? `Service ${id}`,
                    value: String(id),
                }))
                .sort((a, b) => a.label.localeCompare(b.label));

            setServiceOptions([
                { label: 'All services', value: 'all' },
                ...nextServiceOptions,
            ]);
        } catch (loadError) {
            console.error('Failed to load booking filter options', loadError);
        }
    }, [fetch]);

    const loadManualBookingOptions = useCallback(async () => {
        setManualBookingLoadingOptions(true);
        setManualBookingError(null);

        try {
            const [productsResponse, locationsResponse, shopifyProductsResponse] = await Promise.all([
                fetch('/products'),
                fetch('/locations'),
                fetch('/shopify-products'),
            ]);

            if (!productsResponse.ok) {
                throw new Error('Failed to load products');
            }
            if (!locationsResponse.ok) {
                throw new Error('Failed to load locations');
            }
            if (!shopifyProductsResponse.ok) {
                throw new Error('Failed to load Shopify products');
            }

            const productsData = (await productsResponse.json()) as ProductConfigResponse;
            const locationsData = (await locationsResponse.json()) as LocationsResponse;
            const shopifyData = (await shopifyProductsResponse.json()) as ShopifyProductsResponse;

            const shopifyProductMap = new Map<number, { title: string; variants: Array<{ id: number; title: string }> }>();
            for (const product of shopifyData.products ?? []) {
                const productId = toNumber(product.id);
                if (!Number.isInteger(productId) || productId <= 0) {
                    continue;
                }

                const variants = (product.variants ?? [])
                    .map((variant) => {
                        const variantId = toNumber(variant.id);
                        if (!Number.isInteger(variantId) || variantId <= 0) {
                            return null;
                        }
                        return {
                            id: variantId,
                            title: variant.title?.trim() ? variant.title : `Variant ${variantId}`,
                        };
                    })
                    .filter((variant): variant is { id: number; title: string } => variant !== null);

                shopifyProductMap.set(productId, {
                    title: product.title?.trim() ? product.title : `Service ${productId}`,
                    variants,
                });
            }

            const nextProductCatalog: ManualProductCatalog[] = [];
            for (const config of productsData.products ?? []) {
                const productId = toNumber(config.product_id);
                if (!Number.isInteger(productId) || productId <= 0) {
                    continue;
                }
                if (!toBoolean(config.rentable, true)) {
                    continue;
                }

                const configuredVariantRaw = config.variant_id;
                const configuredVariantId =
                    configuredVariantRaw === null || configuredVariantRaw === undefined
                        ? null
                        : toNumber(configuredVariantRaw);
                const shopifyProduct = shopifyProductMap.get(productId);
                const allVariants = shopifyProduct?.variants ?? [];
                let variants = allVariants;

                if (configuredVariantId !== null && Number.isInteger(configuredVariantId) && configuredVariantId > 0) {
                    variants = allVariants.filter((variant) => variant.id === configuredVariantId);
                    if (variants.length === 0) {
                        variants = [{ id: configuredVariantId, title: `Variant ${configuredVariantId}` }];
                    }
                }

                if (variants.length === 0) {
                    continue;
                }

                nextProductCatalog.push({
                    product_id: productId,
                    title: shopifyProduct?.title ?? `Service ${productId}`,
                    configured_variant_id:
                        configuredVariantId !== null && Number.isInteger(configuredVariantId) && configuredVariantId > 0
                            ? configuredVariantId
                            : null,
                    variants,
                });
            }

            nextProductCatalog.sort((a, b) => a.title.localeCompare(b.title));

            const nextLocationOptions = (locationsData.locations ?? [])
                .filter((location) => toBoolean(location.active, true))
                .map((location) => ({
                    label: location.name?.trim() ? location.name : location.code,
                    value: location.code,
                }))
                .sort((a, b) => a.label.localeCompare(b.label));

            setManualProductCatalog(nextProductCatalog);
            setManualLocationOptions(nextLocationOptions);
            if (nextProductCatalog.length === 0) {
                setManualBookingError('No rentable products are configured.');
            } else if (nextLocationOptions.length === 0) {
                setManualBookingError('No active locations are configured.');
            }

            setManualForm((current) => {
                const locationCode = nextLocationOptions.some((option) => option.value === current.locationCode)
                    ? current.locationCode
                    : (nextLocationOptions[0]?.value ?? '');

                const productId = nextProductCatalog.some((entry) => String(entry.product_id) === current.productId)
                    ? current.productId
                    : (nextProductCatalog[0] ? String(nextProductCatalog[0].product_id) : '');

                const variantChoices = getVariantChoicesForProduct(nextProductCatalog, productId);
                const variantId = variantChoices.some((option) => option.value === current.variantId)
                    ? current.variantId
                    : (variantChoices[0]?.value ?? '');

                return {
                    ...current,
                    locationCode,
                    productId,
                    variantId,
                };
            });
        } catch (loadError) {
            console.error('Failed to load manual booking options', loadError);
            setManualBookingError(loadError instanceof Error ? loadError.message : 'Failed to load booking options');
        } finally {
            setManualBookingLoadingOptions(false);
        }
    }, [fetch]);

    const loadBookings = useCallback(async (search: string) => {
        setLoading(true);
        try {
            const params = buildBookingsQueryParams({
                selectedTab,
                selectedStatus,
                upcomingOnly,
                selectedService,
                selectedType,
                sortDirection,
                search,
            });

            const queryString = params.toString();
            const response = await fetch(queryString ? `/bookings?${queryString}` : '/bookings');
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || `Error: ${response.status} ${response.statusText}`);
            }

            const data = (await response.json()) as BookingsResponse;
            setBookings(Array.isArray(data.bookings) ? data.bookings : []);
            setError(null);
        } catch (loadError: unknown) {
            console.error('Failed to load bookings', loadError);
            setBookings([]);
            if (loadError instanceof Error) {
                setError(loadError.message);
            } else {
                setError('An unknown error occurred');
            }
        } finally {
            setLoading(false);
        }
    }, [fetch, selectedTab, selectedStatus, upcomingOnly, selectedService, selectedType, sortDirection]);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchQuery), 350);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        void loadFilterOptions();
    }, [loadFilterOptions]);

    useEffect(() => {
        void loadBookings(debouncedSearch);
    }, [debouncedSearch, loadBookings]);

    useEffect(() => {
        if (!manualBookingOpen) {
            return;
        }
        void loadManualBookingOptions();
    }, [manualBookingOpen, loadManualBookingOptions]);

    const manualProductOptions = manualProductCatalog.map((product) => ({
        label: product.title,
        value: String(product.product_id),
    }));
    const manualVariantOptions = getVariantChoicesForProduct(manualProductCatalog, manualForm.productId);
    const selectedManualProduct = manualProductCatalog.find(
        (product) => String(product.product_id) === manualForm.productId
    );

    const handleOpenManualBooking = () => {
        setManualBookingError(null);
        setManualBookingOpen(true);
    };

    const handleCloseManualBooking = () => {
        if (manualBookingSubmitting) {
            return;
        }
        setManualBookingOpen(false);
        setManualBookingError(null);
        setManualForm((current) => ({
            ...DEFAULT_MANUAL_FORM,
            locationCode: current.locationCode,
            productId: current.productId,
            variantId: current.variantId,
        }));
    };

    const handleManualProductChange = (productId: string) => {
        const variantChoices = getVariantChoicesForProduct(manualProductCatalog, productId);
        const nextVariantId = variantChoices[0]?.value ?? '';
        setManualForm((current) => ({
            ...current,
            productId,
            variantId: nextVariantId,
        }));
    };

    const handleManualBookingSubmit = async () => {
        setManualBookingError(null);

        if (
            !manualForm.locationCode ||
            !manualForm.startDate ||
            !manualForm.endDate ||
            !manualForm.productId ||
            !manualForm.variantId
        ) {
            const message = 'Please complete all required fields.';
            setManualBookingError(message);
            showShopifyToast(message, true);
            return;
        }

        const quantity = Number(manualForm.quantity);
        const productId = Number(manualForm.productId);
        const variantId = Number(manualForm.variantId);
        if (
            !Number.isInteger(quantity) ||
            quantity <= 0 ||
            !Number.isInteger(productId) ||
            productId <= 0 ||
            !Number.isInteger(variantId) ||
            variantId <= 0
        ) {
            const message = 'Quantity, product, and variant must be valid values.';
            setManualBookingError(message);
            showShopifyToast(message, true);
            return;
        }

        if (manualForm.fulfillmentType === 'Delivery' && manualForm.deliveryAddress.trim().length === 0) {
            const message = 'Delivery address is required for delivery bookings.';
            setManualBookingError(message);
            showShopifyToast(message, true);
            return;
        }

        setManualBookingSubmitting(true);

        try {
            const payload = {
                start_date: manualForm.startDate,
                end_date: manualForm.endDate,
                location: manualForm.locationCode,
                customer_name: manualForm.customerName.trim() || undefined,
                customer_email: manualForm.customerEmail.trim() || undefined,
                fulfillment_type: manualForm.fulfillmentType,
                delivery_address:
                    manualForm.fulfillmentType === 'Delivery'
                        ? manualForm.deliveryAddress.trim()
                        : undefined,
                items: [
                    {
                        product_id: productId,
                        variant_id: variantId,
                        qty: quantity,
                    },
                ],
            };

            const response = await fetch('/bookings', {
                method: 'POST',
                body: JSON.stringify(payload),
            });

            const responseBody = (await response.json().catch(() => null)) as ManualBookingCreateResponse | null;
            if (!response.ok || !responseBody?.ok) {
                const message = responseBody?.error || `Failed to create booking (${response.status})`;
                throw new Error(message);
            }

            setManualBookingOpen(false);
            setManualForm((current) => ({
                ...DEFAULT_MANUAL_FORM,
                locationCode: current.locationCode,
                productId: current.productId,
                variantId: current.variantId,
            }));
            showShopifyToast(`Manual booking created (${responseBody.booking_token?.slice(0, 8) ?? 'token'})`);
            await loadBookings(debouncedSearch);
        } catch (submitError) {
            const message = submitError instanceof Error ? submitError.message : 'Failed to create booking';
            setManualBookingError(message);
            showShopifyToast(message, true);
        } finally {
            setManualBookingSubmitting(false);
        }
    };

    const handleMarkComplete = async (token: string): Promise<boolean> => {
        try {
            const response = await fetch(`/bookings/${token}/complete`, { method: 'POST' });
            const responseBody = (await response.json().catch(() => null)) as BookingCompleteResponse | null;
            if (!response.ok || !responseBody?.ok) {
                const message = responseBody?.error || `Failed to complete booking (${response.status})`;
                showShopifyToast(message, true);
                return false;
            }

            await loadBookings(debouncedSearch);

            if (responseBody.fulfillment?.success === false) {
                const detail = responseBody.fulfillment.message?.trim();
                showShopifyToast(
                    detail
                        ? `Booking released, but Shopify fulfillment failed: ${detail}`
                        : 'Booking released, but Shopify fulfillment failed.',
                    true
                );
                return true;
            }

            showShopifyToast('Booking marked as completed.');
            return true;
        } catch (completeError) {
            const message = completeError instanceof Error ? completeError.message : 'Failed to complete booking';
            showShopifyToast(message, true);
            return false;
        }
    };

    const handleExport = () => {
        if (bookings.length === 0) {
            return;
        }

        const header = [
            'booking_token',
            'status',
            'customer_name',
            'customer_email',
            'location_code',
            'start_date',
            'end_date',
            'order_id',
            'fulfillment_type',
            'service_product_ids',
            'service_count',
            'has_upsell',
            'revenue',
        ];

        const rows = bookings.map((booking) => [
            escapeCsvValue(booking.booking_token),
            escapeCsvValue(booking.status),
            escapeCsvValue(booking.customer_name ?? ''),
            escapeCsvValue(booking.customer_email ?? ''),
            escapeCsvValue(booking.location_code),
            escapeCsvValue(booking.start_date),
            escapeCsvValue(booking.end_date),
            escapeCsvValue(booking.order_id ?? ''),
            escapeCsvValue(booking.fulfillment_type ?? ''),
            escapeCsvValue(booking.service_product_ids ?? ''),
            escapeCsvValue(booking.service_count ?? ''),
            escapeCsvValue(hasUpsell(booking) ? 'Yes' : 'No'),
            escapeCsvValue(booking.revenue ?? ''),
        ]);

        const csv = `${header.join(',')}\n${rows.map((row) => row.join(',')).join('\n')}`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `bookings-export-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <Page fullWidth>
            <div style={{ marginBottom: '20px' }}>
                <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" align="center">
                        <Text as="h1" variant="headingLg">Bookings</Text>
                        <Badge tone="info">{bookings.length.toString()}</Badge>
                    </InlineStack>
                    <Button variant="primary" icon={PlusIcon} onClick={handleOpenManualBooking}>
                        Manual booking
                    </Button>
                </InlineStack>
            </div>

            <Layout>
                <Layout.Section>
                    <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
                        <Box paddingBlockStart="400">
                            {selectedTab === 4 ? (
                                <BookingsCalendar bookings={bookings} />
                            ) : (
                                <>
                                    <div
                                        style={{
                                            background: 'white',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            border: '1px solid #e1e3e5',
                                            marginBottom: '20px',
                                        }}
                                    >
                                        <InlineStack gap="300" align="space-between">
                                            <div style={{ flexGrow: 1 }}>
                                                <TextField
                                                    label="Search"
                                                    labelHidden
                                                    placeholder="Filter by customer name or email"
                                                    value={searchQuery}
                                                    onChange={setSearchQuery}
                                                    autoComplete="off"
                                                    prefix={<SearchIcon />}
                                                />
                                            </div>
                                            <InlineStack gap="200">
                                                <Button pressed={upcomingOnly} onClick={() => setUpcomingOnly((prev) => !prev)}>
                                                    Upcoming
                                                </Button>
                                                <FilterPopover
                                                    options={serviceOptions}
                                                    selectedValue={selectedService}
                                                    onSelect={setSelectedService}
                                                />
                                                <FilterPopover
                                                    options={TYPE_OPTIONS}
                                                    selectedValue={selectedType}
                                                    onSelect={setSelectedType}
                                                />
                                                <FilterPopover
                                                    options={STATUS_OPTIONS}
                                                    selectedValue={selectedStatus}
                                                    onSelect={setSelectedStatus}
                                                />
                                                <Button
                                                    icon={ArrowUpIcon}
                                                    pressed={sortDirection === 'asc'}
                                                    accessibilityLabel="Toggle sort direction"
                                                    onClick={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                                                />
                                                <Button icon={ExportIcon} onClick={handleExport} disabled={bookings.length === 0}>
                                                    Export
                                                </Button>
                                            </InlineStack>
                                        </InlineStack>
                                    </div>

                                    {loading ? (
                                        <Box padding="1600" width="100%">
                                            <InlineStack align="center" blockAlign="center">
                                                <Spinner size="large" />
                                            </InlineStack>
                                        </Box>
                                    ) : error ? (
                                        <Box padding="400">
                                            <Text as="p" tone="critical">{error}</Text>
                                        </Box>
                                    ) : bookings.length === 0 ? (
                                        <Box padding="3200" width="100%">
                                            <InlineStack align="center" blockAlign="center" gap="400">
                                                <div style={{ textAlign: 'center' }}>
                                                    <SearchIcon
                                                        style={{
                                                            width: 48,
                                                            height: 48,
                                                            color: '#8c9196',
                                                            margin: '0 auto',
                                                            marginBottom: '16px',
                                                            display: 'block',
                                                        }}
                                                    />
                                                    <Text as="h2" variant="headingMd">No bookings found</Text>
                                                    <Text as="p" tone="subdued">Try changing the filters or search term</Text>
                                                </div>
                                            </InlineStack>
                                        </Box>
                                    ) : (
                                        <div>
                                            {bookings.map((booking) => (
                                                <BookingCard
                                                    key={booking.booking_token}
                                                    booking={booking}
                                                    onMarkComplete={handleMarkComplete}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </Box>
                    </Tabs>
                </Layout.Section>
            </Layout>

            <Modal
                open={manualBookingOpen}
                onClose={handleCloseManualBooking}
                title="Create manual booking"
                primaryAction={{
                    content: 'Create booking',
                    onAction: handleManualBookingSubmit,
                    loading: manualBookingSubmitting,
                    disabled:
                        manualBookingLoadingOptions ||
                        manualBookingSubmitting ||
                        manualProductCatalog.length === 0 ||
                        manualLocationOptions.length === 0,
                }}
                secondaryActions={[
                    {
                        content: 'Cancel',
                        onAction: handleCloseManualBooking,
                        disabled: manualBookingSubmitting,
                    },
                ]}
            >
                <Modal.Section>
                    {manualBookingLoadingOptions ? (
                        <Box padding="800">
                            <InlineStack align="center">
                                <Spinner size="small" />
                            </InlineStack>
                        </Box>
                    ) : (
                        <FormLayout>
                            {manualBookingError && <InlineError message={manualBookingError} fieldID="manual-booking-error" />}

                            <TextField
                                label="Customer name"
                                value={manualForm.customerName}
                                onChange={(value) => setManualForm((current) => ({ ...current, customerName: value }))}
                                autoComplete="name"
                            />
                            <TextField
                                label="Customer email"
                                value={manualForm.customerEmail}
                                onChange={(value) => setManualForm((current) => ({ ...current, customerEmail: value }))}
                                autoComplete="email"
                                type="email"
                            />
                            <Select
                                label="Location"
                                options={
                                    manualLocationOptions.length > 0
                                        ? manualLocationOptions
                                        : [{ label: 'No active locations', value: '' }]
                                }
                                value={manualForm.locationCode}
                                onChange={(value) => setManualForm((current) => ({ ...current, locationCode: value }))}
                            />
                            <InlineStack gap="300" align="start">
                                <div style={{ flex: 1 }}>
                                    <TextField
                                        label="Start date"
                                        type="date"
                                        value={manualForm.startDate}
                                        onChange={(value) => setManualForm((current) => ({ ...current, startDate: value }))}
                                        autoComplete="off"
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <TextField
                                        label="End date"
                                        type="date"
                                        value={manualForm.endDate}
                                        onChange={(value) => setManualForm((current) => ({ ...current, endDate: value }))}
                                        autoComplete="off"
                                    />
                                </div>
                            </InlineStack>
                            <Select
                                label="Product"
                                options={
                                    manualProductOptions.length > 0
                                        ? manualProductOptions
                                        : [{ label: 'No rentable products configured', value: '' }]
                                }
                                value={manualForm.productId}
                                onChange={handleManualProductChange}
                            />
                            <Select
                                label="Variant"
                                options={
                                    manualVariantOptions.length > 0
                                        ? manualVariantOptions
                                        : [{ label: 'No variants available', value: '' }]
                                }
                                value={manualForm.variantId}
                                onChange={(value) => setManualForm((current) => ({ ...current, variantId: value }))}
                                disabled={Boolean(selectedManualProduct?.configured_variant_id)}
                            />
                            {selectedManualProduct?.configured_variant_id ? (
                                <Text as="p" tone="subdued">
                                    Variant is locked by product configuration.
                                </Text>
                            ) : null}
                            <TextField
                                label="Quantity"
                                type="number"
                                min={1}
                                value={manualForm.quantity}
                                onChange={(value) => setManualForm((current) => ({ ...current, quantity: value }))}
                                autoComplete="off"
                            />
                            <Select
                                label="Fulfillment type"
                                options={[
                                    { label: 'Pick Up', value: 'Pick Up' },
                                    { label: 'Delivery', value: 'Delivery' },
                                ]}
                                value={manualForm.fulfillmentType}
                                onChange={(value) =>
                                    setManualForm((current) => ({
                                        ...current,
                                        fulfillmentType: value === 'Delivery' ? 'Delivery' : 'Pick Up',
                                        deliveryAddress: value === 'Delivery' ? current.deliveryAddress : '',
                                    }))
                                }
                            />
                            {manualForm.fulfillmentType === 'Delivery' ? (
                                <TextField
                                    label="Delivery address"
                                    value={manualForm.deliveryAddress}
                                    onChange={(value) => setManualForm((current) => ({ ...current, deliveryAddress: value }))}
                                    autoComplete="street-address"
                                />
                            ) : null}
                        </FormLayout>
                    )}
                </Modal.Section>
            </Modal>
        </Page>
    );
}
