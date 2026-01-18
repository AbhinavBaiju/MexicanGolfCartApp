import { Page, Layout, LegacyCard, ResourceList, ResourceItem, Text, Badge } from '@shopify/polaris';
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
    const [showAbandoned, setShowAbandoned] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadBookings = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            // User requested strict views
            if (showAbandoned) {
                params.append('status', 'EXPIRED');
            } else {
                params.append('status', 'CONFIRMED');
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
    }, [fetch, showAbandoned]);

    useEffect(() => {
        loadBookings();
    }, [loadBookings]);

    const resourceName = {
        singular: 'booking',
        plural: 'bookings',
    };

    return (
        <Page
            title={showAbandoned ? "Abandoned Bookings" : "Bookings"}
            secondaryActions={[
                {
                    content: showAbandoned ? 'Show Confirmed Bookings' : 'Show Abandoned Bookings',
                    onAction: () => setShowAbandoned(!showAbandoned),
                    accessibilityLabel: showAbandoned ? 'Switch to confirmed bookings' : 'Switch to abandoned bookings',
                }
            ]}
        >
            <Layout>
                <Layout.Section>
                    <LegacyCard>
                        {error && <div style={{ padding: '1rem', color: 'red' }}><Text as="p" tone="critical">{error}</Text></div>}
                        <ResourceList
                            resourceName={resourceName}
                            items={bookings}
                            loading={loading}
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
                                        onClick={() => { }}
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
