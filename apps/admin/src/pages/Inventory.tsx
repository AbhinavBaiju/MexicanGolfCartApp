import { Page, Layout, LegacyCard, IndexTable, Text, Select, Button, Modal, TextField, FormLayout, InlineError, Badge } from '@shopify/polaris';
import { useAuthenticatedFetch } from '../api';
import { useEffect, useState, useCallback } from 'react';

interface ProductInfo {
    product_id: number;
    // ... other fields
}

interface InventoryDay {
    date: string;
    capacity: number;
    reserved_qty: number;
}

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
    const [newCapacity, setNewCapacity] = useState('');
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

        // Create start and end date for the month
        const start = new Date(dateRange.year, dateRange.month, 1);
        const end = new Date(dateRange.year, dateRange.month + 1, 0);

        // Format YYYY-MM-DD
        const formatDate = (d: Date) => d.toISOString().split('T')[0];

        try {
            const response = await fetch(`/inventory?product_id=${selectedProductId}&start_date=${formatDate(start)}&end_date=${formatDate(end)}`);
            if (response.ok) {
                const data = await response.json();
                setInventory(data.inventory);
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
        setNewCapacity(day.capacity.toString());
        setEditModalOpen(true);
        setError(null);
    };

    const handleSave = async () => {
        if (!editingDay || !selectedProductId) return;
        setSaving(true);
        try {
            const capacity = parseInt(newCapacity);
            if (isNaN(capacity) || capacity < 0) throw new Error("Invalid capacity");

            const data = {
                product_id: parseInt(selectedProductId),
                overrides: [
                    { date: editingDay.date, capacity }
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
            if (e instanceof Error) {
                setError(e.message);
            } else {
                setError('An unknown error occurred');
            }
        } finally {
            setSaving(false);
        }
    };

    const monthName = new Date(dateRange.year, dateRange.month, 1).toLocaleString('default', { month: 'long', year: 'numeric' });

    const productOptions = products.map(p => ({ label: `Product ID: ${p.product_id}`, value: p.product_id.toString() }));

    const resourceName = {
        singular: 'inventory day',
        plural: 'inventory days',
    };

    return (
        <Page
            title="Inventory"
            titleMetadata={<Badge tone="info">{monthName}</Badge>}
            secondaryActions={[
                { content: 'Previous Month', onAction: () => handleMonthChange('prev') },
                { content: 'Next Month', onAction: () => handleMonthChange('next') }
            ]}
        >
            <Layout>
                <Layout.Section>
                    <Select
                        label="Product"
                        options={productOptions}
                        value={selectedProductId}
                        onChange={setSelectedProductId}
                        disabled={loading}
                    />
                </Layout.Section>
                <Layout.Section>
                    <LegacyCard>
                        <IndexTable
                            resourceName={resourceName}
                            itemCount={inventory.length}
                            headings={[
                                { title: 'Date' },
                                { title: 'Capacity' },
                                { title: 'Reserved' },
                                { title: 'Available' },
                                { title: 'Action' },
                            ]}
                            selectable={false}
                        >
                            {inventory.map((day, index) => (
                                <IndexTable.Row id={day.date} key={day.date} position={index}>
                                    <IndexTable.Cell>
                                        <Text variant="bodyMd" fontWeight="bold" as="span">{day.date}</Text>
                                    </IndexTable.Cell>
                                    <IndexTable.Cell>{day.capacity}</IndexTable.Cell>
                                    <IndexTable.Cell>{day.reserved_qty}</IndexTable.Cell>
                                    <IndexTable.Cell>
                                        <Text as="span" tone={day.capacity - day.reserved_qty <= 0 ? 'critical' : 'success'}>
                                            {Math.max(0, day.capacity - day.reserved_qty)}
                                        </Text>
                                    </IndexTable.Cell>
                                    <IndexTable.Cell>
                                        <Button size="slim" onClick={() => handleEdit(day)}>Edit Capacity</Button>
                                    </IndexTable.Cell>
                                </IndexTable.Row>
                            ))}
                        </IndexTable>
                    </LegacyCard>
                </Layout.Section>
            </Layout>

            <Modal
                open={editModalOpen}
                onClose={() => setEditModalOpen(false)}
                title={`Edit Capacity for ${editingDay?.date}`}
                primaryAction={{
                    content: 'Save',
                    onAction: handleSave,
                    loading: saving,
                }}
                secondaryActions={[{ content: 'Cancel', onAction: () => setEditModalOpen(false) }]}
            >
                <Modal.Section>
                    <FormLayout>
                        {error && <InlineError message={error} fieldID="error" />}
                        <TextField
                            label="Capacity"
                            type="number"
                            value={newCapacity}
                            onChange={setNewCapacity}
                            autoComplete="off"
                        />
                    </FormLayout>
                </Modal.Section>
            </Modal>
        </Page>
    );
}
