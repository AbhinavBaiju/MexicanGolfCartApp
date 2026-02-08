import {
    ActionList,
    Box,
    Button,
    ButtonGroup,
    Card,
    InlineStack,
    Layout,
    Page,
    Popover,
    Spinner,
    Text,
    TextField,
} from '@shopify/polaris';
import { SearchIcon, ExportIcon, ArrowUpIcon, PlusIcon } from '@shopify/polaris-icons';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardStats } from '../components/DashboardStats';
import { ProductInventory } from '../components/ProductInventory';
import { BookingsCalendar } from '../components/BookingsCalendar';
import { useAuthenticatedFetch } from '../api';
import type { Booking } from '../components/BookingCard';
import { BookingCard } from '../components/BookingCard';
import { showShopifyToast } from '../utils/shopifyToast';
import { buildDashboardBookingsQueryParams, buildDashboardServiceOptions } from './dashboardQuery';

const DASHBOARD_STYLES = `
    .full-height-card-wrapper {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
    }
    .full-height-card-wrapper .Polaris-Card {
        height: 100%;
        display: flex;
        flex-direction: column;
        flex: 1;
    }
    .full-height-card-wrapper .Polaris-Card > .Polaris-Box,
    .full-height-card-wrapper .Polaris-Card > .Polaris-Box > div {
        flex: 1;
        display: flex;
        flex-direction: column;
    }
    .full-height-card-wrapper .Polaris-Card .Polaris-BlockStack,
    .full-height-card-wrapper .Polaris-Card .Polaris-InlineStack {
        flex: 1;
    }
    .full-height-card-wrapper #calendar-box > div {
        flex: 1;
        display: flex;
        flex-direction: column;
    }
`;

interface ProductStat {
    product_id: number;
    count: number;
}

interface DashboardStatsResponse {
    stats?: {
        revenue?: string | number | null;
        bookings_count?: string | number | null;
        cancelled_count?: string | number | null;
    };
    productStats?: Array<{
        product_id: string | number;
        count: string | number;
    }>;
}

interface DashboardBooking extends Booking {
    customer_name?: string | null;
    customer_email?: string | null;
    revenue?: string | number | null;
    service_count?: string | number | null;
    service_product_ids?: string | null;
    has_upsell?: number | boolean | null;
}

interface BookingsResponse {
    bookings?: DashboardBooking[];
}

interface ProductConfigResponse {
    products?: Array<{ product_id: string | number }>;
}

interface ShopifyProductsResponse {
    products?: Array<{ id: string | number; title?: string | null }>;
}

interface LocationsResponse {
    locations?: Array<{ code: string; name: string }>;
}

interface BookingCompleteResponse {
    ok?: boolean;
    error?: string;
    fulfillment?: {
        success?: boolean;
        message?: string;
    };
}

interface FilterOption {
    label: string;
    value: string;
}

interface FilterPopoverProps {
    options: FilterOption[];
    selectedValue: string;
    onSelect: (value: string) => void;
}

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

const UPSELL_OPTIONS: FilterOption[] = [
    { label: 'Upsell', value: 'all' },
    { label: 'With upsell', value: 'with_upsell' },
    { label: 'Without upsell', value: 'without_upsell' },
];

const HELP_URL = (import.meta.env.VITE_DASHBOARD_HELP_URL ?? 'https://help.shopify.com/en/manual/apps').trim();
const FAQ_URL = (import.meta.env.VITE_DASHBOARD_FAQ_URL ?? 'https://help.shopify.com/en/manual').trim();

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

