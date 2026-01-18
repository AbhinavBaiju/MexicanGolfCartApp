import { Page, Layout, LegacyCard, IndexTable, Text, Select, Button, Modal, TextField, FormLayout, InlineError, Badge, Grid, Card, BlockStack, InlineStack, Box, Divider } from '@shopify/polaris';
import { useAuthenticatedFetch } from '../api';
import { useEffect, useState, useCallback } from 'react';

interface ProductInfo {
    product_id: number;
    title: string;
    image?: string;
    default_capacity: number;
}

interface ProductDefinition {
    id: number;
    title: string;
    image: string;
    price: string;
    features: string;
    totalAvailability: number;
    shopifyProductId: string;
}

interface InventoryDay {
    date: string;
    capacity: number;
    reserved_qty: number;
    p1_capacity?: number;
    p1_reserved?: number;
    p2_capacity?: number;
    p2_reserved?: number;
    p3_capacity?: number;
    p3_reserved?: number;
}

const INITIAL_PRODUCTS: ProductDefinition[] = [
    { id: 1, title: 'Golf Cart - 4 Seater', image: 'https://images.unsplash.com/photo-1593100126453-19b562a80028?auto=format&fit=crop&q=80&w=300', price: '$80/day', features: 'Electric, canopy, 4 seats', totalAvailability: 10, shopifyProductId: '' },
    { id: 2, title: 'Golf Cart - 6 Seater', image: 'https://images.unsplash.com/photo-1621946390176-75f850b69165?auto=format&fit=crop&q=80&w=300', price: '$120/day', features: 'High torque, long range, 6 seats', totalAvailability: 5, shopifyProductId: '' },
    { id: 3, title: 'Off-Road Special', image: 'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=300', price: '$150/day', features: 'Lifted, off-road tires, premium sound', totalAvailability: 3, shopifyProductId: '' },
];

