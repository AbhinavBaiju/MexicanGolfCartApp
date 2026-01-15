interface RateLimitState {
    count: number;
    resetAt: number;
}

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
}

const store = new Map<string, RateLimitState>();

export function checkRateLimit(key: string, max: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const existing = store.get(key);
    if (!existing || now >= existing.resetAt) {
        const resetAt = now + windowMs;
        store.set(key, { count: 1, resetAt });
        return { allowed: true, remaining: max - 1, resetAt };
    }

    if (existing.count >= max) {
        return { allowed: false, remaining: 0, resetAt: existing.resetAt };
    }

    existing.count += 1;
    store.set(key, existing);
    return { allowed: true, remaining: max - existing.count, resetAt: existing.resetAt };
}
