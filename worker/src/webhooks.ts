import { confirmBookingsFromOrder } from './bookingService';
import { Env } from './types';

export async function handleWebhook(request: Request, env: Env): Promise<Response> {
    const topic = request.headers.get('X-Shopify-Topic');
    const hmac = request.headers.get('X-Shopify-Hmac-Sha256');
    const shopDomain = request.headers.get('X-Shopify-Shop-Domain');
    const eventId = request.headers.get('X-Shopify-Webhook-Id');

    if (!topic || !hmac || !shopDomain || !eventId) {
        console.error('Missing webhook headers');
        return new Response('Missing webhook headers', { status: 400 });
    }

    const rawBody = await request.text();
    const valid = await verifyWebhookHmac(rawBody, hmac, env.SHOPIFY_API_SECRET);

    if (!valid) {
        console.error('Invalid webhook HMAC');
        return new Response('Invalid webhook HMAC', { status: 401 });
    }

    // Process specific topics
    try {
        if (topic === 'app/uninstalled') {
            await handleAppUninstalled(shopDomain, env);
        } else if (topic === 'orders/create') {
            const result = await confirmBookingsFromOrder(env.DB, shopDomain, eventId, topic, rawBody);
            return new Response(result.body, { status: result.status });
        } else {
            console.log('Unhandled webhook topic', topic);
        }
    } catch (e) {
        console.error('Error processing webhook', e);
        return new Response('Internal Server Error', { status: 500 });
    }

    return new Response('Webhook processed');
}

async function handleAppUninstalled(shopDomain: string, env: Env) {
    console.log(`Processing app/uninstalled for ${shopDomain}`);
    try {
        await env.DB.prepare(
            `UPDATE shops SET uninstalled_at = datetime('now'), access_token = NULL WHERE shop_domain = ?`
        )
            .bind(shopDomain)
            .run();
        console.log(`Shop processed uninstall: ${shopDomain}`);
    } catch (e) {
        console.error('Database error during uninstall', e);
        throw e;
    }
}

async function verifyWebhookHmac(body: string, hmac: string, secret: string): Promise<boolean> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const data = encoder.encode(body);

    const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
    );

    const signature = new Uint8Array(
        atob(hmac).split('').map((c) => c.charCodeAt(0))
    );

    return await crypto.subtle.verify('HMAC', key, signature, data);
}
