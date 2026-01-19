import { Page, Layout, LegacyCard, IndexTable, Text, Button, Modal, TextField, FormLayout, InlineError, Badge, Grid, Card, BlockStack, InlineStack, Box, Divider } from '@shopify/polaris';
import { useAppBridge } from '@shopify/app-bridge-react';
import { useAuthenticatedFetch } from '../api';
import { useEffect, useState, useCallback, useMemo } from 'react';

// Shopify Product Type


// Result from /admin/products (Config)
interface ProductConfig {
    product_id: number;
    rentable: number;
    default_capacity: number;
    deposit_multiplier: number;
    updated_at: string;
}

// Combined View Model
interface ProductDefinition {
    id: number; // Shopify Product ID
    title: string;
    image: string;
    price: string; // Not in DB yet, mock or fetch from Shopify variants?
    features: string; // Not in DB, mock
    totalAvailability: number; // default_capacity
    shopifyProductId: string;
    isLinked: boolean;
}

interface InventoryDay {
    date: string;
    // Dynamic access by product_id
    [key: number]: { capacity: number; reserved: number };
}

export default function Inventory() {
    const fetch = useAuthenticatedFetch();

    // Data States
    const [productConfigs, setProductConfigs] = useState<ProductConfig[]>([]);
    const [inventory, setInventory] = useState<InventoryDay[]>([]);
    const [loading, setLoading] = useState(false);

    // View State
    const [dateRange, setDateRange] = useState({
        month: new Date().getMonth(),
        year: new Date().getFullYear()
    });

    // Modals
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editingDay, setEditingDay] = useState<string | null>(null);
    const [editingCaps, setEditingCaps] = useState<Record<number, string>>({}); // productId -> capacity string

    const [productSettingsModalOpen, setProductSettingsModalOpen] = useState(false);
    const [editingProductDiff, setEditingProductDiff] = useState<ProductDefinition | null>(null);
    // Temp states for modal
    const [tempProdAvailability, setTempProdAvailability] = useState('');
    const [tempShopifyId, setTempShopifyId] = useState('');

    const shopify = useAppBridge();

    const handleOpenProductPicker = useCallback(async () => {
        const selected = await shopify.resourcePicker({
            type: 'product',
            action: 'select',
            multiple: false,
        });

        if (selected && selected.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const product = selected[0] as any;
            // Extract numeric ID from GID (format: gid://shopify/Product/123456)
            const productId = product.id.split('/').pop();
            setTempShopifyId(productId);

            // Optionally fetch product details to show title
            // You can also store the title directly from product.title
        }
    }, [shopify]);

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 1. Fetch Configs on Mount
    useEffect(() => {
        const loadInitial = async () => {
            // Load Configs
            const configRes = await fetch('/products');
            if (configRes.ok) {
                const data = await configRes.json();
                setProductConfigs(data.products || []);
            }
        };
        loadInitial();
    }, [fetch]);

    // 2. Computed Product Definitions (Merged)
    const productDefinitions = useMemo<ProductDefinition[]>(() => {
        // If we have configs, show them.
        // We also want to support "Slots" logic if needed, but dynamic is better.
        // Let's map configs to definitions.
        if (productConfigs.length === 0) {
            // Return 3 empty slots if nothing configured so UI isn't empty?
            // Or just allow "Add". User asked for "Link to Product #1".
            // We'll show placeholders if empty, or mapped real ones.
            return [1, 2, 3].map(i => ({
                id: i * -1, // Negative ID for placeholder
                title: `Slot #${i} (Empty)`,
                image: '',
                price: '-',
                features: 'Link a Shopify Product',
                totalAvailability: 0,
                shopifyProductId: '',
                isLinked: false
            }));
        }

        return productConfigs.map(cfg => {
            return {
                id: cfg.product_id,
                title: `Product ${cfg.product_id}`,
                image: '',
                price: '$-/day', // Helper to fetch variant price if needed
                features: 'Standard features',
                totalAvailability: cfg.default_capacity,
                shopifyProductId: cfg.product_id.toString(),
                isLinked: true
            };
        });
    }, [productConfigs]);

    // 3. Load Inventory for Month based on productDefinitions
    const loadInventory = useCallback(async () => {
        const realProducts = productDefinitions.filter(p => p.isLinked);
        if (realProducts.length === 0) return;

        setLoading(true);
        const start = new Date(dateRange.year, dateRange.month, 1);
        const end = new Date(dateRange.year, dateRange.month + 1, 0);
        const startStr = start.toISOString().split('T')[0];
        const endStr = end.toISOString().split('T')[0];

        // Fetch inventory for EACH product (or optimize backend to accept multiple/all)
        // Backend handles one product at a time currently: /admin/inventory?product_id=...
        // We'll parallel fetch.
        try {
            const promises = realProducts.map(async p => {
                const res = await fetch(`/inventory?product_id=${p.id}&start_date=${startStr}&end_date=${endStr}`);
                if (res.ok) {
                    const data = await res.json();
                    return { pid: p.id, data: data.inventory };
                }
                return { pid: p.id, data: [] };
            });

            const results = await Promise.all(promises);

            // Merge into date-keyed object
            // Create list of all dates in month
            const dates: string[] = [];
            const curr = new Date(start);
            while (curr <= end) {
                dates.push(curr.toISOString().split('T')[0]);
                curr.setDate(curr.getDate() + 1);
            }

            const merged: InventoryDay[] = dates.map(date => {
                const dayObj: InventoryDay = { date };
                results.forEach(res => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const found = res.data.find((d: any) => d.date === date);
                    dayObj[res.pid] = found ? { capacity: found.capacity, reserved: found.reserved_qty } : { capacity: 0, reserved: 0 };
                    // Fallback to default capacity if not found in day overrides? 
                    // Backend /inventory returns default if no override exists.
                });
                return dayObj;
            });

            setInventory(merged);

        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }

    }, [fetch, productDefinitions, dateRange]);

    useEffect(() => {
        loadInventory();
    }, [loadInventory]);


    // Handlers
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
        setEditingDay(day.date);
        const caps: Record<number, string> = {};
        productDefinitions.filter(p => p.isLinked).forEach(p => {
            const d = day[p.id];
            caps[p.id] = d ? d.capacity.toString() : p.totalAvailability.toString();
        });
        setEditingCaps(caps);
        setEditModalOpen(true);
        setError(null);
    };

    const handleSaveDay = async () => {
        if (!editingDay) return;
        setSaving(true);
        try {
            // Send PUT for each product? Or backend update to batch?
            // Existing backend: PUT /inventory takes body { product_id, overrides: [{date, capacity}] }
            // Must loop.

            const promises = Object.keys(editingCaps).map(pidStr => {
                const pid = parseInt(pidStr);
                const val = parseInt(editingCaps[pid]);
                if (isNaN(val) || val < 0) return Promise.resolve();

                return fetch('/inventory', {
                    method: 'PUT',
                    body: JSON.stringify({
                        product_id: pid,
                        overrides: [{ date: editingDay, capacity: val }]
                    })
                });
            });

            await Promise.all(promises);
            setEditModalOpen(false);
            loadInventory();

        } catch (e: unknown) {
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    const handleEditProduct = (prod: ProductDefinition) => {
        setEditingProductDiff(prod);
        setTempProdAvailability(prod.totalAvailability.toString());
        setTempShopifyId(prod.isLinked ? prod.shopifyProductId : '');
        setProductSettingsModalOpen(true);
        setError(null);
    };

    const handleSaveProductSettings = async () => {
        if (!editingProductDiff) return;

        // The only reason this configuration will be used for is for adding the product to cart, if the product is booked through the booking form. (We will add the logic for this later, but mention it as a comment in the respsecitve area).

        // If linking a new ID, we are essentially Creating/Updating a config for that ID.
        // If we change ID, we must delete the old config to "swap" it.

        const newId = parseInt(tempShopifyId);
        const capacity = parseInt(tempProdAvailability);

        if (isNaN(newId) || newId <= 0) {
            setError("Please select a valid Shopify Product");
            return;
        }
        if (isNaN(capacity) || capacity < 0) {
            setError("Invalid capacity");
            return;
        }

        setSaving(true);
        try {
            // Check for swap
            const oldId = editingProductDiff.isLinked ? parseInt(editingProductDiff.shopifyProductId) : 0;
            if (oldId && oldId !== newId) {
                // Delete the old configuration
                await fetch(`/products/${oldId}`, { method: 'DELETE' });
            }

            const payload = {
                rentable: true,
                default_capacity: capacity,
                // defaults
                deposit_multiplier: 1
            };

            const res = await fetch(`/products/${newId}`, {
                method: 'PATCH',
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error("Failed to save product settings");

            // Refresh configs
            const configRes = await fetch('/products');
            if (configRes.ok) {
                const data = await configRes.json();
                setProductConfigs(data.products || []);
            }
            setProductSettingsModalOpen(false);
            setEditingProductDiff(null);

        } catch (e) {
            setError("Failed to save");
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    const monthName = new Date(dateRange.year, dateRange.month, 1).toLocaleString('default', { month: 'long', year: 'numeric' });



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
                                    <div style={{ height: '160px', overflow: 'hidden', borderTopLeftRadius: 'var(--p-border-radius-200)', borderTopRightRadius: 'var(--p-border-radius-200)', backgroundColor: '#f1f2f3' }}>
                                        {prod.image ? (
                                            <img src={prod.image} alt={prod.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8c9196' }}>No Image</div>
                                        )}
                                    </div>
                                    <Box padding="400">
                                        <BlockStack gap="200">
                                            <InlineStack align="space-between">
                                                <Text variant="headingMd" as="h3">{prod.title}</Text>
                                                {/* <Badge tone="success">{prod.price}</Badge> */}
                                            </InlineStack>
                                            <Text variant="bodySm" tone="subdued" as="p">{prod.isLinked ? `Capacity: ${prod.totalAvailability}` : 'Not Linked'}</Text>
                                            <Divider />
                                            <InlineStack align="space-between">
                                                <Button variant="plain" onClick={() => handleEditProduct(prod)}>
                                                    {prod.isLinked ? 'Edit settings' : 'Link Product'}
                                                </Button>
                                            </InlineStack>
                                        </BlockStack>
                                    </Box>
                                </Box>
                            </Card>
                        </Grid.Cell>
                    ))}
                    {/* Add Product Button if we want to allow more than slots? 
                        For now, the slots logic above handles it if we start empty.
                        But if we have configs, we show them. 
                        We might want a "Plus" Card to add more.*/}
                    {productConfigs.length < 3 && (
                        <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
                                <Button onClick={() => {
                                    setEditingProductDiff({
                                        id: 0,
                                        title: 'New Product',
                                        image: '',
                                        price: '',
                                        features: '',
                                        totalAvailability: 0,
                                        shopifyProductId: '',
                                        isLinked: false
                                    });
                                    setTempProdAvailability('10');
                                    setTempShopifyId('');
                                    setProductSettingsModalOpen(true);
                                }}>Add Product Configuration</Button>
                            </div>
                        </Grid.Cell>
                    )}
                </Grid>

                <Layout>
                    <Layout.Section>
                        <LegacyCard>
                            <IndexTable
                                resourceName={{ singular: 'day', plural: 'days' }}
                                itemCount={inventory.length}
                                headings={[
                                    { title: 'Date' },
                                    ...productDefinitions.filter(p => p.isLinked).map(p => ({ title: `${p.title} (Avail/Total)` })),
                                    { title: 'Action' }
                                ]}
                                selectable={false}
                                loading={loading}
                            >
                                {inventory.map((day, index) => (
                                    <IndexTable.Row id={day.date} key={day.date} position={index}>
                                        <IndexTable.Cell>
                                            <Text variant="bodyMd" fontWeight="bold" as="span">{day.date}</Text>
                                        </IndexTable.Cell>
                                        {productDefinitions.filter(p => p.isLinked).map(p => {
                                            const d = day[p.id];
                                            const cap = d ? d.capacity : p.totalAvailability;
                                            const res = d ? d.reserved : 0;
                                            const avail = cap - res;
                                            return (
                                                <IndexTable.Cell key={p.id}>
                                                    <InlineStack gap="200">
                                                        <Text as="span" tone={avail <= 0 ? 'critical' : 'success'}>{Math.max(0, avail)}</Text>
                                                        <Text as="span" tone="subdued">/ {cap}</Text>
                                                    </InlineStack>
                                                </IndexTable.Cell>
                                            );
                                        })}
                                        <IndexTable.Cell>
                                            <Button size="slim" onClick={() => handleEditDay(day)}>Update Avail.</Button>
                                        </IndexTable.Cell>
                                    </IndexTable.Row>
                                ))}
                            </IndexTable>
                        </LegacyCard>
                    </Layout.Section>
                </Layout>
            </BlockStack>

            {/* Daily Availability Modal */}
            <Modal
                open={editModalOpen}
                onClose={() => setEditModalOpen(false)}
                title={`Edit Availability for ${editingDay}`}
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
                            {productDefinitions.filter(p => p.isLinked).map(p => (
                                <Grid.Cell key={p.id} columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                                    <TextField
                                        label={`${p.title} Capacity`}
                                        type="number"
                                        value={editingCaps[p.id] || ''}
                                        onChange={(v) => setEditingCaps(prev => ({ ...prev, [p.id]: v }))}
                                        autoComplete="off"
                                    />
                                </Grid.Cell>
                            ))}
                        </Grid>
                    </FormLayout>
                </Modal.Section>
            </Modal>

            {/* Product Settings / Link Modal */}
            <Modal
                open={productSettingsModalOpen}
                onClose={() => setProductSettingsModalOpen(false)}
                title={editingProductDiff?.isLinked ? `Edit Settings: ${editingProductDiff.title}` : 'Link Shopify Product'}
                primaryAction={{
                    content: 'Save Settings',
                    onAction: handleSaveProductSettings,
                    loading: saving,
                }}
                secondaryActions={[{ content: 'Cancel', onAction: () => setProductSettingsModalOpen(false) }]}
            >
                <Modal.Section>
                    <FormLayout>
                        {error && <InlineError message={error} fieldID="error" />}

                        <BlockStack gap="400">
                            <Text as="p" variant="bodyMd">
                                {tempShopifyId ? `Selected Product ID: ${tempShopifyId}` : 'No product selected'}
                            </Text>
                            <Button
                                onClick={handleOpenProductPicker}
                            >
                                {tempShopifyId ? 'Change Product' : 'Select Shopify Product'}
                            </Button>
                        </BlockStack>

                        <TextField
                            label="Default Daily Capacity"
                            type="number"
                            value={tempProdAvailability}
                            onChange={setTempProdAvailability}
                            autoComplete="off"
                            helpText="The base count of items available per day."
                        />
                    </FormLayout>
                </Modal.Section>
            </Modal>
        </Page>
    );
}
