import { Env } from './types';
import { verifyHmac } from './security';

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
