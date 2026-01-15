import { Env } from './types';

/**
 * Common HMAC verification helper
 */
async function verifySignature(params: URLSearchParams, secret: string, signatureKey: string): Promise<boolean> {
    const signatureHex = params.get(signatureKey);
    if (!signatureHex) return false;

    const tempParams = new URLSearchParams(params);
    tempParams.delete(signatureKey);
    // Remove the other potential key to be safe, though usually only one is present
    if (signatureKey === 'hmac') tempParams.delete('signature');
    if (signatureKey === 'signature') tempParams.delete('hmac');

    // Sort parameters
    const entries = Array.from(tempParams.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const message = entries.map(([k, v]) => `${k}=${v}`).join('');

    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(message);

    const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
    );

    // Convert hex signature to buffer
    const signature = new Uint8Array(
        signatureHex.match(/[\da-f]{2}/gi)!.map((h) => parseInt(h, 16))
    );

    return await crypto.subtle.verify('HMAC', key, signature, messageData);
}

/**
 * Verifies the HMAC signature for Shopify Admin OAuth (uses 'hmac' param and '&' separator)
 */
export async function verifyHmac(params: URLSearchParams, secret: string): Promise<boolean> {
    const hmac = params.get('hmac');
    if (!hmac) return false;

    const tempParams = new URLSearchParams(params);
    tempParams.delete('hmac');
    tempParams.delete('signature');

    const entries = Array.from(tempParams.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const message = entries.map(([k, v]) => `${k}=${v}`).join('&');

    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(message);

    const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
    );

    const signature = new Uint8Array(
        hmac.match(/[\da-f]{2}/gi)!.map((h) => parseInt(h, 16))
    );

    return await crypto.subtle.verify('HMAC', key, signature, messageData);
}

/**
 * Verifies the signature for Shopify App Proxy requests (uses 'signature' param)
 * Note: App Proxy signature verification often differs slightly in separator usage compared to OAuth.
 * Documentation suggests using the sorted query string (implies '&').
 */
export async function verifyProxySignature(request: Request, secret: string): Promise<boolean> {
    const url = new URL(request.url);
    const params = url.searchParams;
    const signatureHex = params.get('signature');

    if (!signatureHex) return false;

    const tempParams = new URLSearchParams(params);
    tempParams.delete('signature');

    // Sort parameters
    const entries = Array.from(tempParams.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    // Use '&' as strict separator for Proxy as well, as it is a "sorted query string"
    const message = entries.map(([k, v]) => `${k}=${v}`).join('');

    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(message);

    const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
    );

    const signature = new Uint8Array(
        signatureHex.match(/[\da-f]{2}/gi)!.map((h) => parseInt(h, 16))
    );

    return await crypto.subtle.verify('HMAC', key, signature, messageData);
}
