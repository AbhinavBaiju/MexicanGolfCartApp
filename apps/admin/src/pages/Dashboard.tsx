import {
    Page,
    Layout,
    Button,
    ButtonGroup,
    InlineStack,
    Box,
    Text,
    Banner,
    Select,
    TextField,
    Card
} from '@shopify/polaris';
import { SearchIcon, ExportIcon, ArrowUpIcon } from '@shopify/polaris-icons';
import { DashboardStats } from '../components/DashboardStats';
import { DashboardChart } from '../components/DashboardChart';
import { BookingsCalendar } from '../components/BookingsCalendar';

export default function Dashboard() {
    return (
        <Page fullWidth>
            {/* Header Section */}
            <div style={{ marginBottom: '20px' }}>
                <InlineStack align="space-between" blockAlign="center">
                    <Text as="h1" variant="headingLg">Dashboard</Text>
                    <ButtonGroup>
                        <Button>FAQ</Button>
                        <Button variant="primary" icon={<span style={{ fontSize: '16px' }}>+</span>}>New service</Button>
                    </ButtonGroup>
                </InlineStack>
            </div>

            {/* Config / Info Section */}
            <div style={{ marginBottom: '20px' }}>
                <Card>
                    <Box padding="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="400" blockAlign="center">
                                <Text as="span" fontWeight="bold">Cowlandar is</Text>
                                <div style={{ background: '#c1f3d3', color: '#0d5428', padding: '2px 8px', borderRadius: '4px', fontWeight: 600, fontSize: '12px' }}>
                                    enabled
                                </div>
                                <Text as="span">Language:</Text>
                                <div style={{ width: 80 }}>
                                    <Select label="Language" labelHidden options={[{ label: '🇺🇸', value: 'us' }]} onChange={() => { }} value="us" />
                                </div>
                            </InlineStack>
                            <InlineStack gap="200">
                                <Button>Vote for next features</Button>
                                <Button>Read recent app updates</Button>
                                <Button>Disable</Button>
                            </InlineStack>
                        </InlineStack>
                    </Box>
                </Card>
                <div style={{ marginTop: '12px' }}>
                    <Banner tone="warning">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="p"><span style={{ marginRight: '8px' }}>📷</span> Cowlandar enabled on your website <strong>Off</strong></Text>
                            <Button>Manage Cowlandar status</Button>
                        </InlineStack>
                    </Banner>
                </div>
            </div>

            {/* Filters */}
            <div style={{ marginBottom: '20px' }}>
                <InlineStack gap="200">
                    <Button icon={<span style={{ marginRight: 4 }}>📅</span>}>Last 30 days</Button>
                    <Button>All services</Button>
                </InlineStack>
            </div>

            <Layout>
                {/* Stats Row */}
                <Layout.Section>
                    <DashboardStats />
                </Layout.Section>

                {/* Chart Row */}
                <Layout.Section>
                    <DashboardChart />
                </Layout.Section>

                {/* Calendar Section */}
                <Layout.Section>
                    <BookingsCalendar />
                </Layout.Section>

                {/* Upcoming Bookings Section (Bottom of Image 1) */}
                <Layout.Section>
                    <div style={{ marginTop: '20px' }}>
                        <InlineStack gap="200" align="center" blockAlign="center">
                            <Text as="h2" variant="headingMd">Upcoming bookings</Text>
                            <div style={{ background: '#e4e5e7', color: 'black', borderRadius: '12px', padding: '0 8px', fontSize: '12px', fontWeight: 'bold' }}>0</div>
                        </InlineStack>

                        <div style={{ marginTop: '16px' }}>
                            <Card>
                                <Box padding="400">
                                    {/* Search Bar matching Image 1 */}
                                    <div style={{ marginBottom: '16px' }}>
                                        <TextField
                                            label="Search"
                                            labelHidden
                                            placeholder="Filter by customer name or email"
                                            value=""
                                            onChange={() => { }}
                                            autoComplete="off"
                                        />
                                    </div>

                                    {/* Filter Buttons */}
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

                                    {/* Empty State */}
                                    <div style={{ padding: '60px 0', textAlign: 'center' }}>
                                        <SearchIcon style={{ width: 60, height: 60, color: '#8c9196', margin: '0 auto' }} />
                                        <div style={{ height: 16 }} />
                                        <Text as="h3" variant="headingMd">No bookings found</Text>
                                        <Text as="p" tone="subdued">Try changing the filters or search term</Text>
                                    </div>
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
