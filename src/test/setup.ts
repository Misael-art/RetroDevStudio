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

class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length() {
    return this.#entries.size;
  }

  clear() {
    this.#entries.clear();
  }

  getItem(key: string) {
    return this.#entries.has(key) ? this.#entries.get(key)! : null;
  }

  key(index: number) {
    return Array.from(this.#entries.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.#entries.delete(key);
  }

  setItem(key: string, value: string) {
    this.#entries.set(String(key), String(value));
  }
}

function ensureStorage(name: "localStorage" | "sessionStorage") {
  const current = globalThis[name];
  if (
    current &&
    typeof current.getItem === "function" &&
    typeof current.setItem === "function" &&
    typeof current.removeItem === "function" &&
    typeof current.clear === "function"
  ) {
    return;
  }

  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: storage,
  });

  if (typeof window !== "undefined") {
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: storage,
    });
  }
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverPolyfill;
}

if (typeof window !== "undefined" && typeof window.ResizeObserver === "undefined") {
  (window as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    ResizeObserverPolyfill;
}

ensureStorage("localStorage");
ensureStorage("sessionStorage");
