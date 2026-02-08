import assert from 'node:assert/strict';
import test from 'node:test';

import { handleProxyRequest } from '../src/proxy';
import type { Env } from '../src/types';
import { createMockDbController } from './helpers/mockD1';

interface RuntimeConfigResponse {
    ok?: boolean;
    featured_products?: Array<{ product_id: number }>;
    rentable_products?: Array<{ product_id: number }>;
    products?: Array<{ product_id: number }>;
}

function createEnv(featuredRows: Array<{ position: number; product_id: number }>): Env {
    const mockDb = createMockDbController({
        rules: [
            {
                match: 'SELECT id, shop_domain, access_token FROM shops WHERE shop_domain = ?',
                first: { id: 1, shop_domain: 'test-shop.myshopify.com', access_token: 'token-123' },
            },
            {
                match: 'FROM locations',
                all: { results: [] },
            },
            {
                match: /FROM products\s+WHERE shop_id = \? AND rentable = 1/s,
                all: {
                    results: [
                        { product_id: 101, variant_id: 201, default_capacity: 5, deposit_variant_id: null, deposit_multiplier: 1 },
                        { product_id: 102, variant_id: 202, default_capacity: 5, deposit_variant_id: null, deposit_multiplier: 1 },
                        { product_id: 103, variant_id: 203, default_capacity: 5, deposit_variant_id: null, deposit_multiplier: 1 },
                        { product_id: 104, variant_id: 204, default_capacity: 5, deposit_variant_id: null, deposit_multiplier: 1 },
                    ],
                },
            },
            {
                match: 'FROM featured_home_products',
                all: { results: featuredRows },
            },
        ],
    });

    return {
        DB: mockDb.db,
        ENVIRONMENT: 'dev',
        SHOPIFY_API_KEY: 'test-key',
        SHOPIFY_API_SECRET: 'test-secret',
        SHOPIFY_APP_URL: 'https://worker.example',
    };
}

function createShopifyMetadataFetch(): typeof fetch {
    return async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return Response.json({
            data: {
                nodes: [
                    {
                        id: 'gid://shopify/Product/101',
                        title: 'A',
                        featuredImage: { url: 'https://cdn.example/a.jpg', altText: 'A' },
                        images: { nodes: [] },
                        variants: { nodes: [{ id: 'gid://shopify/ProductVariant/201' }] },
                    },
                    {
                        id: 'gid://shopify/Product/102',
                        title: 'B',
                        featuredImage: { url: 'https://cdn.example/b.jpg', altText: 'B' },
                        images: { nodes: [] },
                        variants: { nodes: [{ id: 'gid://shopify/ProductVariant/202' }] },
                    },
                    {
                        id: 'gid://shopify/Product/103',
                        title: 'C',
                        featuredImage: { url: 'https://cdn.example/c.jpg', altText: 'C' },
                        images: { nodes: [] },
                        variants: { nodes: [{ id: 'gid://shopify/ProductVariant/203' }] },
                    },
                    {
                        id: 'gid://shopify/Product/104',
                        title: 'D',
                        featuredImage: { url: 'https://cdn.example/d.jpg', altText: 'D' },
                        images: { nodes: [] },
                        variants: { nodes: [{ id: 'gid://shopify/ProductVariant/204' }] },
                    },
                ],
            },
        });
    };
}

test('GET /proxy/config returns configured featured_products and rentable_products', async () => {
    const env = createEnv([
        { position: 1, product_id: 103 },
        { position: 2, product_id: 101 },
        { position: 3, product_id: 104 },
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = createShopifyMetadataFetch();

    try {
        const response = await handleProxyRequest(
            new Request('https://worker.example/proxy/config?shop=test-shop.myshopify.com'),
            env
        );
        assert.equal(response.status, 200);

        const payload = (await response.json()) as RuntimeConfigResponse;
        assert.equal(payload.ok, true);
        assert.deepEqual(
            (payload.featured_products ?? []).map((entry) => entry.product_id),
            [103, 101, 104]
        );
        assert.equal(payload.rentable_products?.length, 4);
        assert.equal(payload.products?.length, 4);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('GET /proxy/config falls back featured_products to first 3 rentable products when not configured', async () => {
    const env = createEnv([]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = createShopifyMetadataFetch();

    try {
        const response = await handleProxyRequest(
            new Request('https://worker.example/proxy/config?shop=test-shop.myshopify.com'),
            env
        );
        assert.equal(response.status, 200);

        const payload = (await response.json()) as RuntimeConfigResponse;
        assert.equal(payload.ok, true);
        assert.deepEqual(
            (payload.featured_products ?? []).map((entry) => entry.product_id),
            [101, 102, 103]
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});