export default function Inventory() {
    const fetch = useAuthenticatedFetch();
    const [products, setProducts] = useState<ProductInfo[]>([]);
    const [selectedProductId, setSelectedProductId] = useState<string>('');

    const [productDefinitions, setProductDefinitions] = useState<ProductDefinition[]>(INITIAL_PRODUCTS);
    const [inventory, setInventory] = useState<InventoryDay[]>([]);
    const [, setLoading] = useState(false);
    const [dateRange, setDateRange] = useState({
        month: new Date().getMonth(),
        year: new Date().getFullYear()
    });

    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editingDay, setEditingDay] = useState<InventoryDay | null>(null);
    const [caps, setCaps] = useState({ p1: '', p2: '', p3: '' });

    // Product Settings State
    const [productSettingsModalOpen, setProductSettingsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<ProductDefinition | null>(null);
    const [tempProdTitle, setTempProdTitle] = useState('');
    const [tempProdAvailability, setTempProdAvailability] = useState('');
    const [tempShopifyId, setTempShopifyId] = useState('');

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Load shopify products for linking
    useEffect(() => {
        fetch('/products').then(async (res) => {
            if (res.ok) {
                const data = await res.json();
                setProducts(data.products);
                if (data.products.length > 0 && !selectedProductId) {
                    setSelectedProductId(data.products[0].product_id.toString());
                }
            }
        });
    }, [fetch, selectedProductId]);

    const loadInventory = useCallback(async () => {
        // We use selectedProductId as a driver for the API call to get some dates
        const driverId = selectedProductId || (products.length > 0 ? products[0].product_id.toString() : '1');
        setLoading(true);

        const start = new Date(dateRange.year, dateRange.month, 1);
        const end = new Date(dateRange.year, dateRange.month + 1, 0);
        const formatDate = (d: Date) => d.toISOString().split('T')[0];

        try {
            const response = await fetch(`/inventory?product_id=${driverId}&start_date=${formatDate(start)}&end_date=${formatDate(end)}`);
            if (response.ok) {
                const data = await response.json();
                const enriched = data.inventory.map((day: InventoryDay) => ({
                    ...day,
                    p1_capacity: day.capacity,
                    p1_reserved: day.reserved_qty,
                    p2_capacity: productDefinitions[1].totalAvailability,
                    p2_reserved: 1,
                    p3_capacity: productDefinitions[2].totalAvailability,
                    p3_reserved: 0,
                }));
                setInventory(enriched);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [fetch, selectedProductId, products, dateRange, productDefinitions]);

    useEffect(() => {
        loadInventory();
    }, [loadInventory]);

    const handleMonthChange = (direction: 'prev' | 'next') => {
        setDateRange(prev => {
            let newMonth = prev.month + (direction === 'next' ? 1 : -1);
            let newYear = prev.year;
            if (newMonth > 11) { newMonth = 0; newYear++; }
            if (newMonth < 0) { newMonth = 11; newYear--; }
            return { month: newMonth, year: newYear };
        });
    };

    const handleEditDay = (day: InventoryDay) => {
        setEditingDay(day);
        setCaps({
            p1: (day.p1_capacity ?? day.capacity).toString(),
            p2: (day.p2_capacity ?? 0).toString(),
            p3: (day.p3_capacity ?? 0).toString(),
        });
        setEditModalOpen(true);
        setError(null);
    };

    const handleSaveDay = async () => {
        if (!editingDay || !selectedProductId) return;
        setSaving(true);
        try {
            const p1 = parseInt(caps.p1);
            if (isNaN(p1) || p1 < 0) throw new Error("Invalid capacity for Product 1");

            const data = {
                product_id: parseInt(selectedProductId),
                overrides: [
                    { date: editingDay.date, capacity: p1 }
                ]
            };

            const res = await fetch('/inventory', {
                method: 'PUT',
                body: JSON.stringify(data)
            });

            if (!res.ok) throw new Error('Failed to update');

            setEditModalOpen(false);
            loadInventory();

        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'An unknown error occurred');
        } finally {
            setSaving(false);
        }
    };

    const handleEditProduct = (prod: ProductDefinition) => {
        setEditingProduct(prod);
        setTempProdTitle(prod.title);
        setTempProdAvailability(prod.totalAvailability.toString());
        setTempShopifyId(prod.shopifyProductId);
        setProductSettingsModalOpen(true);
        setError(null);
    };

    const handleSaveProductSettings = () => {
        if (!editingProduct) return;

        const availability = parseInt(tempProdAvailability);
        if (isNaN(availability) || availability < 0) {
            setError("Invalid total availability");
            return;
        }

        setProductDefinitions(prev => prev.map(p =>
            p.id === editingProduct.id
                ? { ...p, title: tempProdTitle, totalAvailability: availability, shopifyProductId: tempShopifyId }
                : p
        ));

        setProductSettingsModalOpen(false);
        setEditingProduct(null);
    };

    const monthName = new Date(dateRange.year, dateRange.month, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    const shopifyProductOptions = products.map(p => ({ label: `${p.title} (ID: ${p.product_id})`, value: p.product_id.toString() }));
    shopifyProductOptions.unshift({ label: 'Select a Shopify Product', value: '' });

    return (
        <Page
            title="Inventory"
            titleMetadata={<Badge tone="info">{monthName}</Badge>}
            secondaryActions={[
                { content: 'Previous Month', onAction: () => handleMonthChange('prev') },
                { content: 'Next Month', onAction: () => handleMonthChange('next') }
            ]}
        >
            <BlockStack gap="500">
                <Grid>
                    {productDefinitions.map((prod) => (
                        <Grid.Cell key={prod.id} columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                            <Card padding="0">
                                <Box padding="0">
                                    <div style={{ height: '160px', overflow: 'hidden', borderTopLeftRadius: 'var(--p-border-radius-200)', borderTopRightRadius: 'var(--p-border-radius-200)' }}>
                                        <img src={prod.image} alt={prod.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    </div>
                                    <Box padding="400">
                                        <BlockStack gap="200">
                                            <InlineStack align="space-between">
                                                <Text variant="headingMd" as="h3">{prod.title}</Text>
                                                <Badge tone="success">{prod.price}</Badge>
                                            </InlineStack>
                                            <Text variant="bodySm" tone="subdued" as="p">{prod.features}</Text>
                                            <Divider />
                                            <InlineStack align="space-between">
                                                <Text variant="bodySm" tone="subdued" as="p">Capacity: <b>{prod.totalAvailability}</b></Text>
                                                <Button variant="plain" onClick={() => handleEditProduct(prod)}>Edit settings</Button>
                                            </InlineStack>
                                        </BlockStack>
                                    </Box>
                                </Box>
                            </Card>
                        </Grid.Cell>
                    ))}
                </Grid>

                <Layout>
                    <Layout.Section>
                        <LegacyCard>
                            <IndexTable
                                resourceName={{ singular: 'day', plural: 'days' }}
                                itemCount={inventory.length}
                                headings={[
                                    { title: 'Date' },
                                    { title: `${productDefinitions[0].title} (Avail/Total)` },
                                    { title: `${productDefinitions[1].title} (Avail/Total)` },
                                    { title: `${productDefinitions[2].title} (Avail/Total)` },
                                    { title: 'Action' },
                                ]}
                                selectable={false}
                            >
                                {inventory.map((day, index) => {
                                    const avail1 = (day.p1_capacity ?? 0) - (day.p1_reserved ?? 0);
                                    const avail2 = (day.p2_capacity ?? 0) - (day.p2_reserved ?? 0);
                                    const avail3 = (day.p3_capacity ?? 0) - (day.p3_reserved ?? 0);

                                    return (
                                        <IndexTable.Row id={day.date} key={day.date} position={index}>
                                            <IndexTable.Cell>
                                                <Text variant="bodyMd" fontWeight="bold" as="span">{day.date}</Text>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <InlineStack gap="200">
                                                    <Text as="span" tone={avail1 <= 0 ? 'critical' : 'success'}>{Math.max(0, avail1)}</Text>
                                                    <Text as="span" tone="subdued">/ {day.p1_capacity}</Text>
                                                </InlineStack>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <InlineStack gap="200">
                                                    <Text as="span" tone={avail2 <= 0 ? 'critical' : 'success'}>{Math.max(0, avail2)}</Text>
                                                    <Text as="span" tone="subdued">/ {day.p2_capacity}</Text>
                                                </InlineStack>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <InlineStack gap="200">
                                                    <Text as="span" tone={avail3 <= 0 ? 'critical' : 'success'}>{Math.max(0, avail3)}</Text>
                                                    <Text as="span" tone="subdued">/ {day.p3_capacity}</Text>
                                                </InlineStack>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <Button size="slim" onClick={() => handleEditDay(day)}>Update Avail.</Button>
                                            </IndexTable.Cell>
                                        </IndexTable.Row>
                                    );
                                })}
                            </IndexTable>
                        </LegacyCard>
                    </Layout.Section>
                </Layout>
            </BlockStack>

            {/* Daily Availability Modal */}
            <Modal
                open={editModalOpen}
                onClose={() => setEditModalOpen(false)}
                title={`Edit Availability for ${editingDay?.date}`}
                primaryAction={{
                    content: 'Save Changes',
                    onAction: handleSaveDay,
                    loading: saving,
                }}
                secondaryActions={[{ content: 'Cancel', onAction: () => setEditModalOpen(false) }]}
            >
                <Modal.Section>
                    <FormLayout>
                        {error && <InlineError message={error} fieldID="error" />}
                        <Grid>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                                <TextField
                                    label={`${productDefinitions[0].title} Capacity`}
                                    type="number"
                                    value={caps.p1}
                                    onChange={(v) => setCaps(prev => ({ ...prev, p1: v }))}
                                    autoComplete="off"
                                />
                            </Grid.Cell>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                                <TextField
                                    label={`${productDefinitions[1].title} Capacity`}
                                    type="number"
                                    value={caps.p2}
                                    onChange={(v) => setCaps(prev => ({ ...prev, p2: v }))}
                                    autoComplete="off"
                                />
                            </Grid.Cell>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                                <TextField
                                    label={`${productDefinitions[2].title} Capacity`}
                                    type="number"
                                    value={caps.p3}
                                    onChange={(v) => setCaps(prev => ({ ...prev, p3: v }))}
                                    autoComplete="off"
                                />
                            </Grid.Cell>
                        </Grid>
                    </FormLayout>
                </Modal.Section>
            </Modal>

            {/* Product Settings Modal */}
            <Modal
                open={productSettingsModalOpen}
                onClose={() => setProductSettingsModalOpen(false)}
                title={`Product Settings: ${editingProduct?.title}`}
                primaryAction={{
                    content: 'Save Settings',
                    onAction: handleSaveProductSettings,
                }}
                secondaryActions={[{ content: 'Cancel', onAction: () => setProductSettingsModalOpen(false) }]}
            >
                <Modal.Section>
                    <FormLayout>
                        {error && <InlineError message={error} fieldID="error" />}
                        <TextField
                            label="Local Product Name"
                            value={tempProdTitle}
                            onChange={setTempProdTitle}
                            autoComplete="off"
                            helpText="How this product will be named within the app."
                        />
                        <TextField
                            label="Total Availability"
                            type="number"
                            value={tempProdAvailability}
                            onChange={setTempProdAvailability}
                            autoComplete="off"
                            helpText="The base capacity of this product."
                        />
                        <Select
                            label="Link Shopify Product"
                            options={shopifyProductOptions}
                            value={tempShopifyId}
                            onChange={setTempShopifyId}
                            helpText="Connect this to an actual Shopify product for sync."
                        />
                    </FormLayout>
                </Modal.Section>
            </Modal>
        </Page>
    );
}
