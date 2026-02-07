export const DEFAULT_STORE_TIMEZONE = 'America/Mazatlan';

/**
 * Keep Shopify Admin API version in one place to avoid drift across
 * webhook registration, REST, and GraphQL calls.
 */
export const SHOPIFY_ADMIN_API_VERSION = '2026-04';

export const DEFAULT_ADMIN_ALLOWED_ORIGINS = [
    'https://master.mexican-golf-cart-admin.pages.dev',
] as const;

export function isDevEnvironment(environment?: string): boolean {
    return (environment ?? '').trim().toLowerCase() === 'dev';
}

export function normalizeStoreTimezone(timezone: unknown): string {
    if (typeof timezone !== 'string' || timezone.trim().length === 0) {
        return DEFAULT_STORE_TIMEZONE;
    }

    const value = timezone.trim();
    try {
        // Throws RangeError for invalid IANA timezone identifiers.
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return value;
    } catch {
        return DEFAULT_STORE_TIMEZONE;
    }
}

export function parseAdminAllowedOrigins(rawOrigins?: string): string[] {
    const origins = (rawOrigins ?? '')
        .split(',')
        .map((entry) => normalizeOrigin(entry))
        .filter((entry): entry is string => entry !== null);

    if (origins.length > 0) {
        return dedupeStrings(origins);
    }

    return [...DEFAULT_ADMIN_ALLOWED_ORIGINS];
}

function normalizeOrigin(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    try {
        return new URL(trimmed).origin;
    } catch {
        return null;
    }
}

function dedupeStrings(values: string[]): string[] {
    return Array.from(new Set(values));
}
