import { handleAuth, handleAuthCallback } from './auth';
import { handleWebhook } from './webhooks';
import { handleProxyRequest } from './proxy';
import { handleAdminRequest } from './admin';
import { handleScheduled } from './scheduled';
import { Env } from './types';

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };

        // Global CORS for OPTIONS
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: corsHeaders,
            });
        }

        let response: Response;

        try {
            if (url.pathname === '/auth') {
                response = await handleAuth(request, env);
            } else if (url.pathname === '/auth/callback') {
                response = await handleAuthCallback(request, env);
            } else if (url.pathname.startsWith('/webhooks')) {
                response = await handleWebhook(request, env);
            } else if (url.pathname.startsWith('/proxy')) {
                response = await handleProxyRequest(request, env);
            } else if (url.pathname.startsWith('/admin')) {
                response = await handleAdminRequest(request, env);
            } else {
                response = new Response('Mexican Golf Cart Worker is Running');
            }
        } catch (e) {
            console.error('Worker Error:', e);
            response = new Response('Internal Server Error', { status: 500 });
        }

        // Clone headers to avoid mutating a potentially immutable Headers object
        const newHeaders = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([key, value]) => {
            newHeaders.set(key, value);
        });

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
        });
    },
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
        ctx.waitUntil(handleScheduled(event, env));
    },
};
