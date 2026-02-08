import assert from 'node:assert/strict';
import test from 'node:test';

import { __testHandleProductsTemplateSync } from '../src/admin';
import type { Env } from '../src/types';
import { createMockDbController } from './helpers/mockD1';

interface TemplateSyncResponse {
    ok?: boolean;
    results?: Array<{
        product_id: number;
        expected_template: string;
        sync_ok: boolean;
        error?: string;
    }>;
}

function createEnv(db: D1Database): Env {
    return {
        DB: db,
        ENVIRONMENT: 'test',
        SHOPIFY_API_KEY: 'test-api-key',
        SHOPIFY_API_SECRET: 'test-api-secret',
        SHOPIFY_APP_URL: 'https://worker.example',
    };
}

const auth = {
    shopId: 1,
    shopDomain: 'demo.myshopify.com',
    shopTimezone: 'America/Mazatlan',
};

test('template-sync syncs requested rentable products and reports missing product ids', async () => {
    const controller = createMockDbController({
        rules: [
            {
                match: 'SELECT access_token FROM shops WHERE id = ?',
                first: { access_token: 'token-123' },
            },
            {
                match: /FROM products\s+WHERE shop_id = \? AND product_id IN \(\?, \?\)/,
                all: {
                    results: [
                        { product_id: 101, rentable: 1, previous_template_suffix: null },
                    ],
                },
            },
            {
                match: 'UPDATE products',
                run: { meta: { changes: 1 } },
            },
        ],
    });
    const env = createEnv(controller.db);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
        const requestBody = JSON.parse(String(init?.body)) as {
            query?: string;
            variables?: { id?: string };
        };
        const query = requestBody.query ?? '';

        if (query.includes('query ProductTemplate')) {
            return Response.json({
                data: {
                    product: {
                        id: requestBody.variables?.id,
                        templateSuffix: 'default',
                    },
                },
            });
        }

        if (query.includes('mutation UpdateProductTemplate')) {
            return Response.json({
                data: {
                    productUpdate: {
                        product: { id: requestBody.variables?.id, templateSuffix: 'rentals' },
                        userErrors: [],
                    },
                },
            });
        }

        return Response.json({}, { status: 500 });
    };

    try {
        const request = new Request('https://worker.example/admin/products/template-sync', {
            method: 'POST',
            body: JSON.stringify({ product_ids: [101, 999] }),
        });
        const response = await __testHandleProductsTemplateSync(request, env, auth);
        assert.equal(response.status, 200);

        const payload = (await response.json()) as TemplateSyncResponse;
        assert.equal(payload.ok, true);
        assert.equal(payload.results?.length, 2);

        const synced = payload.results?.find((item) => item.product_id === 101);
        assert.equal(synced?.sync_ok, true);
        assert.equal(synced?.expected_template, 'rentals');

        const missing = payload.results?.find((item) => item.product_id === 999);
        assert.equal(missing?.sync_ok, false);
        assert.equal(missing?.error, 'Product is not configured');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('template-sync without product_ids syncs all rentable products', async () => {
    const controller = createMockDbController({
        rules: [
            {
                match: 'SELECT access_token FROM shops WHERE id = ?',
                first: { access_token: 'token-123' },
            },
            {
                match: /FROM products\s+WHERE shop_id = \? AND rentable = 1\s+ORDER BY product_id/,
                all: {
                    results: [
                        { product_id: 101, rentable: 1, previous_template_suffix: null },
                        { product_id: 102, rentable: 1, previous_template_suffix: null },
                    ],
                },
            },
            {
                match: 'UPDATE products',
                run: { meta: { changes: 1 } },
            },
        ],
    });
    const env = createEnv(controller.db);

    let mutationCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
        const requestBody = JSON.parse(String(init?.body)) as {
            query?: string;
            variables?: { id?: string };
        };
        const query = requestBody.query ?? '';

        if (query.includes('query ProductTemplate')) {
            const templateSuffix = requestBody.variables?.id?.includes('/101') ? 'rentals' : 'default';
            return Response.json({
                data: {
                    product: {
                        id: requestBody.variables?.id,
                        templateSuffix,
                    },
                },
            });
        }

        if (query.includes('mutation UpdateProductTemplate')) {
            mutationCount += 1;
            return Response.json({
                data: {
                    productUpdate: {
                        product: { id: requestBody.variables?.id, templateSuffix: 'rentals' },
                        userErrors: [],
                    },
                },
            });
        }

        return Response.json({}, { status: 500 });
    };

    try {
        const request = new Request('https://worker.example/admin/products/template-sync', {
            method: 'POST',
            body: JSON.stringify({}),
        });
        const response = await __testHandleProductsTemplateSync(request, env, auth);
        assert.equal(response.status, 200);

        const payload = (await response.json()) as TemplateSyncResponse;
        assert.equal(payload.ok, true);
        assert.equal(payload.results?.length, 2);
        assert.equal(payload.results?.every((item) => item.sync_ok), true);
        assert.equal(mutationCount, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
