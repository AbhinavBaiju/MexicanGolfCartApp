import { handleAuth, handleAuthCallback } from './auth';
import { handleWebhook } from './webhooks';
import { handleProxyRequest } from './proxy';
import { handleAdminRequest } from './admin';
import { handleScheduled } from './scheduled';
import { Env } from './types';

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        // Global CORS for OPTIONS
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                }
            });
        }

        if (url.pathname === '/auth') {
            return handleAuth(request, env);
        }

        if (url.pathname === '/auth/callback') {
            return handleAuthCallback(request, env);
        }

        if (url.pathname.startsWith('/webhooks')) {
            return handleWebhook(request, env);
        }

        if (url.pathname.startsWith('/proxy')) {
            return handleProxyRequest(request, env);
        }

        if (url.pathname.startsWith('/admin')) {
            return handleAdminRequest(request, env);
        }

        return new Response('Mexican Golf Cart Worker is Running');
    },
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
        ctx.waitUntil(handleScheduled(event, env));
    },
};
