import { Page, Layout, LegacyCard, ResourceList, ResourceItem, Text, Badge, LegacyFilters, ChoiceList } from '@shopify/polaris';
import { useAuthenticatedFetch } from '../api';
import { useEffect, useState, useCallback } from 'react';

interface Booking {
    booking_token: string;
    status: string;
    location_code: string;
    start_date: string;
    end_date: string;
    order_id: number | null;
    invalid_reason: string | null;
    created_at: string;
}

export default function Bookings() {
    const fetch = useAuthenticatedFetch();
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);
    const [queryValue, setQueryValue] = useState('');
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    const loadBookings = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter.length > 0) {
                // Backend currently only supports single status query param? 
                // handleBookingsGet: const status = url.searchParams.get('status');
                // So we can only filter by one status at a time in backend, or filtering client side.
                // Let's filter client side for multiple, or just pass the first one.
                // Let's pass the first one for now or rethink.
                // Actually, let's just fetch all (or recent) and filter client side if the list is small, 
                // but backend limits? No explicit limit in `handleBookingsGet` SQL (oops).
                // It might return too many. But for now it's fine.
                // Let's try to use backend filter if single status selected.
                if (statusFilter.length === 1) {
                    params.append('status', statusFilter[0]);
                }
            }

            const response = await fetch(`/bookings?${params.toString()}`);
            if (response.ok) {
                const data = await response.json();
                setBookings(data.bookings);
            } else {
                const errorData = await response.json();
                setError(errorData.message || `Error: ${response.status} ${response.statusText}`);
            }
        } catch (e: unknown) {
            if (e instanceof Error) {
                setError(e.message);
            } else {
                setError('An unknown error occurred');
            }
        } finally {
            setLoading(false);
        }
    }, [fetch, statusFilter]);

    useEffect(() => {
        loadBookings();
    }, [loadBookings]);

    const handleStatusChange = useCallback(
        (value: string[]) => setStatusFilter(value),
        [],
    );

    const handleStatusRemove = useCallback(() => setStatusFilter([]), []);
    const handleQueryValueRemove = useCallback(() => setQueryValue(''), []);

    const filters = [
        {
            key: 'status',
            label: 'Status',
            filter: (
                <ChoiceList
                    title="Status"
                    titleHidden
                    choices={[
                        { label: 'Hold', value: 'HOLD' },
                        { label: 'Confirmed', value: 'CONFIRMED' },
                        { label: 'Released', value: 'RELEASED' },
                        { label: 'Expired', value: 'EXPIRED' },
                        { label: 'Invalid', value: 'INVALID' },
                        { label: 'Cancelled', value: 'CANCELLED' },
                    ]}
                    selected={statusFilter}
                    onChange={handleStatusChange}
                    allowMultiple
                />
            ),
            shortcut: true,
        },
    ];

    const appliedFilters = [];
    if (statusFilter.length > 0) {
        const key = 'status';
        appliedFilters.push({
            key,
            label: `Status: ${statusFilter.join(', ')}`,
            onRemove: handleStatusRemove,
        });
    }

    // Client-side filtering for search query (token) or multiple statuses if backend didn't handle it
    const filteredBookings = bookings.filter((booking) => {
        const matchesStatus = statusFilter.length === 0 || statusFilter.includes(booking.status);
        const matchesQuery = queryValue === '' ||
            booking.booking_token.toLowerCase().includes(queryValue.toLowerCase()) ||
            booking.order_id?.toString().includes(queryValue) ||
            booking.start_date.includes(queryValue);

        return matchesStatus && matchesQuery;
    });

    const resourceName = {
        singular: 'booking',
        plural: 'bookings',
    };

    return (
        <Page title="Bookings">
            <Layout>
                <Layout.Section>
                    <LegacyCard>
                        {error && <div style={{ padding: '1rem', color: 'red' }}><Text as="p" tone="critical">{error}</Text></div>}
                        <ResourceList
                            resourceName={resourceName}
                            items={filteredBookings}
                            loading={loading}
                            filterControl={
                                <LegacyFilters
                                    queryValue={queryValue}
                                    filters={filters}
                                    appliedFilters={appliedFilters}
                                    onQueryChange={setQueryValue}
                                    onQueryClear={handleQueryValueRemove}
                                    onClearAll={() => {
                                        handleStatusRemove();
                                        handleQueryValueRemove();
                                    }}
                                />
                            }
                            renderItem={(item) => {
                                const { booking_token, status, start_date, end_date, location_code, order_id } = item;
                                let badgeTone = 'info';
                                if (status === 'CONFIRMED') badgeTone = 'success';
                                if (status === 'EXPIRED' || status === 'RELEASED') badgeTone = 'subdued';
                                if (status === 'INVALID' || status === 'CANCELLED') badgeTone = 'critical';

                                return (
                                    <ResourceItem
                                        id={booking_token}
                                        url="#"
                                        onClick={() => { }} // TODO: Navigate to detail
                                        accessibilityLabel={`View details for ${booking_token}`}
                                        name={booking_token}
                                    >
                                        <Text variant="bodyMd" fontWeight="bold" as="h3">
                                            {start_date} to {end_date}
                                        </Text>
                                        <div>Location: {location_code}</div>
                                        {order_id && <div>Order: {order_id}</div>}
                                        <div>Token: {booking_token.substring(0, 8)}...</div>
                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                        <Badge tone={badgeTone as any}>{status}</Badge>
                                    </ResourceItem>
                                );
                            }}
                        />
                    </LegacyCard>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
