interface ShopifyToast {
    show: (message: string, options?: { isError?: boolean }) => void;
}

interface ShopifyWindow extends Window {
    shopify?: {
        toast?: ShopifyToast;
    };
}

export function showShopifyToast(message: string, isError = false): void {
    if (typeof window === 'undefined') {
        return;
    }

    const shopifyWindow = window as ShopifyWindow;
    shopifyWindow.shopify?.toast?.show(message, isError ? { isError: true } : undefined);
}
