import assert from 'node:assert/strict';
import test from 'node:test';

import { handleWebhook, verifyWebhookHmac } from '../src/webhooks';
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
        SHOPIFY_API_KEY: 'test-api-key',
        SHOPIFY_API_SECRET: 'test-api-secret',
        SHOPIFY_APP_URL: 'https://worker.example',
    };
}

async function signWebhookBody(body: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    return Buffer.from(new Uint8Array(signature)).toString('base64');
}

test('verifyWebhookHmac returns true for valid signature', async () => {
    const body = JSON.stringify({ id: 123 });
    const secret = 'test-api-secret';
    const hmac = await signWebhookBody(body, secret);
    const valid = await verifyWebhookHmac(body, hmac, secret);
    assert.equal(valid, true);
});

test('verifyWebhookHmac returns false for invalid signature', async () => {
    const body = JSON.stringify({ id: 123 });
    const valid = await verifyWebhookHmac(body, 'invalid-signature', 'test-api-secret').catch(() => false);
    assert.equal(valid, false);
});

test('handleWebhook rejects missing required headers', async () => {
    const env = createEnv();
    const response = await handleWebhook(
        new Request('https://worker.example/webhooks/orders/create', {
            method: 'POST',
            body: JSON.stringify({ id: 1 }),
            headers: { 'Content-Type': 'application/json' },
        }),
        env
    );
    assert.equal(response.status, 400);
});
