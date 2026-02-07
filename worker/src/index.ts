import { handleAuth, handleAuthCallback } from './auth';
import { handleWebhook } from './webhooks';
import { handleProxyRequest } from './proxy';
import { handleAdminRequest } from './admin';
import { handleScheduled } from './scheduled';
import { Env } from './types';
import { isDevEnvironment, parseAdminAllowedOrigins } from './config';

const CORS_ALLOW_METHODS = 'GET, POST, PUT, DELETE, PATCH, OPTIONS';
const CORS_ALLOW_HEADERS = 'Content-Type, Authorization';

interface CorsPolicy {
    headers: Headers;
    isAdminPath: boolean;
    hasOriginHeader: boolean;
    isOriginAllowed: boolean;
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const corsPolicy = resolveCorsPolicy(request, env, url.pathname);

        // Global CORS for OPTIONS
        if (request.method === 'OPTIONS') {
            if (corsPolicy.isAdminPath && corsPolicy.hasOriginHeader && !corsPolicy.isOriginAllowed) {
                return new Response('CORS origin is not allowed for admin API', {
                    status: 403,
                    headers: {
                        Vary: 'Origin',
                    },
                });
            }

            return new Response(null, {
                status: 204,
                headers: corsPolicy.headers,
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
        corsPolicy.headers.forEach((value, key) => {
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

function resolveCorsPolicy(request: Request, env: Env, pathname: string): CorsPolicy {
    const headers = new Headers();
    const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');
    const originHeader = request.headers.get('Origin');
    const hasOriginHeader = typeof originHeader === 'string' && originHeader.length > 0;

    if (!isAdminPath) {
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
        headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
        return {
            headers,
            isAdminPath,
            hasOriginHeader,
            isOriginAllowed: true,
        };
    }

    // Keep dev workflow permissive because the embedded tunnel origin can vary.
    if (isDevEnvironment(env.ENVIRONMENT)) {
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
        headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
        return {
            headers,
            isAdminPath,
            hasOriginHeader,
            isOriginAllowed: true,
        };
    }

    if (!hasOriginHeader) {
        return {
            headers,
            isAdminPath,
            hasOriginHeader,
            isOriginAllowed: true,
        };
    }

    const normalizedOrigin = normalizeRequestOrigin(originHeader);
    if (!normalizedOrigin) {
        return {
            headers,
            isAdminPath,
            hasOriginHeader,
            isOriginAllowed: false,
        };
    }

    const allowedOrigins = new Set(parseAdminAllowedOrigins(env.ADMIN_ALLOWED_ORIGINS));
    const isOriginAllowed = allowedOrigins.has(normalizedOrigin);
    if (isOriginAllowed) {
        headers.set('Access-Control-Allow-Origin', normalizedOrigin);
        headers.set('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
        headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
        headers.set('Vary', 'Origin');
    }

    return {
        headers,
        isAdminPath,
        hasOriginHeader,
        isOriginAllowed,
    };
}

function normalizeRequestOrigin(value: string): string | null {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}
