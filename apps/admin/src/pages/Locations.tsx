import { Page, Layout, LegacyCard, ResourceList, ResourceItem, Text, Modal, TextField, FormLayout, Badge, InlineError } from '@shopify/polaris';
import { useAuthenticatedFetch } from '../api';
import { useEffect, useState, useCallback } from 'react';

interface Location {
    id: number;
    code: string;
    name: string;
    lead_time_days: number;
    min_duration_days: number;
    active: number;
}

export default function Locations() {
    const fetch = useAuthenticatedFetch();
    const [locations, setLocations] = useState<Location[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [activeLocation, setActiveLocation] = useState<Partial<Location> | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadLocations = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch('/locations');
            if (response.ok) {
                const data = await response.json();
                setLocations(data.locations);
            }
        } catch (e: unknown) {
            console.error(e);
            /* if (e instanceof Error) console.error(e.message); */
        } finally {
            setLoading(false);
        }
    }, [fetch]);

    useEffect(() => {
        loadLocations();
    }, [loadLocations]);

    const handleEdit = (location: Location) => {
        setActiveLocation(location);
        setError(null);
        setModalOpen(true);
    };

    const handleAdd = () => {
        setActiveLocation({ lead_time_days: 1, min_duration_days: 1, active: 1 });
        setError(null);
        setModalOpen(true);
    };

    const handleSave = async () => {
        if (!activeLocation?.code || !activeLocation?.name) {
            setError("Code and Name are required");
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const method = activeLocation.id ? 'PATCH' : 'POST';
            const url = activeLocation.id ? `/locations/${activeLocation.id}` : '/locations';

            const payload = {
                code: activeLocation.code,
                name: activeLocation.name,
                lead_time_days: Number(activeLocation.lead_time_days),
                min_duration_days: Number(activeLocation.min_duration_days),
                active: Boolean(activeLocation.active)
            };

            const response = await fetch(url, {
                method,
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to save');
            }

            setModalOpen(false);
            loadLocations();
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

    const resourceName = {
        singular: 'location',
        plural: 'locations',
    };

    const items = locations.map((loc) => ({
        id: loc.id,
        url: '#',
        name: loc.name,
        code: loc.code,
        leadTime: `${loc.lead_time_days} days`,
        minDuration: `${loc.min_duration_days} days`,
        active: loc.active ? 'Active' : 'Inactive',
        status: loc.active ? 'success' : 'subdued',
        rawData: loc
    }));

    return (
        <Page
            title="Locations"
            primaryAction={{ content: 'Add Location', onAction: handleAdd }}
        >
            <Layout>
                <Layout.Section>
                    <LegacyCard>
                        <ResourceList
                            resourceName={resourceName}
                            items={items}
                            loading={loading}
                            renderItem={(item) => {
                                const { id, name, code, leadTime, minDuration, active, status, rawData } = item;
                                return (
                                    <ResourceItem
                                        id={id.toString()}
                                        url={item.url}
                                        onClick={() => handleEdit(rawData)}
                                        accessibilityLabel={`View details for ${name}`}
                                        name={name}
                                    >
                                        <Text variant="bodyMd" fontWeight="bold" as="h3">
                                            {name}
                                        </Text>
                                        <div>Code: {code}</div>
                                        <div>Lead Time: {leadTime} | Min Duration: {minDuration}</div>
                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                        <Badge tone={status as any}>{active}</Badge>
                                    </ResourceItem>
                                );
                            }}
                        />
                    </LegacyCard>
                </Layout.Section>
            </Layout>

            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title={activeLocation?.id ? "Edit Location" : "Add Location"}
                primaryAction={{
                    content: 'Save',
                    onAction: handleSave,
                    loading: saving,
                }}
                secondaryActions={[
                    {
                        content: 'Cancel',
                        onAction: () => setModalOpen(false),
                    },
                ]}
            >
                <Modal.Section>
                    <FormLayout>
                        {error && <InlineError message={error} fieldID="error" />}
                        <TextField
                            label="Name"
                            value={activeLocation?.name || ''}
                            onChange={(val) => setActiveLocation(prev => ({ ...prev, name: val }))}
                            autoComplete="off"
                        />
                        <TextField
                            label="Code"
                            value={activeLocation?.code || ''}
                            onChange={(val) => setActiveLocation(prev => ({ ...prev, code: val }))}
                            autoComplete="off"
                            helpText="Unique code for this location (e.g., LAX, SFO)"
                        />
                        <FormLayout.Group>
                            <TextField
                                label="Lead Time (Days)"
                                type="number"
                                value={activeLocation?.lead_time_days?.toString() || '1'}
                                onChange={(val) => setActiveLocation(prev => ({ ...prev, lead_time_days: parseInt(val) || 0 }))}
                                autoComplete="off"
                            />
                            <TextField
                                label="Min Duration (Days)"
                                type="number"
                                value={activeLocation?.min_duration_days?.toString() || '1'}
                                onChange={(val) => setActiveLocation(prev => ({ ...prev, min_duration_days: parseInt(val) || 0 }))}
                                autoComplete="off"
                            />
                        </FormLayout.Group>
                        {/* Simple Active Toggle can be implemented, for now assuming default true or boolean check */}
                    </FormLayout>
                </Modal.Section>
            </Modal>
        </Page>
    );
}
