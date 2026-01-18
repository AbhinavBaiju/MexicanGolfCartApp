import { BlockStack, Text, InlineStack, Badge, Button } from '@shopify/polaris';
import { ViewIcon } from '@shopify/polaris-icons';

export interface Booking {
    booking_token: string;
    status: string;
    location_code: string;
    start_date: string;
    end_date: string;
    order_id: number | null;
    invalid_reason: string | null;
    created_at: string;
}

interface BookingCardProps {
    booking: Booking;
}

export function BookingCard({ booking }: BookingCardProps) {
    let badgeTone = 'info';
    if (booking.status === 'CONFIRMED') badgeTone = 'success';
    if (booking.status === 'EXPIRED' || booking.status === 'RELEASED') badgeTone = 'critical'; // Matching the prompt's "red" for expired/canceled usually, or subdued.
    // Screenshot shows generic buttons, but we'll adapt status.

    // Format dates
    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    };

    return (
        <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            marginBottom: '12px',
            border: '1px solid #e1e3e5'
        }}>
            <InlineStack align="space-between" blockAlign="start" gap="400" wrap={false}>
                {/* Left Section: Image and Info */}
                <InlineStack gap="400" wrap={false}>
                    {/* Image Placeholder */}
                    <div style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '8px',
                        backgroundColor: '#f1f2f3',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                    }}>
                        {/* Placeholder Icon or Image */}
                        <img
                            src="https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"
                            alt="Golf Cart"
                            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '8px', objectFit: 'cover' }}
                        />
                    </div>

                    {/* Info */}
                    <BlockStack gap="100">
                        <Text as="p" variant="bodyMd" fontWeight="semibold" tone="subdued">
                            #{booking.order_id || 'N/A'} • {booking.location_code}
                        </Text>
                        <Text as="h3" variant="headingMd">
                            {/* Since we don't have customer name, we use Token as title or similar */}
                            Booking {booking.booking_token.substring(0, 8)}
                        </Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                            {/* Address fallback */}
                            Location: {booking.location_code}
                        </Text>
                        <div style={{ marginTop: '4px' }}>
                            <Badge tone={badgeTone as any}>{booking.status}</Badge>
                        </div>
                    </BlockStack>
                </InlineStack>

                {/* Right Section: Actions and Date */}
                <BlockStack align="end" gap="400">
                    <InlineStack gap="200">
                        <Button icon={ViewIcon} variant="secondary" />
                        <Button variant="secondary">Manage</Button>
                        <Button variant="primary" tone="critical">Mark as Completed</Button>
                    </InlineStack>

                    <div style={{ backgroundColor: '#f1f2f3', padding: '8px 12px', borderRadius: '6px' }}>
                        <Text as="span" fontWeight="bold">
                            {formatDate(booking.start_date)} to {formatDate(booking.end_date)}
                        </Text>
                    </div>
                    <Text as="p" tone="subdued" alignment="end">
                        Quantity: 1
                    </Text>
                </BlockStack>
            </InlineStack>
        </div>
    );
}
