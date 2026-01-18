import { Card, Text, Box, InlineStack, Button, Badge } from '@shopify/polaris';
import { ArrowLeftIcon, ArrowRightIcon } from '@shopify/polaris-icons';

export function BookingsCalendar() {
    // Generate simplified calendar grid
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const calendarDays = [];

    // Simple mock for January 2026 (starts Thursday)
    // 28, 29, 30, 31 (Dec 2025)
    // 1..31 (Jan 2026)
    // 1..7 (Feb)

    // Previous month filler
    for (let i = 28; i <= 31; i++) calendarDays.push({ day: i, month: 'prev' });
    // Current month
    for (let i = 1; i <= 31; i++) calendarDays.push({ day: i, month: 'curr' });
    // Next month filler (to 35 or 42 cells)
    for (let i = 1; i <= 7; i++) calendarDays.push({ day: i, month: 'next' });

    return (
        <Card>
            <Box padding="400">
                {/* Month Navigation */}
                <div style={{ marginBottom: '16px' }}>
                    <InlineStack align="space-between" blockAlign="center">
                        <Text as="h2" variant="headingLg">January 2026</Text>
                        <InlineStack gap="200">
                            <Button icon={ArrowLeftIcon} variant="plain" />
                            <Button icon={ArrowRightIcon} variant="plain" />
                        </InlineStack>
                    </InlineStack>
                    <InlineStack gap="200">
                        <Badge tone="info">0 booking</Badge>
                        <Badge tone="info">0 upcoming booking (Jan 18, 2026 → Jan 31, 2026)</Badge>
                    </InlineStack>
                </div>

                {/* Calendar Grid */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    gap: '8px',
                    textAlign: 'right'
                }}>
                    {days.map(d => (
                        <div key={d} style={{ fontWeight: 600, padding: '8px', color: '#5c5f62' }}>{d}</div>
                    ))}
                    {calendarDays.slice(0, 42).map((d, index) => (
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
                            <span style={{
                                fontWeight: d.day === 18 && d.month === 'curr' ? 'bold' : 'normal',
                                backgroundColor: d.day === 18 && d.month === 'curr' ? '#303030' : 'transparent',
                                color: d.day === 18 && d.month === 'curr' ? 'white' : 'inherit',
                                borderRadius: '50%',
                                width: '24px',
                                height: '24px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>{d.day}</span>
                        </div>
                    ))}
                </div>
            </Box>
        </Card>
    );
}

// Helper Badge import since I used it inside component
