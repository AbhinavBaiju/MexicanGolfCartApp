import { Page, Layout, Badge, Tabs, TextField, InlineStack, Button, Box, Text, Spinner } from '@shopify/polaris';
import { useAuthenticatedFetch } from '../api';
import { useEffect, useState, useCallback } from 'react';
import { BookingCard, type Booking } from '../components/BookingCard';
import { SearchIcon, ExportIcon, ArrowUpIcon } from '@shopify/polaris-icons';

export default function Bookings() {
    const fetch = useAuthenticatedFetch();
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTab, setSelectedTab] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Tabs mapping
    // 0: Bookings (Confirmed)
    // 1: Canceled (Cancelled)
    // 2: Abandoned (Expired)
    const tabs = [
        { id: 'bookings', content: 'Bookings', panelID: 'bookings-content' },
        { id: 'canceled', content: 'Canceled', panelID: 'canceled-content' },
        { id: 'abandoned', content: 'Abandoned', panelID: 'abandoned-content' },
    ];

    const loadBookings = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();

            // Map tabs to statuses
            if (selectedTab === 0) {
                params.append('status', 'CONFIRMED');
            } else if (selectedTab === 1) {
                params.append('status', 'CANCELLED');
            } else if (selectedTab === 2) {
                params.append('status', 'EXPIRED');
            }
            // Add other statuses as needed

            if (searchQuery) {
                // Assuming backend supports 'query' or generic search. If not, client-side filter might be needed.
                // For now, let's assuming we filter client side if backend doesn't support it, 
                // BUT the fetch is the only way to get data. 
                // Let's rely on status first.
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
    }, [fetch, selectedTab]);

    useEffect(() => {
        loadBookings();
    }, [loadBookings]);

    // Handle client-side filtering safely if backend search isn't ready
    const filteredBookings = bookings.filter(b => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return b.booking_token.toLowerCase().includes(q) ||
            b.location_code.toLowerCase().includes(q) ||
            (b.order_id && b.order_id.toString().includes(q));
    });

    return (
        <Page fullWidth>
            <div style={{ marginBottom: '20px' }}>
                <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" align="center">
                        <Text as="h1" variant="headingLg">Bookings</Text>
                        <Badge tone="info">{filteredBookings.length.toString()}</Badge>
                    </InlineStack>
                    <Button icon={ExportIcon}>Manual booking</Button>
                </InlineStack>
            </div>

            <Layout>
                <Layout.Section>
                    <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
                        <Box paddingBlockStart="400">
                            {/* Filter Bar */}
                            <div style={{ background: 'white', padding: '12px', borderRadius: '8px', border: '1px solid #e1e3e5', marginBottom: '20px' }}>
                                <InlineStack gap="300" align="space-between">
                                    <div style={{ flexGrow: 1, maxWidth: '400px' }}>
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
                                        {/* Mock filters to match screenshot */}
                                        <Button variant="secondary">Upcoming</Button>
                                        <Button variant="secondary" disclosure>All services</Button>
                                        <Button variant="secondary" disclosure>All types</Button>
                                        <Button variant="secondary" disclosure>All statuses</Button>
                                        <Button icon={ArrowUpIcon} />
                                        <Button icon={ExportIcon}>Export</Button>
                                    </InlineStack>
                                </InlineStack>
                            </div>

                            {/* Booking List */}
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
                            ) : filteredBookings.length === 0 ? (
                                <Box padding="3200" width="100%">
                                    <InlineStack align="center" blockAlign="center" gap="400">
                                        <div style={{ textAlign: 'center' }}>
                                            <SearchIcon style={{ width: 48, height: 48, color: '#8c9196' }} />
                                            <Text as="h2" variant="headingMd">No bookings found</Text>
                                            <Text as="p" tone="subdued">Try changing the filters or search term</Text>
                                        </div>
                                    </InlineStack>
                                </Box>
                            ) : (
                                <div>
                                    {filteredBookings.map(booking => (
                                        <BookingCard key={booking.booking_token} booking={booking} />
                                    ))}
                                </div>
                            )}
                        </Box>
                    </Tabs>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
