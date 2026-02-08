import assert from 'node:assert/strict';
import test from 'node:test';

import { handleProxyRequest } from '../src/proxy';
import type { Env } from '../src/types';

const PROXY_ROUTES: Array<{ path: string; method: 'GET' | 'POST' }> = [
    { path: '/proxy/availability', method: 'GET' },
    { path: '/proxy/hold', method: 'POST' },
    { path: '/proxy/release', method: 'POST' },
    { path: '/proxy/config', method: 'GET' },
    { path: '/proxy/agreement/current', method: 'GET' },
    { path: '/proxy/agreement/sign', method: 'POST' },
];

test('production enforces proxy signature for all /proxy routes', async () => {
    const env = createEnv('production');

    for (const route of PROXY_ROUTES) {
        const request = new Request(
            `https://worker.example${route.path}?shop=test-shop.myshopify.com`,
            { method: route.method }
        );
        const response = await handleProxyRequest(request, env);
        assert.equal(
            response.status,
            401,
            `Expected 401 for ${route.method} ${route.path} when signature is missing`
        );
    }
});

test('dev mode keeps proxy signature check disabled for compatibility', async () => {
    const env = createEnv('dev');
    const request = new Request('https://worker.example/proxy/config?shop=test-shop.myshopify.com');
    const response = await handleProxyRequest(request, env);

    assert.notEqual(response.status, 401);
});

test('production rejects invalid proxy signature', async () => {
    const env = createEnv('production');
    const request = new Request(
        'https://worker.example/proxy/config?shop=test-shop.myshopify.com&signature=deadbeef'
    );
    const response = await handleProxyRequest(request, env);

    assert.equal(response.status, 401);
});

test('production accepts valid proxy signature and evaluates downstream route logic', async () => {
    const env = createEnv('production');
    const baseParams = new URLSearchParams({
        shop: 'test-shop.myshopify.com',
    });
    const signature = await createProxySignature(baseParams, env.SHOPIFY_API_SECRET);
    baseParams.set('signature', signature);

    const request = new Request(`https://worker.example/proxy/config?${baseParams.toString()}`);
    const response = await handleProxyRequest(request, env);

    assert.notEqual(response.status, 401);
});

function createEnv(environment: string): Env {
    return {
        DB: createMockDb(),
        ENVIRONMENT: environment,
        SHOPIFY_API_KEY: 'test-key',
        SHOPIFY_API_SECRET: 'test-secret',
        SHOPIFY_APP_URL: 'https://worker.example',
    };
}

function createMockDb(): D1Database {
    const statement = createMockStatement();
    return {
        prepare: () => statement,
        batch: async () => [],
        exec: async () => ({ count: 0, duration: 0 }),
    } as unknown as D1Database;
}

async function createProxySignature(params: URLSearchParams, secret: string): Promise<string> {
    const entries = Array.from(params.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const message = entries.map(([key, value]) => `${key}=${value}`).join('');

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    return Array.from(new Uint8Array(signature))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function createMockStatement(): D1PreparedStatement {
    const statement = {
        bind: () => statement,
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 0 } }),
    };

    return statement as unknown as D1PreparedStatement;
}
