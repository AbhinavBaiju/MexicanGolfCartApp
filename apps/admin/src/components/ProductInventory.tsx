import { Card, Box, InlineStack, Text, Thumbnail } from '@shopify/polaris';

interface Product {
    id: string;
    name: string;
    image: string;
    totalBookings: number;
    revenue: number;
    remainingUnits: number;
}

const PLACEHOLDER_PRODUCTS: Product[] = [
    {
        id: '1',
        name: 'Standard Golf Cart',
        image: '/assets/standard_golf_cart.png',
        totalBookings: 45,
        revenue: 4500,
        remainingUnits: 8
    },
    {
        id: '2',
        name: 'Premium Golf Cart',
        image: '/assets/premium_golf_cart.png',
        totalBookings: 32,
        revenue: 6400,
        remainingUnits: 5
    },
    {
        id: '3',
        name: 'Luxury Golf Cart',
        image: '/assets/luxury_golf_cart.png',
        totalBookings: 28,
        revenue: 8400,
        remainingUnits: 3
    }
];

export function ProductInventory() {
    return (
        <div style={{ height: '100%', width: '100%' }}>
            <Card>
                <Box padding="0" id="inventory-box">
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1 }}>
                        {PLACEHOLDER_PRODUCTS.map((product, index) => (
                            <div key={product.id}>
                                <Box padding="400">
                                    <InlineStack align="space-between" blockAlign="center">
                                        {/* Left side: Image and Name */}
                                        <InlineStack gap="400" blockAlign="center">
                                            <Thumbnail
                                                source={product.image}
                                                alt={product.name}
                                                size="large"
                                            />
                                            <Text as="h3" variant="headingMd" fontWeight="semibold">
                                                {product.name}
                                            </Text>
                                        </InlineStack>

                                        {/* Right side: Stats */}
                                        <InlineStack gap="600" blockAlign="center">
                                            <div style={{ textAlign: 'center', minWidth: '100px' }}>
                                                <Text as="p" variant="bodySm" tone="subdued">
                                                    Total Bookings
                                                </Text>
                                                <Text as="p" variant="headingMd" fontWeight="semibold">
                                                    {product.totalBookings}
                                                </Text>
                                            </div>
                                            <div style={{ textAlign: 'center', minWidth: '100px' }}>
                                                <Text as="p" variant="bodySm" tone="subdued">
                                                    Revenue
                                                </Text>
                                                <Text as="p" variant="headingMd" fontWeight="semibold">
                                                    ${product.revenue.toLocaleString()}
                                                </Text>
                                            </div>
                                            <div style={{ textAlign: 'center', minWidth: '100px' }}>
                                                <Text as="p" variant="bodySm" tone="subdued">
                                                    Available
                                                </Text>
                                                <Text as="p" variant="headingMd" fontWeight="semibold">
                                                    {product.remainingUnits}
                                                </Text>
                                            </div>
                                        </InlineStack>
                                    </InlineStack>
                                </Box>
                                {/* Divider line between products */}
                                {index < PLACEHOLDER_PRODUCTS.length - 1 && (
                                    <div style={{
                                        borderBottom: '1px solid #e1e3e5',
                                        margin: '0'
                                    }} />
                                )}
                            </div>
                        ))}
                    </div>
                </Box>
            </Card>
        </div>
    );
}
