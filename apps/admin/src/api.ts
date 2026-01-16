import { useAppBridge } from '@shopify/app-bridge-react';

export function useAuthenticatedFetch() {
    const app = useAppBridge();

    return async (url: string, options: RequestInit = {}) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const token = await (app as any).id.getSessionToken();
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
