import { Card, Text, Box, InlineStack, Button, Badge } from '@shopify/polaris';
import { ArrowLeftIcon, ArrowRightIcon } from '@shopify/polaris-icons';
import { useState, useMemo } from 'react';
import type { Booking } from './BookingCard';

interface BookingsCalendarProps {
    bookings?: Booking[];
}

export function BookingsCalendar({ bookings = [] }: BookingsCalendarProps) {
    const [currentDate, setCurrentDate] = useState(new Date());

    const monthName = currentDate.toLocaleString('default', { month: 'long' });
    const year = currentDate.getFullYear();

    const calendarData = useMemo(() => {
        const days = [];
        const firstDayOfMonth = new Date(year, currentDate.getMonth(), 1);
        const lastDayOfMonth = new Date(year, currentDate.getMonth() + 1, 0);

        // Days from previous month to fill start
        // 0 = Sunday, 1 = Monday, ...
        const startDay = firstDayOfMonth.getDay();
        for (let i = startDay - 1; i >= 0; i--) {
            const d = new Date(year, currentDate.getMonth(), -i);
            days.push({ day: d.getDate(), month: 'prev', date: d });
        }

        // Current month
        for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
            const d = new Date(year, currentDate.getMonth(), i);
            days.push({ day: d.getDate(), month: 'curr', date: d });
        }

        // Next month to fill grid (42 cells total usually covers all)
        const remaining = 42 - days.length;
        for (let i = 1; i <= remaining; i++) {
            const d = new Date(year, currentDate.getMonth() + 1, i);
            days.push({ day: d.getDate(), month: 'next', date: d });
        }

        return days.map(d => {
            // Count bookings for this day
            const dateStr = d.date.toISOString().split('T')[0];
            const count = bookings.filter(b => b.start_date.startsWith(dateStr)).length;
            return { ...d, count };
        });
    }, [currentDate, bookings, year]);

    const handlePrevMonth = () => {
        setCurrentDate(new Date(year, currentDate.getMonth() - 1, 1));
    };

    const handleNextMonth = () => {
        setCurrentDate(new Date(year, currentDate.getMonth() + 1, 1));
    };

    const currentMonthBookings = bookings.filter(b => {
        const d = new Date(b.start_date);
        return d.getMonth() === currentDate.getMonth() && d.getFullYear() === year;
    }).length;

    const today = new Date();

    return (
        <Card>
            <Box padding="400">
                {/* Month Navigation */}
                <div style={{ marginBottom: '16px' }}>
                    <InlineStack align="space-between" blockAlign="center">
                        <Text as="h2" variant="headingLg">{monthName} {year}</Text>
                        <InlineStack gap="200">
                            <Button icon={ArrowLeftIcon} variant="plain" onClick={handlePrevMonth} />
                            <Button icon={ArrowRightIcon} variant="plain" onClick={handleNextMonth} />
                        </InlineStack>
                    </InlineStack>
                    <InlineStack gap="200">
                        <Badge tone="info">{`${currentMonthBookings} booking${currentMonthBookings !== 1 ? 's' : ''}`}</Badge>
                        {/* Simplified "upcoming" text */}
                    </InlineStack>
                </div>

                {/* Calendar Grid */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    gap: '8px',
                    textAlign: 'right'
                }}>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                        <div key={d} style={{ fontWeight: 600, padding: '8px', color: '#5c5f62' }}>{d}</div>
                    ))}
                    {calendarData.map((d, index) => {
                        const isToday = d.date.toDateString() === today.toDateString();
                        return (
                            <div key={index} style={{
                                height: '80px',
                                border: '1px solid #e1e3e5',
                                borderRadius: '4px',
                                padding: '8px',
                                backgroundColor: d.month === 'curr' ? 'white' : '#f9fafb',
                                color: d.month === 'curr' ? 'black' : '#8c9196',
                                fontSize: '14px',
                                position: 'relative'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    {d.count > 0 && (
                                        <div style={{
                                            background: '#c1f3d3', color: '#0d5428',
                                            borderRadius: '50%', width: '16px', height: '16px',
                                            fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                        }}>
                                            {d.count}
                                        </div>
                                    )}
                                    <span style={{
                                        fontWeight: isToday ? 'bold' : 'normal',
                                        backgroundColor: isToday ? '#303030' : 'transparent',
                                        color: isToday ? 'white' : 'inherit',
                                        borderRadius: '50%',
                                        width: '24px',
                                        height: '24px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        marginLeft: 'auto'
                                    }}>{d.day}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </Box>
        </Card>
    );
}
