import { handleAuth, handleAuthCallback } from './auth';
import { handleWebhook } from './webhooks';
import { handleProxyRequest } from './proxy';
import { Env } from './types';

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

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

        return new Response('Mexican Golf Cart Worker is Running');
    },
};
