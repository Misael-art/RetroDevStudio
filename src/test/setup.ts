/**
 * Vitest setup — mocks globais para ambiente jsdom.
 * ResizeObserver não existe em jsdom; react-resizable-panels depende dele.
 */
class ResizeObserverMock {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

const ResizeObserverPolyfill = ResizeObserverMock as unknown as typeof ResizeObserver;

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverPolyfill;
}

if (typeof window !== "undefined" && typeof window.ResizeObserver === "undefined") {
  (window as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    ResizeObserverPolyfill;
}
