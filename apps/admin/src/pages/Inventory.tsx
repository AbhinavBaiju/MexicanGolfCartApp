import {
    Badge,
    BlockStack,
    Box,
    Button,
    ButtonGroup,
    Card,
    Checkbox,
    FormLayout,
    IndexTable,
    InlineError,
    InlineStack,
    Modal,
    Page,
    Select,
    Text,
    TextField,
} from '@shopify/polaris';
import { useAppBridge } from '@shopify/app-bridge-react';
import { useAuthenticatedFetch } from '../api';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface ProductConfig {
    product_id: number;
    variant_id: number | null;
    rentable: number | boolean;
    default_capacity: number;
    deposit_multiplier?: number | null;
    updated_at?: string;
}

interface FeaturedHomeProduct {
    position: number;
    product_id: number;
    variant_id?: number | null;
    rentable?: number;
}

interface ShopifyVariantSummary {
    id: number;
    title: string;
}

interface ShopifyProductSummary {
    id: number;
    title: string;
    status: string;
    product_url: string | null;
    template_suffix: string | null;
    images: Array<{ src: string }>;
    variants: ShopifyVariantSummary[];
}

interface RentableDraft {
    rentable: boolean;
    default_capacity: string;
    variant_id: string;
}

interface InventoryCell {
    capacity: number;
    reserved: number;
}

interface InventoryRow {
    date: string;
    cells: Record<number, InventoryCell>;
}

interface ResourcePickerProduct {
    productId: number;
    variantId: number | null;
}

interface ResourcePickerBridge {
    resourcePicker: (options: {
        type: 'product';
        action: 'select';
        multiple: boolean;
    }) => Promise<unknown>;
}

interface TemplateSyncResultItem {
    product_id: number;
    sync_ok: boolean;
    error?: string;
}

interface TemplateSyncResponse {
    ok?: boolean;
    results?: TemplateSyncResultItem[];
    error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toBoolean(value: boolean | number | null | undefined): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    return false;
}