function parseServiceIds(value: string | null | undefined): string[] {
    if (!value) {
        return [];
    }
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function hasUpsell(booking: DashboardBooking): boolean {
    if (typeof booking.has_upsell === 'boolean') {
        return booking.has_upsell;
    }
    if (toNumber(booking.has_upsell ? 1 : 0) > 0) {
        return true;
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

export default function Dashboard() {
    const fetch = useAuthenticatedFetch();
    const navigate = useNavigate();
    const [calendarBookings, setCalendarBookings] = useState<Booking[]>([]);
    const [filteredBookings, setFilteredBookings] = useState<DashboardBooking[]>([]);
    const [stats, setStats] = useState({
        revenue: 0,
        bookingsCount: 0,
        cancelledCount: 0,
    });
    const [productStats, setProductStats] = useState<ProductStat[]>([]);
    const [loadingDashboard, setLoadingDashboard] = useState(true);
    const [loadingBookings, setLoadingBookings] = useState(true);
    const [dashboardError, setDashboardError] = useState<string | null>(null);
    const [bookingsError, setBookingsError] = useState<string | null>(null);

    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    const [upcomingOnly, setUpcomingOnly] = useState(true);
    const [selectedService, setSelectedService] = useState('all');
    const [selectedLocation, setSelectedLocation] = useState('all');
    const [selectedType, setSelectedType] = useState('all');
    const [selectedStatus, setSelectedStatus] = useState('all');
    const [selectedUpsell, setSelectedUpsell] = useState('all');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

    const [serviceOptions, setServiceOptions] = useState<FilterOption[]>([{ label: 'All services', value: 'all' }]);
    const [locationOptions, setLocationOptions] = useState<FilterOption[]>([{ label: 'All locations', value: 'all' }]);

    const loadData = useCallback(async () => {
        setLoadingDashboard(true);
        try {
            const [dashboardRes, bookingsRes, productsRes, locationsRes, shopifyProductsRes] = await Promise.all([
                fetch('/dashboard'),
                fetch('/bookings'),
                fetch('/products'),
                fetch('/locations'),
                fetch('/shopify-products'),
            ]);

            if (dashboardRes.ok) {
                const dashboardData = (await dashboardRes.json()) as DashboardStatsResponse;
                const revenue = toNumber(dashboardData.stats?.revenue);
                const bookingsCount = toNumber(dashboardData.stats?.bookings_count);
                const cancelledCount = toNumber(dashboardData.stats?.cancelled_count);
                const normalizedProductStats = (dashboardData.productStats || [])
                    .map((entry) => {
                        const productId = toNumber(entry.product_id);
                        if (!Number.isInteger(productId) || productId <= 0) {
                            return null;
                        }
                        return {
                            product_id: productId,
                            count: toNumber(entry.count),
                        };
                    })
                    .filter((entry): entry is ProductStat => entry !== null);

                setStats({
                    revenue,
                    bookingsCount,
                    cancelledCount,
                });
                setProductStats(normalizedProductStats);
                setDashboardError(null);
            } else {
                setDashboardError('Failed to load dashboard summary.');
            }

            if (bookingsRes.ok) {
                const bookingsData = (await bookingsRes.json()) as BookingsResponse;
                setCalendarBookings(Array.isArray(bookingsData.bookings) ? bookingsData.bookings : []);
            }

            if (productsRes.ok) {
                const productsData = (await productsRes.json()) as ProductConfigResponse;
                let shopifyProducts: ShopifyProductsResponse['products'] = [];
                if (shopifyProductsRes.ok) {
                    const shopifyProductsData = (await shopifyProductsRes.json()) as ShopifyProductsResponse;
                    shopifyProducts = shopifyProductsData.products;
                }
                setServiceOptions(buildDashboardServiceOptions(productsData.products, shopifyProducts));
            }

            if (locationsRes.ok) {
                const locationsData = (await locationsRes.json()) as LocationsResponse;
                const nextOptions: FilterOption[] = [{ label: 'All locations', value: 'all' }];
                const seenCodes = new Set<string>();
                for (const location of locationsData.locations || []) {
                    const code = location.code.trim();
                    if (!code || seenCodes.has(code)) {
                        continue;
                    }
                    seenCodes.add(code);
                    nextOptions.push({
                        label: location.name?.trim() || code,
                        value: code,
                    });
                }
                setLocationOptions(nextOptions);
            }
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
            setDashboardError('Failed to load dashboard data.');
        } finally {
            setLoadingDashboard(false);
        }
    }, [fetch]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchQuery), 350);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const loadFilteredBookings = useCallback(async (search: string) => {
        setLoadingBookings(true);
        try {
            const params = buildDashboardBookingsQueryParams({
                sortDirection,
                upcomingOnly,
                selectedService,
                selectedLocation,
                selectedType,
                selectedStatus,
                selectedUpsell,
                search,
            });

            const response = await fetch(`/bookings?${params.toString()}`);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Failed to load bookings');
            }
            const data = (await response.json()) as BookingsResponse;
            setFilteredBookings(Array.isArray(data.bookings) ? data.bookings : []);
            setBookingsError(null);
        } catch (error) {
            console.error('Error loading filtered bookings:', error);
            setFilteredBookings([]);
            setBookingsError('Failed to load filtered bookings.');
        } finally {
            setLoadingBookings(false);
        }
    }, [fetch, selectedLocation, selectedService, selectedStatus, selectedType, selectedUpsell, sortDirection, upcomingOnly]);

    useEffect(() => {
        void loadFilteredBookings(debouncedSearch);
    }, [debouncedSearch, loadFilteredBookings]);

    const openExternalUrl = useCallback((url: string) => {
        if (typeof window !== 'undefined') {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    }, []);

    const handleOpenFaq = useCallback(() => {
        openExternalUrl(FAQ_URL);
    }, [openExternalUrl]);

    const handleCreateService = useCallback(() => {
        navigate('/inventory');
    }, [navigate]);

    const handleMarkComplete = async (token: string): Promise<boolean> => {
        try {
            const response = await fetch(`/bookings/${token}/complete`, { method: 'POST' });
            const responseBody = (await response.json().catch(() => null)) as BookingCompleteResponse | null;
            if (!response.ok || !responseBody?.ok) {
                const message = responseBody?.error || `Failed to complete booking (${response.status})`;
                showShopifyToast(message, true);
                return false;
            }

            await Promise.all([loadData(), loadFilteredBookings(debouncedSearch)]);

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
        if (filteredBookings.length === 0) {
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

        const rows = filteredBookings.map((booking) => [
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
            <style dangerouslySetInnerHTML={{ __html: DASHBOARD_STYLES }} />

            <div style={{ marginBottom: '20px' }}>
                <InlineStack align="space-between" blockAlign="center">
                    <Text as="h1" variant="headingLg">Dashboard</Text>
                    <ButtonGroup>
                        <Button onClick={handleOpenFaq}>FAQ</Button>
                        <Button variant="primary" icon={PlusIcon} onClick={handleCreateService}>New service</Button>
                    </ButtonGroup>
                </InlineStack>
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
                gap: '20px',
                alignItems: 'stretch',
                marginBottom: '20px',
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <DashboardStats stats={stats} />
                    <div className="full-height-card-wrapper" style={{ flex: 1 }}>
                        <ProductInventory stats={productStats} />
                    </div>
                </div>

                <div className="full-height-card-wrapper">
                    <BookingsCalendar bookings={calendarBookings} />
                </div>
            </div>

            <Layout>
                <Layout.Section>
                    <div style={{ marginTop: '20px' }}>
                        <InlineStack gap="200" align="center" blockAlign="center">
                            <Text as="h2" variant="headingMd">Upcoming bookings</Text>
                            <div style={{ background: '#e4e5e7', color: 'black', borderRadius: '12px', padding: '0 8px', fontSize: '12px', fontWeight: 'bold' }}>
                                {filteredBookings.length}
                            </div>
                        </InlineStack>

                        <div style={{ marginTop: '16px' }}>
                            <Card>
                                <Box padding="400">
                                    <div style={{ marginBottom: '16px' }}>
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

                                    <div style={{ marginBottom: '16px' }}>
                                        <InlineStack gap="200" align="start">
                                            <Button pressed={upcomingOnly} onClick={() => setUpcomingOnly((prev) => !prev)}>
                                                Upcoming
                                            </Button>
                                            <FilterPopover
                                                options={serviceOptions}
                                                selectedValue={selectedService}
                                                onSelect={setSelectedService}
                                            />
                                            <FilterPopover
                                                options={locationOptions}
                                                selectedValue={selectedLocation}
                                                onSelect={setSelectedLocation}
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
                                            <FilterPopover
                                                options={UPSELL_OPTIONS}
                                                selectedValue={selectedUpsell}
                                                onSelect={setSelectedUpsell}
                                            />
                                            <Button
                                                icon={ArrowUpIcon}
                                                pressed={sortDirection === 'asc'}
                                                accessibilityLabel="Toggle sort direction"
                                                onClick={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                                            />
                                            <Button icon={ExportIcon} onClick={handleExport} disabled={filteredBookings.length === 0}>
                                                Export
                                            </Button>
                                        </InlineStack>
                                    </div>

                                    {(loadingDashboard || loadingBookings) ? (
                                        <Box padding="1600">
                                            <InlineStack align="center"><Spinner size="large" /></InlineStack>
                                        </Box>
                                    ) : dashboardError || bookingsError ? (
                                        <Box padding="400">
                                            <Text as="p" tone="critical">{dashboardError || bookingsError}</Text>
                                        </Box>
                                    ) : filteredBookings.length === 0 ? (
                                        <div style={{ padding: '60px 0', textAlign: 'center' }}>
                                            <SearchIcon style={{ width: 60, height: 60, color: '#8c9196', margin: '0 auto', display: 'block' }} />
                                            <div style={{ height: 16 }} />
                                            <Text as="h3" variant="headingMd">No bookings found</Text>
                                            <Text as="p" tone="subdued">Try changing the filters or search term</Text>
                                        </div>
                                    ) : (
                                        <div>
                                            {filteredBookings.slice(0, 5).map((booking) => (
                                                <BookingCard
                                                    key={booking.booking_token}
                                                    booking={booking}
                                                    onMarkComplete={handleMarkComplete}
                                                />
                                            ))}
                                            {filteredBookings.length > 5 && (
                                                <Box padding="400">
                                                    <InlineStack align="center">
                                                        <Button variant="plain">View all filtered bookings</Button>
                                                    </InlineStack>
                                                </Box>
                                            )}
                                        </div>
                                    )}
                                </Box>
                            </Card>
                        </div>
                    </div>
                </Layout.Section>
            </Layout>

            <Box paddingBlockEnd="2400">
                <div style={{ textAlign: 'center', marginTop: '40px' }}>
                    <Text as="p" tone="subdued">
                        Get help{' '}
                        <a href={HELP_URL} target="_blank" rel="noreferrer" style={{ color: '#2c6ecb' }}>
                            using this app
                        </a>{' '}
                        or{' '}
                        <a href={FAQ_URL} target="_blank" rel="noreferrer" style={{ color: '#2c6ecb' }}>
                            read the FAQ
                        </a>
                    </Text>
                </div>
            </Box>
        </Page>
    );
}
