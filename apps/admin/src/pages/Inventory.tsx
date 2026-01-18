import { Page, Layout, LegacyCard, IndexTable, Text, Select, Button, Modal, TextField, FormLayout, InlineError, Badge, Grid, Card, BlockStack, InlineStack, Box } from '@shopify/polaris';
import { useAuthenticatedFetch } from '../api';
import { useEffect, useState, useCallback } from 'react';

interface ProductInfo {
    product_id: number;
    title: string;
    image?: string;
    default_capacity: number;
}

interface InventoryDay {
    date: string;
    capacity: number; // For product 1 (backward compat or generic)
    reserved_qty: number;
    // Multi-product support
    p1_capacity?: number;
    p1_reserved?: number;
    p2_capacity?: number;
    p2_reserved?: number;
    p3_capacity?: number;
    p3_reserved?: number;
}

const PLACEHOLDER_PRODUCTS = [
    { id: 1, title: 'Golf Cart - 4 Seater', image: 'https://images.unsplash.com/photo-1593100126453-19b562a80028?auto=format&fit=crop&q=80&w=300', price: '$80/day', features: 'Electric, canopy, 4 seats' },
    { id: 2, title: 'Golf Cart - 6 Seater', image: 'https://images.unsplash.com/photo-1621946390176-75f850b69165?auto=format&fit=crop&q=80&w=300', price: '$120/day', features: 'High torque, long range, 6 seats' },
    { id: 3, title: 'Off-Road Special', image: 'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=300', price: '$150/day', features: 'Lifted, off-road tires, premium sound' },
];

export default function Inventory() {
    const fetch = useAuthenticatedFetch();
    const [products, setProducts] = useState<ProductInfo[]>([]);
    const [selectedProductId, setSelectedProductId] = useState<string>('');

    const [inventory, setInventory] = useState<InventoryDay[]>([]);
    const [loading, setLoading] = useState(false);
    const [dateRange, setDateRange] = useState({
        month: new Date().getMonth(),
        year: new Date().getFullYear()
    });

    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editingDay, setEditingDay] = useState<InventoryDay | null>(null);
    const [caps, setCaps] = useState({ p1: '', p2: '', p3: '' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Load products
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
        if (!selectedProductId) return;
        setLoading(true);

        const start = new Date(dateRange.year, dateRange.month, 1);
        const end = new Date(dateRange.year, dateRange.month + 1, 0);
        const formatDate = (d: Date) => d.toISOString().split('T')[0];

        try {
            const response = await fetch(`/inventory?product_id=${selectedProductId}&start_date=${formatDate(start)}&end_date=${formatDate(end)}`);
            if (response.ok) {
                const data = await response.json();
                // Map the data to include placeholder multi-product info if not present
                const enriched = data.inventory.map((day: any) => ({
                    ...day,
                    p1_capacity: day.capacity,
                    p1_reserved: day.reserved_qty,
                    p2_capacity: 5, // Placeholder
                    p2_reserved: 1, // Placeholder
                    p3_capacity: 3, // Placeholder
                    p3_reserved: 0, // Placeholder
                }));
                setInventory(enriched);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [fetch, selectedProductId, dateRange]);

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

    const handleEdit = (day: InventoryDay) => {
        setEditingDay(day);
        setCaps({
            p1: (day.p1_capacity ?? day.capacity).toString(),
            p2: (day.p2_capacity ?? 0).toString(),
            p3: (day.p3_capacity ?? 0).toString(),
        });
        setEditModalOpen(true);
        setError(null);
    };

    const handleSave = async () => {
        if (!editingDay || !selectedProductId) return;
        setSaving(true);
        try {
            // In a real app, we'd send multiple updates or a batch update.
            // For now, we'll just update the primary one to show it works.
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

    const monthName = new Date(dateRange.year, dateRange.month, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    const productOptions = products.map(p => ({ label: `Product ID: ${p.product_id}`, value: p.product_id.toString() }));

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
                    {PLACEHOLDER_PRODUCTS.map((prod) => (
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
                                            <Text variant="bodySm" tone="subdued">{prod.features}</Text>
                                        </BlockStack>
                                    </Box>
                                </Box>
                            </Card>
                        </Grid.Cell>
                    ))}
                </Grid>

                <Layout>
                    <Layout.Section>
                        <Select
                            label="Filter Settings (Development)"
                            options={productOptions}
                            value={selectedProductId}
                            onChange={setSelectedProductId}
                            disabled={loading}
                        />
                    </Layout.Section>
                    <Layout.Section>
                        <LegacyCard>
                            <IndexTable
                                resourceName={{ singular: 'day', plural: 'days' }}
                                itemCount={inventory.length}
                                headings={[
                                    { title: 'Date' },
                                    { title: 'Product 1 (Avail/Total)' },
                                    { title: 'Product 2 (Avail/Total)' },
                                    { title: 'Product 3 (Avail/Total)' },
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
                                                <Button size="slim" onClick={() => handleEdit(day)}>Edit All</Button>
                                            </IndexTable.Cell>
                                        </IndexTable.Row>
                                    );
                                })}
                            </IndexTable>
                        </LegacyCard>
                    </Layout.Section>
                </Layout>
            </BlockStack>

            <Modal
                open={editModalOpen}
                onClose={() => setEditModalOpen(false)}
                title={`Edit Availability for ${editingDay?.date}`}
                primaryAction={{
                    content: 'Save Changes',
                    onAction: handleSave,
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
                                    label="Product 1 Capacity"
                                    type="number"
                                    value={caps.p1}
                                    onChange={(v) => setCaps(prev => ({ ...prev, p1: v }))}
                                    autoComplete="off"
                                />
                            </Grid.Cell>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                                <TextField
                                    label="Product 2 Capacity"
                                    type="number"
                                    value={caps.p2}
                                    onChange={(v) => setCaps(prev => ({ ...prev, p2: v }))}
                                    autoComplete="off"
                                />
                            </Grid.Cell>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                                <TextField
                                    label="Product 3 Capacity"
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
        </Page>
    );
}
