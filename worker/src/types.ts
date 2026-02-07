export interface Env {
    DB: D1Database;
    /** Optional runtime environment marker (e.g. 'dev', 'prod'). */
    ENVIRONMENT?: string;
    /** Comma-separated list of allowed admin SPA origins for /admin CORS in non-dev envs. */
    ADMIN_ALLOWED_ORIGINS?: string;
    SHOPIFY_API_KEY: string;
    SHOPIFY_API_SECRET: string;
    SHOPIFY_APP_URL: string;
    SHOPIFY_JWKS_URL?: string;
}
