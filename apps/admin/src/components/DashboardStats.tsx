import { Card, BlockStack, Text, InlineGrid, Box } from '@shopify/polaris';

interface StatProps {
    title: string;
    value: string;
}

function StatItem({ title, value }: StatProps) {
    return (
        <Box>
            <BlockStack gap="100">
                <Text as="h3" variant="headingSm" fontWeight="medium">{title}</Text>
                <Text as="p" variant="heading2xl" fontWeight="bold">{value}</Text>
            </BlockStack>
        </Box>
    );
}

interface DashboardStatsProps {
    stats: {
        revenue: number;
        bookingsCount: number;
        cancelledCount: number;
    };
}

export function DashboardStats({ stats }: DashboardStatsProps) {
    // Format currency
    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    };

    return (
        <Card>
            <Box padding="400">
                <InlineGrid columns={3} gap="400">
                    <StatItem title="Revenue" value={formatCurrency(stats.revenue)} />
                    <StatItem title="Bookings" value={stats.bookingsCount.toString()} />
                    <StatItem title="Cancelled bookings" value={stats.cancelledCount.toString()} />
                </InlineGrid>
            </Box>
        </Card>
    );
}
