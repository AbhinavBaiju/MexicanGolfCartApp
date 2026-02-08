import '@testing-library/jest-dom/vitest';

class ResizeObserverMock implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

if (typeof window !== 'undefined') {
    if (!window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            addListener: () => undefined,
            removeListener: () => undefined,
            dispatchEvent: () => false,
        })) as typeof window.matchMedia;
    }

    if (!window.ResizeObserver) {
        window.ResizeObserver = ResizeObserverMock;
    }

    if (!window.scrollTo) {
        window.scrollTo = () => undefined;
    }
}