function parseNumericId(value: string | number | null | undefined): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return value;
    }
    if (typeof value === 'string') {
        const tail = value.split('/').pop() ?? value;
        const parsed = Number(tail);
        if (Number.isInteger(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return null;
}

function formatDateYmd(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getProductImageUrl(product: ShopifyProductSummary | undefined): string | null {
    if (!product || !Array.isArray(product.images) || product.images.length === 0) {
        return null;
    }
    const first = product.images[0]?.src;
    return typeof first === 'string' && first.trim().length > 0 ? first : null;
}

function markIdsAsTrue(
    previous: Record<number, boolean>,
    ids: number[]
): Record<number, boolean> {
    const next = { ...previous };
    ids.forEach((id) => {
        next[id] = true;
    });
    return next;
}

function clearIdsFromBooleanMap(
    previous: Record<number, boolean>,
    ids: number[]
): Record<number, boolean> {
    const next = { ...previous };
    ids.forEach((id) => {
        delete next[id];
    });
    return next;
}

function clearIdsFromStringMap(
    previous: Record<number, string>,
    ids: number[]
): Record<number, string> {
    const next = { ...previous };
    ids.forEach((id) => {
        delete next[id];
    });
    return next;
}

export default function Inventory() {
    const authenticatedFetch = useAuthenticatedFetch();
    const appBridge = useAppBridge() as unknown as ResourcePickerBridge;

    const [productConfigs, setProductConfigs] = useState<ProductConfig[]>([]);
    const [shopifyProducts, setShopifyProducts] = useState<ShopifyProductSummary[]>([]);
    const [featuredSlots, setFeaturedSlots] = useState<Array<number | null>>([null, null, null]);
    const [rowDrafts, setRowDrafts] = useState<Record<number, RentableDraft>>({});
    const [searchQuery, setSearchQuery] = useState('');

    const [loadingPage, setLoadingPage] = useState(true);
    const [savingFeatured, setSavingFeatured] = useState(false);
    const [savingRowId, setSavingRowId] = useState<number | null>(null);
    const [addingRentable, setAddingRentable] = useState(false);
    const [templateSyncingByProductId, setTemplateSyncingByProductId] = useState<Record<number, boolean>>({});
    const [templateSyncErrorByProductId, setTemplateSyncErrorByProductId] = useState<Record<number, string>>({});
    const [autoSyncedMismatchByProductId, setAutoSyncedMismatchByProductId] = useState<Record<number, boolean>>({});

    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const [dateRange, setDateRange] = useState({
        month: new Date().getMonth(),
        year: new Date().getFullYear(),
    });
    const [inventoryRows, setInventoryRows] = useState<InventoryRow[]>([]);
    const [inventoryLoading, setInventoryLoading] = useState(false);

    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editingDay, setEditingDay] = useState<string | null>(null);
    const [editingCaps, setEditingCaps] = useState<Record<number, string>>({});
    const [savingDay, setSavingDay] = useState(false);

    const monthName = useMemo(
        () =>
            new Date(dateRange.year, dateRange.month, 1).toLocaleString('default', {
                month: 'long',
                year: 'numeric',
            }),
        [dateRange.month, dateRange.year]
    );

    const shopifyProductMap = useMemo(() => {
        return new Map<number, ShopifyProductSummary>(
            shopifyProducts.map((product) => [product.id, product])
        );
    }, [shopifyProducts]);

    const rentableConfigs = useMemo(
        () => productConfigs.filter((config) => toBoolean(config.rentable)),
        [productConfigs]
    );

    const rentableProductIds = useMemo(
        () => new Set<number>(rentableConfigs.map((config) => config.product_id)),
        [rentableConfigs]
    );

    const filteredConfigs = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        const sorted = [...productConfigs].sort((a, b) => {
            const aRentable = toBoolean(a.rentable) ? 1 : 0;
            const bRentable = toBoolean(b.rentable) ? 1 : 0;
            if (aRentable !== bRentable) {
                return bRentable - aRentable;
            }
            return a.product_id - b.product_id;
        });

        if (!q) {
            return sorted;
        }

        return sorted.filter((config) => {
            const title = shopifyProductMap.get(config.product_id)?.title?.toLowerCase() ?? '';
            return title.includes(q) || String(config.product_id).includes(q);
        });
    }, [productConfigs, searchQuery, shopifyProductMap]);

    const rentableTemplateMismatchIds = useMemo(() => {
        return rentableConfigs
            .filter((config) => {
                const templateSuffix = shopifyProductMap.get(config.product_id)?.template_suffix ?? null;
                const currentTemplate = templateSuffix ?? 'default';
                return currentTemplate !== 'rentals';
            })
            .map((config) => config.product_id);
    }, [rentableConfigs, shopifyProductMap]);

    const loadInventory = useCallback(async () => {
        if (rentableConfigs.length === 0) {
            setInventoryRows([]);
            return;
        }

        setInventoryLoading(true);
        try {
            const start = new Date(dateRange.year, dateRange.month, 1);
            const end = new Date(dateRange.year, dateRange.month + 1, 0);
            const startStr = formatDateYmd(start);
            const endStr = formatDateYmd(end);

            const inventoryByProduct = await Promise.all(
                rentableConfigs.map(async (config) => {
                    const response = await authenticatedFetch(
                        `/inventory?product_id=${config.product_id}&start_date=${startStr}&end_date=${endStr}`
                    );
                    if (!response.ok) {
                        return { productId: config.product_id, rows: [] as Array<Record<string, unknown>> };
                    }

                    const payload = (await response.json()) as {
                        inventory?: Array<Record<string, unknown>>;
                    };
                    return {
                        productId: config.product_id,
                        rows: Array.isArray(payload.inventory) ? payload.inventory : [],
                    };
                })
            );

            const dates: string[] = [];
            const pointer = new Date(start);
            while (pointer <= end) {
                dates.push(formatDateYmd(pointer));
                pointer.setDate(pointer.getDate() + 1);
            }

            const rows: InventoryRow[] = dates.map((date) => {
                const cells: Record<number, InventoryCell> = {};
                inventoryByProduct.forEach((entry) => {
                    const day = entry.rows.find((row) => row.date === date);
                    if (day) {
                        const capacity = Number(day.capacity);
                        const reserved = Number(day.reserved_qty);
                        cells[entry.productId] = {
                            capacity: Number.isFinite(capacity) ? capacity : 0,
                            reserved: Number.isFinite(reserved) ? reserved : 0,
                        };
                    } else {
                        const config = rentableConfigs.find((item) => item.product_id === entry.productId);
                        cells[entry.productId] = {
                            capacity: config?.default_capacity ?? 0,
                            reserved: 0,
                        };
                    }
                });

                return { date, cells };
            });

            setInventoryRows(rows);
        } catch (inventoryError) {
            console.error(inventoryError);
            setError('Failed to load inventory for the selected month.');
        } finally {
            setInventoryLoading(false);
        }
    }, [authenticatedFetch, dateRange.month, dateRange.year, rentableConfigs]);

    const loadPageData = useCallback(async () => {
        setLoadingPage(true);
        setError(null);

        try {
            const [productsRes, shopifyProductsRes, featuredRes] = await Promise.all([
                authenticatedFetch('/products'),
                authenticatedFetch('/shopify-products'),
                authenticatedFetch('/featured-home-products'),
            ]);

            if (!productsRes.ok) {
                throw new Error('Failed to load product configurations');
            }

            const productsPayload = (await productsRes.json()) as {
                products?: Array<Record<string, unknown>>;
            };

            const nextConfigs: ProductConfig[] = Array.isArray(productsPayload.products)
                ? productsPayload.products
                    .map((row) => {
                        const productId = parseNumericId(row.product_id as string | number | null | undefined);
                        if (!productId) {
                            return null;
                        }

                        const variantId = parseNumericId(row.variant_id as string | number | null | undefined);
                        const defaultCapacity = Number(row.default_capacity);
                        return {
                            product_id: productId,
                            variant_id: variantId,
                            rentable: toBoolean(row.rentable as boolean | number | null | undefined),
                            default_capacity: Number.isInteger(defaultCapacity) ? defaultCapacity : 0,
                            deposit_multiplier: Number(row.deposit_multiplier),
                            updated_at:
                                typeof row.updated_at === 'string' ? row.updated_at : undefined,
                        } as ProductConfig;
                    })
                    .filter((row): row is ProductConfig => row !== null)
                : [];

            setProductConfigs(nextConfigs);

            if (shopifyProductsRes.ok) {
                const shopifyPayload = (await shopifyProductsRes.json()) as {
                    products?: Array<Record<string, unknown>>;
                };
                const nextShopifyProducts: ShopifyProductSummary[] =
                    Array.isArray(shopifyPayload.products)
                        ? shopifyPayload.products
                            .map((row) => {
                                const productId = parseNumericId(
                                    row.id as string | number | null | undefined
                                );
                                if (!productId) {
                                    return null;
                                }

                                const variantsRaw = Array.isArray(row.variants)
                                    ? row.variants
                                    : [];
                                const variants: ShopifyVariantSummary[] = variantsRaw
                                    .map((variant) => {
                                        if (!isRecord(variant)) {
                                            return null;
                                        }
                                        const variantId = parseNumericId(
                                            variant.id as string | number | null | undefined
                                        );
                                        if (!variantId) {
                                            return null;
                                        }
                                        return {
                                            id: variantId,
                                            title:
                                                typeof variant.title === 'string' &&
                                                    variant.title.trim().length > 0
                                                    ? variant.title
                                                    : `Variant ${variantId}`,
                                        };
                                    })
                                    .filter(
                                        (variant): variant is ShopifyVariantSummary =>
                                            variant !== null
                                    );

                                const imagesRaw = Array.isArray(row.images) ? row.images : [];
                                const images = imagesRaw
                                    .filter(isRecord)
                                    .map((image) => ({
                                        src:
                                            typeof image.src === 'string' ? image.src : '',
                                    }))
                                    .filter((image) => image.src.length > 0);

                                return {
                                    id: productId,
                                    title:
                                        typeof row.title === 'string' && row.title.trim().length > 0
                                            ? row.title
                                            : `Product ${productId}`,
                                    status:
                                        typeof row.status === 'string' ? row.status : 'ACTIVE',
                                    product_url:
                                        typeof row.product_url === 'string' &&
                                            row.product_url.trim().length > 0
                                            ? row.product_url
                                            : null,
                                    template_suffix:
                                        typeof row.template_suffix === 'string' &&
                                            row.template_suffix.trim().length > 0
                                            ? row.template_suffix
                                            : null,
                                    variants,
                                    images,
                                };
                            })
                            .filter(
                                (product): product is ShopifyProductSummary => product !== null
                            )
                        : [];
                setShopifyProducts(nextShopifyProducts);
            }

            if (featuredRes.ok) {
                const featuredPayload = (await featuredRes.json()) as {
                    featured_home_products?: FeaturedHomeProduct[];
                };
                const slots: Array<number | null> = [null, null, null];
                if (Array.isArray(featuredPayload.featured_home_products)) {
                    featuredPayload.featured_home_products.forEach((entry) => {
                        const position = Number(entry.position);
                        const productId = parseNumericId(
                            entry.product_id as number | string | null | undefined
                        );
                        if (
                            Number.isInteger(position) &&
                            position >= 1 &&
                            position <= 3 &&
                            productId
                        ) {
                            slots[position - 1] = productId;
                        }
                    });
                }
                setFeaturedSlots(slots);
            }
        } catch (loadError) {
            console.error(loadError);
            setError('Failed to load Inventory configuration.');
        } finally {
            setLoadingPage(false);
        }
    }, [authenticatedFetch]);

    useEffect(() => {
        void loadPageData();
    }, [loadPageData]);

    useEffect(() => {
        const nextDrafts: Record<number, RentableDraft> = {};
        productConfigs.forEach((config) => {
            nextDrafts[config.product_id] = {
                rentable: toBoolean(config.rentable),
                default_capacity: String(config.default_capacity ?? 0),
                variant_id: config.variant_id ? String(config.variant_id) : '',
            };
        });
        setRowDrafts(nextDrafts);
    }, [productConfigs]);

    useEffect(() => {
        void loadInventory();
    }, [loadInventory]);

    const syncProductTemplates = useCallback(
        async (
            productIds: number[],
            options?: { background?: boolean; reloadAfter?: boolean }
        ): Promise<number[]> => {
            const uniqueProductIds = Array.from(
                new Set(productIds.filter((id) => Number.isInteger(id) && id > 0))
            );
            if (uniqueProductIds.length === 0) {
                return [];
            }

            setTemplateSyncingByProductId((prev) => markIdsAsTrue(prev, uniqueProductIds));
            setTemplateSyncErrorByProductId((prev) => clearIdsFromStringMap(prev, uniqueProductIds));

            const failedProductIds: number[] = [];
            const background = Boolean(options?.background);

            try {
                const response = await authenticatedFetch('/products/template-sync', {
                    method: 'POST',
                    body: JSON.stringify({ product_ids: uniqueProductIds }),
                });

                if (!response.ok) {
                    const payload = (await response.json().catch(() => null)) as TemplateSyncResponse | null;
                    const errorMessage = payload?.error ?? 'Failed to sync templates.';
                    setTemplateSyncErrorByProductId((prev) => {
                        const next = { ...prev };
                        uniqueProductIds.forEach((id) => {
                            next[id] = errorMessage;
                        });
                        return next;
                    });
                    failedProductIds.push(...uniqueProductIds);
                } else {
                    const payload = (await response.json()) as TemplateSyncResponse;
                    const results = Array.isArray(payload.results) ? payload.results : [];
                    const resultMap = new Map<number, TemplateSyncResultItem>();
                    results.forEach((item) => {
                        if (
                            item &&
                            typeof item.product_id === 'number' &&
                            Number.isInteger(item.product_id) &&
                            item.product_id > 0
                        ) {
                            resultMap.set(item.product_id, item);
                        }
                    });

                    const failedErrorById: Record<number, string> = {};
                    uniqueProductIds.forEach((productId) => {
                        const result = resultMap.get(productId);
                        if (!result || !result.sync_ok) {
                            failedProductIds.push(productId);
                            failedErrorById[productId] = result?.error ?? 'Template sync failed';
                        }
                    });

                    setTemplateSyncErrorByProductId((prev) => {
                        const next = clearIdsFromStringMap(prev, uniqueProductIds);
                        Object.entries(failedErrorById).forEach(([productId, errorMessage]) => {
                            next[Number(productId)] = errorMessage;
                        });
                        return next;
                    });
                }
            } catch (syncError) {
                const errorMessage =
                    syncError instanceof Error ? syncError.message : 'Template sync failed';
                setTemplateSyncErrorByProductId((prev) => {
                    const next = { ...prev };
                    uniqueProductIds.forEach((id) => {
                        next[id] = errorMessage;
                    });
                    return next;
                });
                failedProductIds.push(...uniqueProductIds);
            } finally {
                setTemplateSyncingByProductId((prev) => clearIdsFromBooleanMap(prev, uniqueProductIds));
            }

            if (!background && failedProductIds.length > 0) {
                setError(`Template sync failed for ${failedProductIds.length} product(s).`);
            }

            const shouldReload = options?.reloadAfter !== false;
            if (shouldReload) {
                await loadPageData();
            }

            return failedProductIds;
        },
        [authenticatedFetch, loadPageData]
    );

    useEffect(() => {
        if (loadingPage) {
            return;
        }

        const pendingMismatchIds = rentableTemplateMismatchIds.filter((productId) => {
            return !autoSyncedMismatchByProductId[productId] && !templateSyncingByProductId[productId];
        });

        if (pendingMismatchIds.length === 0) {
            return;
        }

        setAutoSyncedMismatchByProductId((prev) => markIdsAsTrue(prev, pendingMismatchIds));
        void syncProductTemplates(pendingMismatchIds, { background: true });
    }, [
        autoSyncedMismatchByProductId,
        loadingPage,
        rentableTemplateMismatchIds,
        syncProductTemplates,
        templateSyncingByProductId,
    ]);

    const pickProducts = useCallback(
        async (multiple: boolean): Promise<ResourcePickerProduct[]> => {
            const selected = await appBridge.resourcePicker({
                type: 'product',
                action: 'select',
                multiple,
            });

            if (!Array.isArray(selected)) {
                return [];
            }

            const parsed: ResourcePickerProduct[] = [];
            selected.forEach((entry) => {
                if (!isRecord(entry)) {
                    return;
                }
                const productId = parseNumericId(
                    entry.id as string | number | null | undefined
                );
                if (!productId) {
                    return;
                }

                const variantsRaw = Array.isArray(entry.variants) ? entry.variants : [];
                const firstVariant = variantsRaw.length > 0 && isRecord(variantsRaw[0])
                    ? variantsRaw[0]
                    : null;
                const variantId = firstVariant
                    ? parseNumericId(firstVariant.id as string | number | null | undefined)
                    : null;

                parsed.push({ productId, variantId });
            });

            return parsed;
        },
        [appBridge]
    );

    const updateRowDraft = useCallback((productId: number, patch: Partial<RentableDraft>) => {
        setRowDrafts((prev) => {
            const current = prev[productId] ?? {
                rentable: false,
                default_capacity: '0',
                variant_id: '',
            };
            return {
                ...prev,
                [productId]: {
                    ...current,
                    ...patch,
                },
            };
        });
    }, []);

    const handleSaveRentableRow = useCallback(
        async (productId: number) => {
            const draft = rowDrafts[productId];
            if (!draft) {
                return;
            }

            setError(null);
            setMessage(null);

            const parsedCapacity = Number(draft.default_capacity);
            if (!Number.isInteger(parsedCapacity) || parsedCapacity < 0) {
                setError('Default capacity must be a non-negative integer.');
                return;
            }

            const parsedVariantId = draft.variant_id.trim().length > 0
                ? Number(draft.variant_id)
                : null;
            if (
                parsedVariantId !== null &&
                (!Number.isInteger(parsedVariantId) || parsedVariantId <= 0)
            ) {
                setError('Variant id must be a positive integer.');
                return;
            }

            setSavingRowId(productId);
            try {
                const payload: Record<string, unknown> = {
                    rentable: draft.rentable,
                    default_capacity: parsedCapacity,
                    deposit_multiplier: 1,
                };
                if (parsedVariantId !== null) {
                    payload.variant_id = parsedVariantId;
                }

                const response = await authenticatedFetch(`/products/${productId}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload),
                });

                if (!response.ok) {
                    const body = (await response.json().catch(() => null)) as {
                        error?: string;
                    } | null;
                    throw new Error(body?.error ?? 'Failed to save product settings.');
                }

                setMessage(`Saved product ${productId} settings.`);
                await loadPageData();
            } catch (saveError) {
                console.error(saveError);
                setError(saveError instanceof Error ? saveError.message : 'Failed to save product settings.');
            } finally {
                setSavingRowId(null);
            }
        },
        [authenticatedFetch, loadPageData, rowDrafts]
    );

    const handleDeleteConfiguration = useCallback(
        async (productId: number) => {
            setError(null);
            setMessage(null);
            setSavingRowId(productId);
            try {
                const response = await authenticatedFetch(`/products/${productId}`, {
                    method: 'DELETE',
                });
                if (!response.ok) {
                    const body = (await response.json().catch(() => null)) as {
                        error?: string;
                    } | null;
                    throw new Error(body?.error ?? 'Failed to delete product configuration.');
                }
                setMessage(`Removed product ${productId} configuration.`);
                await loadPageData();
            } catch (deleteError) {
                console.error(deleteError);
                setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete product configuration.');
            } finally {
                setSavingRowId(null);
            }
        },
        [authenticatedFetch, loadPageData]
    );

    const handleAddRentableProducts = useCallback(async () => {
        setAddingRentable(true);
        setError(null);
        setMessage(null);

        try {
            const selected = await pickProducts(true);
            if (selected.length === 0) {
                return;
            }

            const addedProductIds: number[] = [];
            for (const picked of selected) {
                const existing = productConfigs.find(
                    (config) => config.product_id === picked.productId
                );
                const payload: Record<string, unknown> = {
                    rentable: true,
                    default_capacity: existing?.default_capacity ?? 10,
                    deposit_multiplier: 1,
                };

                const preferredVariantId = existing?.variant_id ?? picked.variantId;
                if (preferredVariantId && preferredVariantId > 0) {
                    payload.variant_id = preferredVariantId;
                }

                const response = await authenticatedFetch(`/products/${picked.productId}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload),
                });

                if (!response.ok) {
                    const body = (await response.json().catch(() => null)) as {
                        error?: string;
                    } | null;
                    throw new Error(
                        body?.error ?? `Failed to add product ${picked.productId} as rentable.`
                    );
                }

                addedProductIds.push(picked.productId);
            }

            const failedTemplateSyncIds = await syncProductTemplates(addedProductIds, {
                background: false,
                reloadAfter: false,
            });

            await loadPageData();
            if (failedTemplateSyncIds.length > 0) {
                setError(
                    `Added rentable product(s), but template sync failed for ${failedTemplateSyncIds.length} product(s).`
                );
            } else {
                setMessage('Updated rentable product list and synced templates.');
            }
        } catch (addError) {
            console.error(addError);
            setError(addError instanceof Error ? addError.message : 'Failed to add rentable products.');
        } finally {
            setAddingRentable(false);
        }
    }, [authenticatedFetch, loadPageData, pickProducts, productConfigs, syncProductTemplates]);

    const handleManualTemplateSync = useCallback(
        async (productId: number) => {
            setError(null);
            setMessage(null);
            const failedProductIds = await syncProductTemplates([productId], {
                background: false,
            });
            if (failedProductIds.length === 0) {
                setMessage(`Template synced for product ${productId}.`);
            }
        },
        [syncProductTemplates]
    );

    const handlePickFeaturedSlot = useCallback(
        async (slotIndex: number) => {
            setError(null);
            const picked = await pickProducts(false);
            if (picked.length === 0) {
                return;
            }

            setFeaturedSlots((prev) => {
                const next = [...prev];
                next[slotIndex] = picked[0].productId;
                return next;
            });
        },
        [pickProducts]
    );

    const handleSaveFeaturedProducts = useCallback(async () => {
        setError(null);
        setMessage(null);

        const selectedIds = featuredSlots.filter(
            (value): value is number => typeof value === 'number' && value > 0
        );

        if (selectedIds.length !== 3) {
            setError('Featured Home Products must have exactly 3 selected products.');
            return;
        }

        const uniqueIds = new Set(selectedIds);
        if (uniqueIds.size !== 3) {
            setError('Featured Home Products must contain 3 unique products.');
            return;
        }

        const nonRentable = selectedIds.filter((productId) => !rentableProductIds.has(productId));
        if (nonRentable.length > 0) {
            setError('Each featured product must also be configured as rentable.');
            return;
        }

        setSavingFeatured(true);
        try {
            const response = await authenticatedFetch('/featured-home-products', {
                method: 'PUT',
                body: JSON.stringify({ product_ids: selectedIds }),
            });

            if (!response.ok) {
                const body = (await response.json().catch(() => null)) as {
                    error?: string;
                } | null;
                throw new Error(body?.error ?? 'Failed to save featured products.');
            }

            setMessage('Saved Featured Home Products.');
            await loadPageData();
        } catch (saveError) {
            console.error(saveError);
            setError(saveError instanceof Error ? saveError.message : 'Failed to save featured products.');
        } finally {
            setSavingFeatured(false);
        }
    }, [authenticatedFetch, featuredSlots, loadPageData, rentableProductIds]);

    const handleMonthChange = (direction: 'prev' | 'next') => {
        setDateRange((prev) => {
            let month = prev.month + (direction === 'next' ? 1 : -1);
            let year = prev.year;

            if (month > 11) {
                month = 0;
                year += 1;
            }
            if (month < 0) {
                month = 11;
                year -= 1;
            }

            return { month, year };
        });
    };

    const handleEditDay = (row: InventoryRow) => {
        setEditingDay(row.date);
        const caps: Record<number, string> = {};
        rentableConfigs.forEach((config) => {
            const cell = row.cells[config.product_id];
            caps[config.product_id] = String(cell?.capacity ?? config.default_capacity ?? 0);
        });
        setEditingCaps(caps);
        setEditModalOpen(true);
        setError(null);
    };

    const handleSaveDay = useCallback(async () => {
        if (!editingDay) {
            return;
        }

        setSavingDay(true);
        setError(null);

        try {
            for (const config of rentableConfigs) {
                const raw = editingCaps[config.product_id];
                const capacity = Number(raw);
                if (!Number.isInteger(capacity) || capacity < 0) {
                    throw new Error('Each daily capacity must be a non-negative integer.');
                }

                const response = await authenticatedFetch('/inventory', {
                    method: 'PUT',
                    body: JSON.stringify({
                        product_id: config.product_id,
                        overrides: [{ date: editingDay, capacity }],
                    }),
                });

                if (!response.ok) {
                    const body = (await response.json().catch(() => null)) as {
                        error?: string;
                    } | null;
                    throw new Error(body?.error ?? `Failed to update ${config.product_id} inventory.`);
                }
            }

            setEditModalOpen(false);
            await loadInventory();
            setMessage(`Updated capacities for ${editingDay}.`);
        } catch (saveError) {
            console.error(saveError);
            setError(saveError instanceof Error ? saveError.message : 'Failed to update daily capacities.');
        } finally {
            setSavingDay(false);
        }
    }, [authenticatedFetch, editingCaps, editingDay, loadInventory, rentableConfigs]);

    return (
        <Page
            title="Inventory"
            titleMetadata={<Badge tone="info">{monthName}</Badge>}
            secondaryActions={[
                { content: 'Previous Month', onAction: () => handleMonthChange('prev') },
                { content: 'Next Month', onAction: () => handleMonthChange('next') },
            ]}
        >
            <BlockStack gap="500">
                {error ? <InlineError message={error} fieldID="inventory-error" /> : null}
                {message ? (
                    <Box padding="300">
                        <Text as="p" tone="success">
                            {message}
                        </Text>
                    </Box>
                ) : null}

                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                                Featured Home Products
                            </Text>
                            <Button
                                variant="primary"
                                loading={savingFeatured}
                                onClick={handleSaveFeaturedProducts}
                            >
                                Save 3 Featured Products
                            </Button>
                        </InlineStack>
                        <Text as="p" tone="subdued">
                            Select exactly 3 products for the home-page booking widget toggle.
                        </Text>

                        {[0, 1, 2].map((index) => {
                            const selectedId = featuredSlots[index];
                            const product =
                                selectedId !== null
                                    ? shopifyProductMap.get(selectedId)
                                    : undefined;
                            const isRentable =
                                selectedId !== null ? rentableProductIds.has(selectedId) : false;
                            const productImageUrl = getProductImageUrl(product);
                            const productUrl = product?.product_url ?? null;

                            return (
                                <Card key={`featured-slot-${index}`}>
                                    <InlineStack align="space-between" blockAlign="center">
                                        <InlineStack gap="300" blockAlign="center">
                                            <div
                                                style={{
                                                    width: 64,
                                                    height: 64,
                                                    borderRadius: 8,
                                                    border: '1px solid #d2d5d8',
                                                    overflow: 'hidden',
                                                }}
                                            >
                                                {productImageUrl ? (
                                                    <img
                                                        src={productImageUrl}
                                                        alt={product?.title ?? 'Selected product'}
                                                        style={{
                                                            width: 64,
                                                            height: 64,
                                                            objectFit: 'cover',
                                                            display: 'block',
                                                            borderRadius: 8,
                                                        }}
                                                    />
                                                ) : (
                                                    <div
                                                        style={{
                                                            width: 64,
                                                            height: 64,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            fontSize: 11,
                                                            color: '#6d7175',
                                                        }}
                                                    >
                                                        No image
                                                    </div>
                                                )}
                                            </div>

                                            <BlockStack gap="100">
                                                <Text as="p" variant="bodyMd" fontWeight="semibold">
                                                    Home widget product {index + 1}
                                                </Text>
                                                <Text as="p" tone="subdued">
                                                    {selectedId
                                                        ? `${product?.title ?? `Product ${selectedId}`} (#${selectedId})`
                                                        : 'No product selected'}
                                                </Text>
                                                {selectedId ? (
                                                    <InlineStack gap="200" blockAlign="center">
                                                        <Badge tone={isRentable ? 'success' : 'critical'}>
                                                            {isRentable ? 'Rentable' : 'Not rentable'}
                                                        </Badge>
                                                        <Button
                                                            size="slim"
                                                            url={productUrl ?? undefined}
                                                            target="_blank"
                                                            disabled={!productUrl}
                                                        >
                                                            View Product
                                                        </Button>
                                                    </InlineStack>
                                                ) : null}
                                            </BlockStack>
                                        </InlineStack>

                                        <InlineStack gap="200">
                                            <Button onClick={() => void handlePickFeaturedSlot(index)}>
                                                {selectedId ? 'Change' : 'Select'}
                                            </Button>
                                            <Button
                                                tone="critical"
                                                onClick={() => {
                                                    setFeaturedSlots((prev) => {
                                                        const next = [...prev];
                                                        next[index] = null;
                                                        return next;
                                                    });
                                                }}
                                            >
                                                Clear
                                            </Button>
                                        </InlineStack>
                                    </InlineStack>
                                </Card>
                            );
                        })}
                    </BlockStack>
                </Card>

                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                                Rentable Products
                            </Text>
                            <Button
                                variant="primary"
                                loading={addingRentable}
                                onClick={() => void handleAddRentableProducts()}
                            >
                                Add Rentable Product
                            </Button>
                        </InlineStack>

                        <TextField
                            label="Search"
                            value={searchQuery}
                            onChange={setSearchQuery}
                            autoComplete="off"
                            placeholder="Search by title or product id"
                        />

                        {loadingPage ? (
                            <Text as="p" tone="subdued">
                                Loading product configurations...
                            </Text>
                        ) : filteredConfigs.length === 0 ? (
                            <Text as="p" tone="subdued">
                                No product configurations found.
                            </Text>
                        ) : (
                            <IndexTable
                                resourceName={{ singular: 'product', plural: 'products' }}
                                itemCount={filteredConfigs.length}
                                selectable={false}
                                headings={[
                                    { title: 'Product' },
                                    { title: 'Settings' },
                                    { title: 'Template' },
                                    { title: 'Actions' },
                                ]}
                            >
                                {filteredConfigs.map((config, index) => {
                                    const draft =
                                        rowDrafts[config.product_id] ?? {
                                            rentable: toBoolean(config.rentable),
                                            default_capacity: String(config.default_capacity ?? 0),
                                            variant_id: config.variant_id ? String(config.variant_id) : '',
                                        };
                                    const shopifyProduct = shopifyProductMap.get(config.product_id);
                                    const templateSuffix =
                                        shopifyProduct?.template_suffix ?? null;
                                    const productImageUrl = getProductImageUrl(shopifyProduct);
                                    const productUrl = shopifyProduct?.product_url ?? null;
                                    const isTemplateSyncing = Boolean(templateSyncingByProductId[config.product_id]);
                                    const templateSyncError = templateSyncErrorByProductId[config.product_id];

                                    const variantOptions =
                                        shopifyProduct && shopifyProduct.variants.length > 0
                                            ? shopifyProduct.variants.map((variant) => ({
                                                label: `${variant.title} (#${variant.id})`,
                                                value: String(variant.id),
                                            }))
                                            : [{ label: 'No variants available', value: '' }];

                                    const persistedRentable = toBoolean(config.rentable);
                                    const persistedCapacity = Number.isInteger(config.default_capacity)
                                        ? config.default_capacity
                                        : 0;
                                    const persistedVariantId = config.variant_id ? String(config.variant_id) : '';
                                    const draftCapacityParsed = Number(draft.default_capacity);
                                    const hasCapacityChange = Number.isInteger(draftCapacityParsed)
                                        ? draftCapacityParsed !== persistedCapacity
                                        : draft.default_capacity.trim().length > 0;
                                    const hasChanges =
                                        draft.rentable !== persistedRentable ||
                                        hasCapacityChange ||
                                        (draft.variant_id || '') !== persistedVariantId;

                                    const expectedTemplate = draft.rentable ? 'rentals' : 'default';
                                    const currentTemplate = templateSuffix ?? 'default';
                                    const templateTone =
                                        expectedTemplate === currentTemplate
                                            ? 'success'
                                            : draft.rentable
                                                ? 'warning'
                                                : 'critical';

                                    return (
                                        <IndexTable.Row
                                            id={String(config.product_id)}
                                            key={config.product_id}
                                            position={index}
                                        >
                                            <IndexTable.Cell>
                                                <InlineStack gap="300" blockAlign="center">
                                                    <div
                                                        style={{
                                                            width: 48,
                                                            height: 48,
                                                            borderRadius: 8,
                                                            border: '1px solid #d2d5d8',
                                                            overflow: 'hidden',
                                                        }}
                                                    >
                                                        {productImageUrl ? (
                                                            <img
                                                                src={productImageUrl}
                                                                alt={shopifyProduct?.title ?? `Product ${config.product_id}`}
                                                                style={{
                                                                    width: 48,
                                                                    height: 48,
                                                                    objectFit: 'cover',
                                                                    display: 'block',
                                                                    borderRadius: 8,
                                                                }}
                                                            />
                                                        ) : (
                                                            <div
                                                                style={{
                                                                    width: 48,
                                                                    height: 48,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    fontSize: 10,
                                                                    color: '#6d7175',
                                                                }}
                                                            >
                                                                No image
                                                            </div>
                                                        )}
                                                    </div>

                                                    <BlockStack gap="100">
                                                        <Text as="span" fontWeight="semibold">
                                                            {shopifyProduct?.title ?? `Product ${config.product_id}`}
                                                        </Text>
                                                        <Text as="span" tone="subdued">
                                                            #{config.product_id}
                                                        </Text>
                                                    </BlockStack>
                                                </InlineStack>
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                <BlockStack gap="200">
                                                    <InlineStack gap="300" blockAlign="center" align="start">
                                                        <Checkbox
                                                            label="Rentable"
                                                            checked={draft.rentable}
                                                            onChange={(checked) => {
                                                                updateRowDraft(config.product_id, {
                                                                    rentable: checked,
                                                                });
                                                            }}
                                                        />

                                                        <div style={{ width: 140 }}>
                                                            <TextField
                                                                label="Default Capacity"
                                                                labelHidden
                                                                type="number"
                                                                autoComplete="off"
                                                                value={draft.default_capacity}
                                                                onChange={(value) => {
                                                                    updateRowDraft(config.product_id, {
                                                                        default_capacity: value,
                                                                    });
                                                                }}
                                                            />
                                                        </div>

                                                        <div style={{ minWidth: 280, flexGrow: 1 }}>
                                                            <Select
                                                                label="Variant"
                                                                labelHidden
                                                                options={variantOptions}
                                                                value={draft.variant_id}
                                                                onChange={(value) => {
                                                                    updateRowDraft(config.product_id, {
                                                                        variant_id: value,
                                                                    });
                                                                }}
                                                            />
                                                        </div>
                                                    </InlineStack>
                                                </BlockStack>
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                {isTemplateSyncing ? (
                                                    <Badge tone="attention">Template: syncing...</Badge>
                                                ) : templateSyncError ? (
                                                    <Badge tone="critical">Template: sync failed</Badge>
                                                ) : (
                                                    <Badge tone={templateTone}>
                                                        {`Template: ${currentTemplate} (expected ${expectedTemplate})`}
                                                    </Badge>
                                                )}
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                <BlockStack gap="200">
                                                    {hasChanges ? <Badge tone="attention">Unsaved</Badge> : null}

                                                    <ButtonGroup>
                                                        <Button
                                                            size="slim"
                                                            url={productUrl ?? undefined}
                                                            target="_blank"
                                                            disabled={!productUrl}
                                                        >
                                                            View
                                                        </Button>
                                                        <Button
                                                            size="slim"
                                                            loading={isTemplateSyncing}
                                                            onClick={() =>
                                                                void handleManualTemplateSync(config.product_id)
                                                            }
                                                        >
                                                            Sync
                                                        </Button>
                                                        <Button
                                                            size="slim"
                                                            variant="primary"
                                                            loading={savingRowId === config.product_id}
                                                            disabled={!hasChanges || isTemplateSyncing}
                                                            onClick={() =>
                                                                void handleSaveRentableRow(config.product_id)
                                                            }
                                                        >
                                                            Save
                                                        </Button>
                                                        <Button
                                                            size="slim"
                                                            tone="critical"
                                                            loading={savingRowId === config.product_id}
                                                            onClick={() =>
                                                                void handleDeleteConfiguration(config.product_id)
                                                            }
                                                        >
                                                            Remove
                                                        </Button>
                                                    </ButtonGroup>
                                                    {templateSyncError ? (
                                                        <Text as="span" tone="critical" variant="bodySm">
                                                            {templateSyncError}
                                                        </Text>
                                                    ) : null}
                                                </BlockStack>
                                            </IndexTable.Cell>
                                        </IndexTable.Row>
                                    );
                                })}
                            </IndexTable>
                        )}
                    </BlockStack>
                </Card>

                <Card>
                    <BlockStack gap="300">
                        <Text as="h2" variant="headingMd">
                            Daily Capacity Overrides
                        </Text>
                        <Text as="p" tone="subdued">
                            Override day-level capacities for currently rentable products.
                        </Text>

                        {rentableConfigs.length === 0 ? (
                            <Text as="p" tone="subdued">
                                No rentable products configured yet.
                            </Text>
                        ) : (
                            <IndexTable
                                resourceName={{ singular: 'day', plural: 'days' }}
                                itemCount={inventoryRows.length}
                                selectable={false}
                                loading={inventoryLoading}
                                headings={[
                                    { title: 'Date' },
                                    ...rentableConfigs.map((config) => ({
                                        title: `${shopifyProductMap.get(config.product_id)?.title ?? `Product ${config.product_id}`} (Avail/Total)`,
                                    })),
                                    { title: 'Action' },
                                ]}
                            >
                                {inventoryRows.map((row, index) => (
                                    <IndexTable.Row
                                        id={row.date}
                                        key={row.date}
                                        position={index}
                                    >
                                        <IndexTable.Cell>
                                            <Text as="span" fontWeight="semibold">
                                                {row.date}
                                            </Text>
                                        </IndexTable.Cell>
                                        {rentableConfigs.map((config) => {
                                            const cell = row.cells[config.product_id] ?? {
                                                capacity: config.default_capacity,
                                                reserved: 0,
                                            };
                                            const available = Math.max(0, cell.capacity - cell.reserved);
                                            return (
                                                <IndexTable.Cell key={`${row.date}-${config.product_id}`}>
                                                    <InlineStack gap="200">
                                                        <Text
                                                            as="span"
                                                            tone={available > 0 ? 'success' : 'critical'}
                                                        >
                                                            {available}
                                                        </Text>
                                                        <Text as="span" tone="subdued">
                                                            / {cell.capacity}
                                                        </Text>
                                                    </InlineStack>
                                                </IndexTable.Cell>
                                            );
                                        })}
                                        <IndexTable.Cell>
                                            <Button
                                                size="slim"
                                                onClick={() => handleEditDay(row)}
                                            >
                                                Update Avail.
                                            </Button>
                                        </IndexTable.Cell>
                                    </IndexTable.Row>
                                ))}
                            </IndexTable>
                        )}
                    </BlockStack>
                </Card>
            </BlockStack>

            <Modal
                open={editModalOpen}
                onClose={() => setEditModalOpen(false)}
                title={`Edit Availability for ${editingDay ?? ''}`}
                primaryAction={{
                    content: 'Save Changes',
                    onAction: () => void handleSaveDay(),
                    loading: savingDay,
                }}
                secondaryActions={[{ content: 'Cancel', onAction: () => setEditModalOpen(false) }]}
            >
                <Modal.Section>
                    <FormLayout>
                        {rentableConfigs.map((config) => {
                            const productName =
                                shopifyProductMap.get(config.product_id)?.title ??
                                `Product ${config.product_id}`;
                            return (
                                <TextField
                                    key={`edit-cap-${config.product_id}`}
                                    label={`${productName} Capacity`}
                                    type="number"
                                    autoComplete="off"
                                    value={editingCaps[config.product_id] ?? String(config.default_capacity)}
                                    onChange={(value) => {
                                        setEditingCaps((prev) => ({
                                            ...prev,
                                            [config.product_id]: value,
                                        }));
                                    }}
                                />
                            );
                        })}
                    </FormLayout>
                </Modal.Section>
            </Modal>
        </Page>
    );
}
