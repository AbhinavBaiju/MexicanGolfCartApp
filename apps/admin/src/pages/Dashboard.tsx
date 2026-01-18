import {
    Page,
    Layout,
    Button,
    ButtonGroup,
    InlineStack,
    Box,
    Text,
    TextField,
    Card,
    Spinner,
} from '@shopify/polaris';
import { SearchIcon, ExportIcon, ArrowUpIcon, PlusIcon } from '@shopify/polaris-icons';
import { DashboardStats } from '../components/DashboardStats';
import { ProductInventory } from '../components/ProductInventory';
import { BookingsCalendar } from '../components/BookingsCalendar';
import { useEffect, useState, useCallback } from 'react';
import { useAuthenticatedFetch } from '../api';
import type { Booking } from '../components/BookingCard';
import { BookingCard } from '../components/BookingCard';

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
    /* Target common Polaris inner containers to ensure they stretch */
    .full-height-card-wrapper .Polaris-Card .Polaris-BlockStack,
    .full-height-card-wrapper .Polaris-Card .Polaris-InlineStack {
        flex: 1;
    }
    /* Ensure the calendar grid specifically stretches */
    .full-height-card-wrapper #calendar-box > div {
        flex: 1;
        display: flex;
        flex-direction: column;
    }
`;

export default function Dashboard() {
    const fetch = useAuthenticatedFetch();
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        revenue: 0,
        bookingsCount: 0,
        cancelledCount: 0,
        views: 0
    });
    const [searchQuery, setSearchQuery] = useState('');

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            // Fetch all bookings for stats (simplified: fetching all might be heavy in prod, but ok for now)
            // In a real app we might want a dedicated stats endpoint.
            const response = await fetch('/bookings');
            if (response.ok) {
                const data = await response.json();
                const fetchedBookings: Booking[] = data.bookings || [];
                setBookings(fetchedBookings);

                // Calculate stats
                const confirmed = fetchedBookings.filter(b => b.status === 'CONFIRMED');
                const cancelled = fetchedBookings.filter(b => b.status === 'CANCELLED');
                // Mock revenue logic as no price in Booking type yet
                const revenue = confirmed.reduce((acc, b) => acc + (b.order_id ? 100 : 0), 0);

                setStats({
                    revenue,
                    bookingsCount: confirmed.length,
                    cancelledCount: cancelled.length,
                    views: 0 // Mocked
                });
            }
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            setLoading(false);
        }
    }, [fetch]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const upcomingBookings = bookings.filter(b => {
        if (b.status !== 'CONFIRMED') return false;
        const bookingDate = new Date(b.start_date); // Assuming start_date
        return bookingDate >= new Date();
    });

    const filteredUpcoming = upcomingBookings.filter(b => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return b.booking_token?.toLowerCase().includes(q) ||
            b.location_code?.toLowerCase().includes(q);
    });

    return (
        <Page fullWidth>
            <style dangerouslySetInnerHTML={{ __html: DASHBOARD_STYLES }} />
            {/* Header Section */}
            <div style={{ marginBottom: '20px' }}>
                <InlineStack align="space-between" blockAlign="center">
                    <Text as="h1" variant="headingLg">Dashboard</Text>
                    <ButtonGroup>
                        <Button>FAQ</Button>
                        <Button variant="primary" icon={PlusIcon}>New service</Button>
                    </ButtonGroup>
                </InlineStack>
            </div>


            {/* Filters */}
            <div style={{ marginBottom: '20px' }}>
                <InlineStack gap="200">
                    <Button icon={<span style={{ marginRight: 4 }}>📅</span>}>Last 30 days</Button>
                    <Button>All services</Button>
                </InlineStack>
            </div>

            {/* Dashboard Grid Section */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
                gap: '20px',
                alignItems: 'stretch',
                marginBottom: '20px'
            }}>
                {/* Left Column: Stats + Chart */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <DashboardStats stats={stats} />
                    <div className="full-height-card-wrapper" style={{ flex: 1 }}>
                        <ProductInventory />
                    </div>
                </div>

                {/* Right Column: Calendar */}
                <div className="full-height-card-wrapper">
                    <BookingsCalendar bookings={bookings} />
                </div>
            </div>

            <Layout>
                {/* Upcoming Bookings Section */}
                <Layout.Section>
                    <div style={{ marginTop: '20px' }}>
                        <InlineStack gap="200" align="center" blockAlign="center">
                            <Text as="h2" variant="headingMd">Upcoming bookings</Text>
                            <div style={{ background: '#e4e5e7', color: 'black', borderRadius: '12px', padding: '0 8px', fontSize: '12px', fontWeight: 'bold' }}>
                                {upcomingBookings.length}
                            </div>
                        </InlineStack>

                        <div style={{ marginTop: '16px' }}>
                            <Card>
                                <Box padding="400">
                                    {/* Search Bar */}
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

                                    {/* Create Filter Buttons Row */}
                                    <div style={{ marginBottom: '16px' }}>
                                        <InlineStack gap="200" align="start">
                                            <Button icon={<span style={{ marginRight: 4 }}>📅</span>}>Upcoming</Button>
                                            <Button disclosure>All services</Button>
                                            <Button disclosure>All teammates</Button>
                                            <Button disclosure>All types</Button>
                                            <Button disclosure>All statuses</Button>
                                            <Button disclosure>Upsell</Button>
                                            <Button icon={ArrowUpIcon} />
                                            <Button icon={ExportIcon}>Export</Button>
                                        </InlineStack>
                                    </div>

                                    {/* Content */}
                                    {loading ? (
                                        <Box padding="1600">
                                            <InlineStack align="center"><Spinner size="large" /></InlineStack>
                                        </Box>
                                    ) : filteredUpcoming.length === 0 ? (
                                        <div style={{ padding: '60px 0', textAlign: 'center' }}>
                                            <SearchIcon style={{ width: 60, height: 60, color: '#8c9196', margin: '0 auto', display: 'block' }} />
                                            <div style={{ height: 16 }} />
                                            <Text as="h3" variant="headingMd">No bookings found</Text>
                                            <Text as="p" tone="subdued">Try changing the filters or search term</Text>
                                        </div>
                                    ) : (
                                        <div>
                                            {filteredUpcoming.slice(0, 5).map(booking => (
                                                <BookingCard key={booking.booking_token} booking={booking} />
                                            ))}
                                            {filteredUpcoming.length > 5 && (
                                                <Box padding="400">
                                                    <InlineStack align="center">
                                                        <Button variant="plain">View all upcoming bookings</Button>
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
                    <Text as="p" tone="subdued">Get help <a href="#" style={{ color: '#2c6ecb' }}>using this app</a> or <a href="#" style={{ color: '#2c6ecb' }}>read the FAQ</a></Text>
                </div>
            </Box>
        </Page>
    );
}
