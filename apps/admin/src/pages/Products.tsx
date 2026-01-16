import { Page, Layout, LegacyCard, ResourceList, ResourceItem, Text, Badge, Modal, TextField, FormLayout, InlineError, Checkbox } from '@shopify/polaris';
import { useAuthenticatedFetch } from '../api';
import { useEffect, useState, useCallback } from 'react';

interface ProductConfig {
  product_id: number;
  variant_id: number | null; // For specific variant rental
  rentable: number; // boolean
  default_capacity: number;
  deposit_variant_id: number | null;
  deposit_multiplier: number;
  updated_at: string;
}

export default function Products() {
  const fetch = useAuthenticatedFetch();
  const [products, setProducts] = useState<ProductConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [activeProduct, setActiveProduct] = useState<Partial<ProductConfig> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/products');
      if (response.ok) {
        const data = await response.json();
        setProducts(data.products);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [fetch]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const handleAdd = () => {
    setActiveProduct({
      product_id: 0,
      rentable: 1,
      default_capacity: 10,
      deposit_multiplier: 1,
      variant_id: null,
      deposit_variant_id: null
    });
    setModalOpen(true);
  };

  const handleEdit = (product: ProductConfig) => {
    setActiveProduct(product);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!activeProduct?.product_id) {
      setError("Product ID is required");
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const payload = {
        rentable: Boolean(activeProduct.rentable),
        default_capacity: Number(activeProduct.default_capacity),
        deposit_multiplier: Number(activeProduct.deposit_multiplier),
        variant_id: activeProduct.variant_id,
        deposit_variant_id: activeProduct.deposit_variant_id
      };

      const response = await fetch(`/products/${activeProduct.product_id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Failed to save product config');
      }

      setModalOpen(false);
      loadProducts();
    } catch (e: unknown) {
      if (e instanceof Error) {
        console.error(e.message);
      } else {
        console.error('Unknown error');
      }
    } finally {
      setSaving(false);
    }
  };

  const resourceName = {
    singular: 'product',
    plural: 'products',
  };

  return (
    <Page
      title="Products"
      primaryAction={{ content: 'Add Product', onAction: handleAdd }}
    >
      <Layout>
        <Layout.Section>
          <LegacyCard>
            <ResourceList
              resourceName={resourceName}
              items={products}
              loading={loading}
              renderItem={(item) => {
                const { product_id, rentable, default_capacity, deposit_multiplier } = item;
                const tone = rentable ? 'success' : undefined;
                return (
                  <ResourceItem
                    id={product_id.toString()}
                    url="#"
                    onClick={() => handleEdit(item)}
                    accessibilityLabel={`View details for ${product_id}`}
                    name={`Product ID: ${product_id}`}
                  >
                    <Text variant="bodyMd" fontWeight="bold" as="h3">
                      Product ID: {product_id}
                    </Text>
                    <div>Capacity: {default_capacity} | Deposit Multiplier: {deposit_multiplier}x</div>
                    <Badge tone={tone}>{rentable ? 'Rentable' : 'Not Rentable'}</Badge>
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
        title="Configure Product"
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
              label="Product ID"
              type="number"
              value={activeProduct?.product_id?.toString() || ''}
              onChange={(val) => setActiveProduct(prev => ({ ...prev, product_id: parseInt(val) || 0 }))}
              autoComplete="off"
              disabled={!!products.find(p => p.product_id === activeProduct?.product_id && activeProduct !== p)}
              helpText="Enter Shopify Product ID"
            />

            <Checkbox
              label="Rentable"
              checked={Boolean(activeProduct?.rentable)}
              onChange={(val) => setActiveProduct(prev => ({ ...prev, rentable: val ? 1 : 0 }))}
            />

            <TextField
              label="Default Capacity"
              type="number"
              value={activeProduct?.default_capacity?.toString() || '0'}
              onChange={(val) => setActiveProduct(prev => ({ ...prev, default_capacity: parseInt(val) || 0 }))}
              autoComplete="off"
            />

            <TextField
              label="Deposit Multiplier"
              type="number"
              value={activeProduct?.deposit_multiplier?.toString() || '1'}
              onChange={(val) => setActiveProduct(prev => ({ ...prev, deposit_multiplier: parseInt(val) || 1 }))}
              autoComplete="off"
              helpText="How many deposit units to add"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
