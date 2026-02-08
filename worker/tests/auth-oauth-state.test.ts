import assert from 'node:assert/strict';
import test from 'node:test';

import { handleAuth, handleAuthCallback } from '../src/auth';
import type { Env } from '../src/types';

function createEnv(): Env {
    return {
        DB: {
            prepare: () => ({
                bind: () => ({
                    first: async () => null,
                    all: async () => ({ results: [] }),
                    run: async () => ({ meta: { changes: 0 } }),
                }),
            }),
            batch: async () => [],
            exec: async () => ({ count: 0, duration: 0 }),
        } as unknown as D1Database,
        ENVIRONMENT: 'test',
        ADMIN_ALLOWED_ORIGINS: 'http://localhost:3000',
        SHOPIFY_API_KEY: 'test-api-key',
        SHOPIFY_API_SECRET: 'test-api-secret',
        SHOPIFY_APP_URL: 'https://worker.example',
    };
}

test('handleAuth sets OAuth state cookie on redirect', async () => {
    const env = createEnv();
    const response = await handleAuth(
        new Request('https://worker.example/auth?shop=demo.myshopify.com'),
        env
    );

    assert.equal(response.status, 302);
    const setCookie = response.headers.get('Set-Cookie') || '';
    assert.match(setCookie, /mgc_oauth_state=/);
    assert.match(setCookie, /HttpOnly/);
});

test('handleAuthCallback rejects missing state parameter', async () => {
    const env = createEnv();
    const response = await handleAuthCallback(
        new Request(
            'https://worker.example/auth/callback?shop=demo.myshopify.com&code=abc&hmac=bad',
            { headers: { Cookie: 'mgc_oauth_state=nonce-1' } }
        ),
        env
    );
    assert.equal(response.status, 400);
});

test('handleAuthCallback rejects mismatched OAuth state', async () => {
    const env = createEnv();
    const response = await handleAuthCallback(
        new Request(
            'https://worker.example/auth/callback?shop=demo.myshopify.com&code=abc&hmac=bad&state=nonce-2',
            { headers: { Cookie: 'mgc_oauth_state=nonce-1' } }
        ),
        env
    );
    assert.equal(response.status, 400);
});
