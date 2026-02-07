import { Env } from './types';
import { verifyHmac } from './security';

interface JwtHeader {
    alg: string;
    kid?: string;
    typ?: string;
}

export interface SessionTokenPayload {
    iss: string;
    dest: string;
    aud: string | string[];
    exp: number;
    nbf?: number;
    iat?: number;
    sub?: string;
    sid?: string;
}

interface JsonWebKeyWithKid extends JsonWebKey {
    kid?: string;
}

interface JwksResponse {
    keys: JsonWebKeyWithKid[];
}

const jwksCache: { keys: Map<string, JsonWebKey>; fetchedAt: number } = {
    keys: new Map<string, JsonWebKey>(),
    fetchedAt: 0,
};

const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_JWKS_URL = 'https://shopify.dev/.well-known/jwks.json';

export async function handleAuth(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');

    if (!shop) {
        return new Response('Missing shop parameter', { status: 400 });
    }

    // Generate a random nonce
    const nonce = crypto.randomUUID();

    // Scopes required
    const scopes = 'read_products,write_products,read_orders,write_orders';
    const redirectUri = `${env.SHOPIFY_APP_URL}/auth/callback`;
    const accessMode = 'offline'; // We need offline token for background worker

    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${env.SHOPIFY_API_KEY}&scope=${scopes}&redirect_uri=${redirectUri}&state=${nonce}&grant_options[]=${accessMode}`;

    return Response.redirect(authUrl);
}

export async function verifySessionToken(
    token: string,
    secret: string,
    apiKey: string,
    jwksUrl?: string
): Promise<SessionTokenPayload | null> {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) {
            console.error('Session token: invalid structure (expected 3 parts)');
            return null;
        }
        const [encodedHeader, encodedPayload, encodedSignature] = parts;
        const header = decodeBase64UrlJson<JwtHeader>(encodedHeader);
        const payload = decodeBase64UrlJson<SessionTokenPayload>(encodedPayload);

        if (!header || !payload) {
            console.error('Session token: failed to decode header or payload');
            return null;
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) {
            console.error('Session token: expired', { exp: payload.exp, now: nowSeconds });
            return null;
        }
        if (payload.nbf && payload.nbf > nowSeconds) {
            console.error('Session token: not yet valid (nbf in future)', { nbf: payload.nbf, now: nowSeconds });
            return null;
        }

        if (!isAudienceMatch(payload.aud, apiKey)) {
            console.error('Session token: audience mismatch', { aud: payload.aud, expected: apiKey });
            return null;
        }

        const destHost = safeUrlHost(payload.dest);
        const issHost = safeUrlHost(payload.iss);
        if (!destHost || !issHost || destHost !== issHost) {
            console.error('Session token: iss/dest host mismatch', { iss: payload.iss, dest: payload.dest });
            return null;
        }

        const signingInput = `${encodedHeader}.${encodedPayload}`;
        const signature = base64UrlToUint8Array(encodedSignature);
        const data = new TextEncoder().encode(signingInput);

        if (header.alg === 'RS256') {
            const jwk = await getShopifyJwk(header.kid, jwksUrl);
            if (!jwk) {
                console.error('Session token: RS256 JWK not found', { kid: header.kid });
                return null;
            }
            const key = await crypto.subtle.importKey(
                'jwk',
                jwk,
                { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
                false,
                ['verify']
            );
            const verified = await crypto.subtle.verify(
                'RSASSA-PKCS1-v1_5',
                key,
                signature as BufferSource,
                data as BufferSource
            );
            if (!verified) {
                console.error('Session token: RS256 signature verification failed');
            }
            return verified ? payload : null;
        }

        if (header.alg === 'HS256') {
            if (!secret || secret.trim().length === 0) {
                console.error('Session token: HS256 secret is empty or missing');
                return null;
            }
            const key = await crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode(secret),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['verify']
            );
            const verified = await crypto.subtle.verify('HMAC', key, signature as BufferSource, data as BufferSource);
            if (!verified) {
                console.error('Session token: HS256 signature verification failed');
            }
            return verified ? payload : null;
        }

        console.error('Session token: unsupported algorithm', { alg: header.alg });
        return null;
    } catch (e) {
        console.error('Session token verification failed', e);
        return null;
    }
}

export async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');
    const code = url.searchParams.get('code');
    const hmac = url.searchParams.get('hmac');
    // const state = url.searchParams.get('state'); // In a real app, verify this matches the nonce set in cookie

    if (!shop || !code || !hmac) {
        return new Response('Missing required parameters', { status: 400 });
    }

    // 1. Verify HMAC
    const valid = await verifyHmac(url.searchParams, env.SHOPIFY_API_SECRET);
    if (!valid) {
        return new Response('HMAC validation failed', { status: 400 });
    }

    // 2. Exchange access token
    const accessToken = await exchangeAccessToken(shop, code, env);
    if (!accessToken) {
        return new Response('Failed to exchange access token', { status: 500 });
    }

    // 3. Store in DB
    try {
        await env.DB.prepare(
            `INSERT INTO shops (shop_domain, access_token, installed_at) 
       VALUES (?, ?, datetime('now')) 
       ON CONFLICT(shop_domain) DO UPDATE SET 
       access_token = excluded.access_token, 
       uninstalled_at = NULL,
       installed_at = datetime('now')`
        )
            .bind(shop, accessToken)
            .run();
    } catch (e) {
        console.error('Database error:', e);
        return new Response('Failed to store shop data', { status: 500 });
    }

    // 4. Register Webhook
    await registerWebhook(shop, accessToken, env);

    // Redirect to the embedded app UI or Shopify Admin
    // Usually https://admin.shopify.com/store/{shop_name}/apps/{app_name}
    // For now, simple success message or redirect to app home
    // Using the host param if available to properly redirect inside admin
    const host = url.searchParams.get('host');
    if (host) {
        // Decode host to base64 for the URL if needed, but usually it's passed through
        // Actually, we usually redirect to the app's UI served by Shopify or our own UI
        // If this is a pure backend app, maybe just say "Installed!"
        return new Response(`App installed successfully for ${shop}! You can close this window.`);
    }

    return new Response(`App installed successfully for ${shop}!`);
}



async function exchangeAccessToken(shop: string, code: string, env: Env): Promise<string | null> {
    const body = {
        client_id: env.SHOPIFY_API_KEY,
        client_secret: env.SHOPIFY_API_SECRET,
        code,
    };

    try {
        const resp = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const txt = await resp.text();
            console.error('Token exchange failed', resp.status, txt);
            return null;
        }

        const data = await resp.json() as { access_token: string };
        return data.access_token;
    } catch (e) {
        console.error('Token exchange error', e);
        return null;
    }
}

async function registerWebhook(shop: string, accessToken: string, env: Env) {
    const webhooks = [
        {
            topic: 'orders/create',
            address: `${env.SHOPIFY_APP_URL}/webhooks/orders/create`,
            format: 'json',
        },
        {
            topic: 'app/uninstalled',
            address: `${env.SHOPIFY_APP_URL}/webhooks/app/uninstalled`,
            format: 'json',
        }
    ];

    const apiVersion = '2026-04';

    for (const hook of webhooks) {
        try {
            const resp = await fetch(`https://${shop}/admin/api/${apiVersion}/webhooks.json`, {
                method: 'POST',
                headers: {
                    'X-Shopify-Access-Token': accessToken,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ webhook: hook }),
            });

            if (!resp.ok) {
                const txt = await resp.text();
                // 422 usually means already exists
                console.log(`Webhook ${hook.topic} registration result:`, resp.status, txt);
            } else {
                console.log(`Webhook ${hook.topic} registered successfully`);
            }
        } catch (e) {
            console.error(`Webhook ${hook.topic} registration failed`, e);
        }
    }
}

