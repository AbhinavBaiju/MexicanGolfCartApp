import { useCallback } from 'react';

interface ShopifyAppBridge {
    idToken: () => Promise<string>;
}

function getShopifyAppBridge(): ShopifyAppBridge {
    if (typeof window === 'undefined') {
        throw new Error('Shopify App Bridge is not available in a server environment.');
    }

    const shopify = (window as Window & { shopify?: ShopifyAppBridge }).shopify;
    if (!shopify) {
        throw new Error(
            'Shopify App Bridge is not initialized. Ensure the App Bridge script tag is present and the app is loaded from Shopify admin.'
        );
    }

    if (typeof shopify.idToken !== 'function') {
        throw new Error('Shopify App Bridge idToken() is unavailable.');
    }

    return shopify;
}

export function useAuthenticatedFetch() {
    return useCallback(async (url: string, options: RequestInit = {}) => {
        const shopify = getShopifyAppBridge();
        const token = await shopify.idToken();
        const headers = new Headers(options.headers);
        headers.set('Authorization', `Bearer ${token}`);
        if (!headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }

        const path = url.startsWith('/') ? url : `/${url}`;
        const fullUrl = `https://mexican-golf-cart-worker.explaincaption.workers.dev/admin${path}`;

        const response = await fetch(fullUrl, {
            ...options,
            headers,
        });

        if (response.status === 401) {
            console.error('Authenticated request failed: 401');
        }

        return response;
    }, []);
}
