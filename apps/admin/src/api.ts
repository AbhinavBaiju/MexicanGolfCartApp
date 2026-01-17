import { useAppBridge } from '@shopify/app-bridge-react';

export function useAuthenticatedFetch() {
    // In App Bridge v4, useAppBridge() returns the shopify object directly
    const shopify = useAppBridge();

    return async (url: string, options: RequestInit = {}) => {
        // App Bridge v4 uses shopify.idToken() instead of deprecated app.id.getSessionToken()
        const token = await shopify.idToken();
        const headers = {
            ...options.headers,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        };

        // Ensure URL starts with /
        const path = url.startsWith('/') ? url : `/${url}`;
        const fullUrl = `https://mexican-golf-cart-worker.explaincaption.workers.dev/admin${path}`;

        const response = await fetch(fullUrl, {
            ...options,
            headers,
        });

        if (response.status === 401) {
            // Handle token expiry if needed
            console.error("Authenticated request failed: 401");
        }

        return response;
    };
}

