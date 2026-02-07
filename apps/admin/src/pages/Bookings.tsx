import {
    ActionList,
    Badge,
    Box,
    Button,
    InlineStack,
    Layout,
    Page,
    Popover,
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
    products?: Array<{ product_id: string | number }>;
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

function getTabStatus(selectedTab: number): string | null {
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

    const tabs = [
        { id: 'bookings', content: 'Bookings', panelID: 'bookings-content' },
        { id: 'canceled', content: 'Canceled', panelID: 'canceled-content' },
        { id: 'pre-payment', content: 'Pre-payment', panelID: 'pre-payment-content' },
        { id: 'abandoned', content: 'Abandoned', panelID: 'abandoned-content' },
        { id: 'calendar', content: 'Bookings calendar', panelID: 'calendar-content' },
    ];

    const loadFilterOptions = useCallback(async () => {
        try {
            const response = await fetch('/products');
            if (!response.ok) {
                return;
            }

            const data = (await response.json()) as ProductConfigResponse;
            const serviceIds = (data.products || [])
                .map((entry) => toNumber(entry.product_id))
                .filter((id) => Number.isInteger(id) && id > 0)
                .sort((a, b) => a - b);

            setServiceOptions([
                { label: 'All services', value: 'all' },
                ...serviceIds.map((id) => ({ label: `Service ${id}`, value: String(id) })),
            ]);
        } catch (loadError) {
            console.error('Failed to load booking filter options', loadError);
        }
    }, [fetch]);

    const loadBookings = useCallback(async (search: string) => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            const isCalendarView = selectedTab === 4;

            if (!isCalendarView) {
                const tabStatus = getTabStatus(selectedTab);
                if (tabStatus) {
                    params.set('status', tabStatus);
                }

                if (selectedStatus !== 'all') {
                    params.set('status', selectedStatus);
                }

                if (upcomingOnly) {
                    params.set('date_preset', 'upcoming');
                }

                if (selectedService !== 'all') {
                    params.set('product_id', selectedService);
                }

                if (selectedType !== 'all') {
                    params.set('fulfillment_type', selectedType);
                }

                const trimmedSearch = search.trim();
                if (trimmedSearch.length > 0) {
                    params.set('search', trimmedSearch);
                }
            }

            params.set('sort_direction', sortDirection);

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

    const handleMarkComplete = async (token: string) => {
        const response = await fetch(`/bookings/${token}/complete`, { method: 'POST' });
        if (response.ok) {
            await loadBookings(debouncedSearch);
        } else {
            console.error('Failed to complete booking');
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
                    <Button variant="primary" icon={PlusIcon}>Manual booking</Button>
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
        </Page>
    );
}
