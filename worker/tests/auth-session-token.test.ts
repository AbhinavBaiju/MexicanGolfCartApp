import assert from 'node:assert/strict';
import test from 'node:test';

import { verifySessionToken } from '../src/auth';

interface JwtPayload {
    iss: string;
    dest: string;
    aud: string;
    exp: number;
    nbf?: number;
    iat?: number;
}

function toBase64Url(value: string): string {
    return Buffer.from(value, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

async function createHs256Jwt(payload: JwtPayload, secret: string): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = toBase64Url(JSON.stringify(header));
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
    const encodedSignature = Buffer.from(new Uint8Array(signature))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

    return `${signingInput}.${encodedSignature}`;
}

test('verifySessionToken accepts valid HS256 token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await createHs256Jwt(
        {
            iss: 'https://demo.myshopify.com/admin',
            dest: 'https://demo.myshopify.com',
            aud: 'test-api-key',
            exp: now + 300,
            iat: now,
        },
        'test-api-secret'
    );

    const payload = await verifySessionToken(token, 'test-api-secret', 'test-api-key');
    assert.ok(payload, 'Expected valid payload for signed token');
});

test('verifySessionToken rejects expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await createHs256Jwt(
        {
            iss: 'https://demo.myshopify.com/admin',
            dest: 'https://demo.myshopify.com',
            aud: 'test-api-key',
            exp: now - 10,
        },
        'test-api-secret'
    );

    const payload = await verifySessionToken(token, 'test-api-secret', 'test-api-key');
    assert.equal(payload, null);
});

test('verifySessionToken rejects wrong audience', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await createHs256Jwt(
        {
            iss: 'https://demo.myshopify.com/admin',
            dest: 'https://demo.myshopify.com',
            aud: 'other-api-key',
            exp: now + 300,
        },
        'test-api-secret'
    );

    const payload = await verifySessionToken(token, 'test-api-secret', 'test-api-key');
    assert.equal(payload, null);
});

test('verifySessionToken rejects tampered token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await createHs256Jwt(
        {
            iss: 'https://demo.myshopify.com/admin',
            dest: 'https://demo.myshopify.com',
            aud: 'test-api-key',
            exp: now + 300,
        },
        'test-api-secret'
    );
    const [header, encodedPayload, signature] = token.split('.');
    const tamperedPayload = `${encodedPayload.slice(0, -1)}x`;
    const tampered = `${header}.${tamperedPayload}.${signature}`;

    const payload = await verifySessionToken(tampered, 'test-api-secret', 'test-api-key');
    assert.equal(payload, null);
});