function decodeBase64UrlJson<T>(input: string): T | null {
    try {
        const json = new TextDecoder().decode(base64UrlToUint8Array(input));
        return JSON.parse(json) as T;
    } catch {
        return null;
    }
}

function base64UrlToUint8Array(input: string): Uint8Array {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const base64 = normalized + padding;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function isAudienceMatch(aud: string | string[], apiKey: string): boolean {
    if (typeof aud === 'string') {
        return aud === apiKey;
    }
    if (Array.isArray(aud)) {
        return aud.includes(apiKey);
    }
    return false;
}

function safeUrlHost(value: string): string | null {
    try {
        return new URL(value).host;
    } catch {
        return null;
    }
}

async function getShopifyJwk(kid?: string, jwksUrl?: string): Promise<JsonWebKey | null> {
    try {
        const url = jwksUrl || DEFAULT_JWKS_URL;
        const now = Date.now();
        if (jwksCache.keys.size === 0 || now - jwksCache.fetchedAt > JWKS_CACHE_TTL_MS) {
            const resp = await fetch(url);
            if (!resp.ok) {
                return null;
            }
            const data = (await resp.json()) as JwksResponse;
            const map = new Map<string, JsonWebKey>();
            for (const key of data.keys) {
                if (key.kid) {
                    map.set(key.kid, key);
                }
            }
            jwksCache.keys = map;
            jwksCache.fetchedAt = now;
        }

        if (kid) {
            return jwksCache.keys.get(kid) || null;
        }

        const first = jwksCache.keys.values().next();
        return first.done ? null : first.value;
    } catch (e) {
        console.error('Failed to fetch Shopify JWKS', e);
        return null;
    }
}
