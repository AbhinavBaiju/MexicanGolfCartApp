import { Card, BlockStack, Text, InlineGrid, Box, Icon } from '@shopify/polaris';
import { ArrowUpIcon } from '@shopify/polaris-icons';

interface StatProps {
    title: string;
    value: string;
    percentage: string;
    trend?: 'up' | 'down';
}

function StatItem({ title, value, percentage, trend = 'up' }: StatProps) {
    return (
        <Box>
            <BlockStack gap="100">
                <Text as="h3" variant="headingSm" fontWeight="medium">{title}</Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Text as="p" variant="heading2xl" fontWeight="bold">{value}</Text>
                    <div style={{
                        color: trend === 'up' ? '#1a7f37' : '#b22d2d', // Success vs Critical colors
                        display: 'flex',
                        alignItems: 'center',
                        fontSize: '13px',
                        fontWeight: '600'
                    }}>
                        <Icon source={ArrowUpIcon} tone={trend === 'up' ? 'success' : 'critical'} />
                        {percentage}
                    </div>
                </div>
            </BlockStack>
        </Box>
    );
}

interface DashboardStatsProps {
    stats: {
        revenue: number;
        bookingsCount: number;
        cancelledCount: number;
        views: number;
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
                <InlineGrid columns={4} gap="400">
                    <StatItem title="Revenue" value={formatCurrency(stats.revenue)} percentage="0%" />
                    <StatItem title="Bookings" value={stats.bookingsCount.toString()} percentage="0%" />
                    <StatItem title="Cancelled bookings" value={stats.cancelledCount.toString()} percentage="0%" />
                    {/* Views has a tooltip/dropdown in screenshot, ignoring for now */}
                    <StatItem title="Views" value={stats.views.toString()} percentage="0%" />
                </InlineGrid>
            </Box>
        </Card>
    );
}
