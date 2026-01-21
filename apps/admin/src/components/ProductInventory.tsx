import { Card, Box, InlineStack, Text, Thumbnail, Spinner } from '@shopify/polaris';
import { useEffect, useState } from 'react';
import { useAuthenticatedFetch } from '../api';

interface ProductStats {
    product_id: number;
    count: number;
}

interface ShopifyProduct {
    id: number;
    title: string;
    images: { src: string }[];
}

interface ProductInventoryProps {
    stats: ProductStats[];
}

export function ProductInventory({ stats }: ProductInventoryProps) {
    const fetch = useAuthenticatedFetch();
    const [products, setProducts] = useState<ShopifyProduct[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadProducts() {
            try {
                const res = await fetch('/shopify-products');
                if (res.ok) {
                    const data = await res.json();
                    setProducts(data.products || []);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }
        loadProducts();
    }, [fetch]);

    if (loading) {
        return (
            <Card>
                <Box padding="400">
                    <InlineStack align="center"><Spinner size="small" /></InlineStack>
                </Box>
            </Card>
        );
    }

    // Filter to only products that have stats (or show all? let's show all configured ones that returned from shopify-products)
    // Actually, we should probably show all products we know about. 
    // But `shopify-products` returns ALL products from Shopify.
    // We only care about products that are configured in our app (which `stats` implies or we should fetch `/products`).
    // For now, let's just show products that have > 0 stats OR are in the list.
    // Better: Sort by booking count descending.

    const merged = products.map(p => {
        const stat = stats.find(s => s.product_id === p.id);
        return {
            ...p,
            totalBookings: stat ? stat.count : 0,
            revenue: 0, // We didn't solve per-product revenue yet
            remainingUnits: 0 // We aren't calculating live availability here yet
        };
    }).sort((a, b) => b.totalBookings - a.totalBookings).slice(0, 5); // Show top 5

    return (
        <Card>
            <Box padding="0" id="inventory-box">
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <Box padding="400">
                        <Text as="h3" variant="headingSm" tone="subdued">Top Performing Products</Text>
                    </Box>
                    {merged.map((product, index) => (
                        <div key={product.id}>
                            <Box padding="400">
                                <InlineStack align="space-between" blockAlign="center">
                                    {/* Left side: Image and Name */}
                                    <InlineStack gap="400" blockAlign="center">
                                        <Thumbnail
                                            source={product.images[0]?.src || ''}
                                            alt={product.title}
                                            size="large"
                                        />
                                        <div style={{ maxWidth: '200px' }}>
                                            <Text as="h3" variant="headingMd" fontWeight="semibold" truncate>
                                                {product.title}
                                            </Text>
                                        </div>
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
                                        {/* 
                                        <div style={{ textAlign: 'center', minWidth: '100px' }}>
                                            <Text as="p" variant="bodySm" tone="subdued">
                                                Revenue
                                            </Text>
                                            <Text as="p" variant="headingMd" fontWeight="semibold">
                                                -
                                            </Text>
                                        </div>
                                        */}
                                    </InlineStack>
                                </InlineStack>
                            </Box>
                            {/* Divider line between products */}
                            {index < merged.length - 1 && (
                                <div style={{
                                    borderBottom: '1px solid #e1e3e5',
                                    margin: '0'
                                }} />
                            )}
                        </div>
                    ))}
                    {merged.length === 0 && (
                        <Box padding="400"><Text as="p" tone="subdued">No product data available</Text></Box>
                    )}
                </div>
            </Box>
        </Card>
    );
}
