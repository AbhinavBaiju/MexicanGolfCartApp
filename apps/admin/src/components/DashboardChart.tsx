import { Card, InlineStack, Checkbox, Box } from '@shopify/polaris';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useState, useMemo } from 'react';
import type { Booking } from './BookingCard';

interface DashboardChartProps {
    bookings: Booking[];
}

export function DashboardChart({ bookings }: DashboardChartProps) {
    const [activeSeries, setActiveSeries] = useState({
        revenue: true,
        bookings: true,
        cancelled: true,
        pos: true,
        manual: true,
        upsell: true,
    });

    const handleChange = (key: keyof typeof activeSeries) => (newChecked: boolean) => {
        setActiveSeries(prev => ({ ...prev, [key]: newChecked }));
    };

    // Calculate last 30 days data
    const chartData = useMemo(() => {
        const days = [];
        const today = new Date();
        for (let i = 29; i >= 0; i--) {
            const d = new Date();
            d.setDate(today.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            // Aggregate data for this day
            const dayBookings = bookings.filter(b => b.start_date.startsWith(dateStr));
            const revenue = dayBookings
                .filter(b => b.status === 'CONFIRMED')
                .reduce((acc, b) => acc + (Number(b.order_id) ? 100 : 0), 0); // Mock revenue logic as no price in Booking type yet

            const confirmedCount = dayBookings.filter(b => b.status === 'CONFIRMED').length;
            const cancelledCount = dayBookings.filter(b => b.status === 'CANCELLED' || b.status === 'EXPIRED').length;

            days.push({
                name: displayDate,
                revenue,
                bookings: confirmedCount,
                cancelled: cancelledCount,
                pos: 0,
                manual: 0,
                upsell: 0
            });
        }
        return days;
    }, [bookings]);

    return (
        <Card>
            <Box padding="400" minHeight="300px">
                <div style={{ width: '100%', height: 300 }}>
                    <ResponsiveContainer>
                        <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#f49342" stopOpacity={0.1} />
                                    <stop offset="95%" stopColor="#f49342" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={2} angle={-45} textAnchor="end" height={50} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <Tooltip />

                            {activeSeries.revenue && (
                                <Area type="monotone" dataKey="revenue" stroke="#f49342" fillOpacity={1} fill="url(#colorRevenue)" strokeWidth={2} />
                            )}
                            {activeSeries.bookings && (
                                <Area type="monotone" dataKey="bookings" stroke="#2c6ecb" fillOpacity={0} fill="transparent" strokeWidth={2} />
                            )}
                            {activeSeries.cancelled && (
                                <Area type="monotone" dataKey="cancelled" stroke="#d82c2c" fillOpacity={0} fill="transparent" strokeWidth={2} />
                            )}
                            {/* Add other series similarly with different colors */}
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                {/* Legend / Toggles */}
                <div style={{ marginTop: '20px', display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <InlineStack gap="400">
                        <Checkbox label="Revenue" checked={activeSeries.revenue} onChange={handleChange('revenue')} />
                        <Checkbox label="Bookings" checked={activeSeries.bookings} onChange={handleChange('bookings')} />
                        <Checkbox label="Cancelled bookings" checked={activeSeries.cancelled} onChange={handleChange('cancelled')} />
                        {/* Simplified for demo, can add others */}
                    </InlineStack>
                </div>
            </Box>
        </Card>
    );
}
