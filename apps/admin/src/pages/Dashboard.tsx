import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Page,
    Layout,
    Card,
    Text,
    BlockStack,
    InlineGrid,
    Badge,
    Spinner,
    DataTable,
    Banner,
    Link,
    Box,
    Divider,
    Button
} from '@shopify/polaris';
import { useAuthenticatedFetch } from '../api';

interface BookingSummary {
    booking_token: string;
    location_code: string;
    status: string;
    start_date?: string;
    end_date?: string;
    order_id?: string;
    created_at?: string;
    invalid_reason?: string;
}

interface DashboardData {
    todayDate: string;
    stats: {
        active_bookings: number;
        pending_holds: number;
    };
    todayActivity: {
        pickups: BookingSummary[];
        dropoffs: BookingSummary[];
    };
    upcomingBookings: BookingSummary[];
    recentHistory: BookingSummary[];
}

export default function Dashboard() {
    const fetchAuth = useAuthenticatedFetch();
    const fetchRef = useRef(fetchAuth);
    fetchRef.current = fetchAuth;

    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchRef.current('/dashboard');
            if (res.ok) {
                const json = await res.json();
                if (json.ok) {
                    setData(json);
                } else {
                    setError(json.error || 'Failed to load dashboard data');
                }
            } else {
                setError(`Request failed with status ${res.status}`);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    if (loading) {
        return (
            <Page title="Dashboard">
                <Box padding="1600" width="100%">
                    <BlockStack align="center" inlineAlign="center">
                        <Spinner size="large" />
                        <Text as="p" tone="subdued">Loading dashboard...</Text>
                    </BlockStack>
                </Box>
            </Page>
        );
    }

    if (error || !data) {
        return (
            <Page title="Dashboard">
                <Banner tone="critical" title="Error loading dashboard">
                    <p>{error}</p>
                    <Button onClick={loadData}>Retry</Button>
                </Banner>
            </Page>
        );
    }

    const { stats, todayActivity, upcomingBookings, recentHistory, todayDate } = data;

    return (
        <Page
            title="Dashboard"
            subtitle={`Overview for ${todayDate}`}
            primaryAction={<Button variant="plain" onClick={loadData}>Refresh</Button>}
        >
            <BlockStack gap="600">
                {/* Quick Stats */}
                <Layout>
                    <Layout.Section>
                        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                            <StatCard title="Active Bookings" value={stats.active_bookings} />
                            <StatCard
                                title="Pending Holds"
                                value={stats.pending_holds}
                                tone={stats.pending_holds > 0 ? 'critical' : undefined}
                            />
                            <StatCard title="Pickups Today" value={todayActivity.pickups.length} />
                            <StatCard title="Dropoffs Today" value={todayActivity.dropoffs.length} />
                        </InlineGrid>
                    </Layout.Section>

                    {/* Today's Activity */}
                    <Layout.Section variant="oneHalf">
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h3" variant="headingSm">Pickups Today</Text>
                                <Divider />
                                {todayActivity.pickups.length === 0 ? (
                                    <Text as="p" tone="subdued">No pickups scheduled for today.</Text>
                                ) : (
                                    <BlockStack gap="200">
                                        {todayActivity.pickups.map(b => (
                                            <BookingRow key={b.booking_token} booking={b} type="pickup" />
                                        ))}
                                    </BlockStack>
                                )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>

                    <Layout.Section variant="oneHalf">
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h3" variant="headingSm">Dropoffs Today</Text>
                                <Divider />
                                {todayActivity.dropoffs.length === 0 ? (
                                    <Text as="p" tone="subdued">No dropoffs scheduled for today.</Text>
                                ) : (
                                    <BlockStack gap="200">
                                        {todayActivity.dropoffs.map(b => (
                                            <BookingRow key={b.booking_token} booking={b} type="dropoff" />
                                        ))}
                                    </BlockStack>
                                )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>

                    {/* Upcoming Bookings */}
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h3" variant="headingSm">Upcoming Bookings</Text>
                                {upcomingBookings.length === 0 ? (
                                    <Text as="p" tone="subdued">No upcoming confirmed bookings found.</Text>
                                ) : (
                                    <DataTable
                                        columnContentTypes={['text', 'text', 'text', 'text']}
                                        headings={['Date Range', 'Location', 'Token', 'Status']}
                                        rows={upcomingBookings.map(b => [
                                            `${b.start_date} - ${b.end_date}`,
                                            b.location_code,
                                            <Link key={b.booking_token} url={`/bookings/${b.booking_token}`}>{b.booking_token.slice(0, 8)}...</Link>,
                                            <StatusBadge key={`status-${b.booking_token}`} status={b.status} />
                                        ])}
                                    />
                                )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>

                    {/* History */}
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h3" variant="headingSm">Recent History</Text>
                                {recentHistory.length === 0 ? (
                                    <Text as="p" tone="subdued">No recent history.</Text>
                                ) : (
                                    <DataTable
                                        columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                                        headings={['Created At', 'Token', 'Date Range', 'Status', 'Notes']}
                                        rows={recentHistory.map(b => [
                                            new Date(b.created_at || '').toLocaleDateString() + ' ' + new Date(b.created_at || '').toLocaleTimeString(),
                                            <Link key={b.booking_token} url={`/bookings/${b.booking_token}`}>{b.booking_token.slice(0, 8)}...</Link>,
                                            `${b.start_date} -> ${b.end_date}`,
                                            <StatusBadge key={`status-${b.booking_token}`} status={b.status} />,
                                            b.invalid_reason || '-'
                                        ])}
                                    />
                                )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </BlockStack>
        </Page>
    );
}

function StatCard({ title, value, tone }: { title: string, value: number, tone?: 'critical' | 'success' | 'subdued' }) {
    return (
        <Card>
            <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">{title}</Text>
                <Text as="p" variant="heading3xl" tone={tone}>{value}</Text>
            </BlockStack>
        </Card>
    );
}

function BookingRow({ booking, type }: { booking: BookingSummary, type: 'pickup' | 'dropoff' }) {
    return (
        <InlineGrid columns={['oneThird', 'twoThirds']} alignItems="center">
            <Link url={`/bookings/${booking.booking_token}`}>{booking.booking_token.slice(0, 8)}...</Link>
            <BlockStack>
                <Text as="span" variant="bodySm">{booking.location_code}</Text>
                <Text as="span" variant="bodyXs" tone="subdued">{type === 'pickup' ? 'Pickup' : 'Dropoff'}</Text>
                {booking.order_id && <Text as="span" variant="bodyXs" tone="subdued">Order: {booking.order_id}</Text>}
            </BlockStack>
        </InlineGrid>
    );
}

function StatusBadge({ status }: { status: string }) {
    let tone: 'success' | 'attention' | 'critical' | 'info' | undefined = 'info';
    if (status === 'confirmed') tone = 'success';
    if (status === 'hold') tone = 'attention';
    if (status === 'expired') tone = 'critical';
    if (status === 'released') tone = undefined;

    return <Badge tone={tone}>{status.toUpperCase()}</Badge>;
}
