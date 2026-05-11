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
const originalFetch = globalThis.fetch?.bind(globalThis);
const TEST_PPM_FALLBACK = "P3\n1 1\n255\n255 255 255\n";

class ImageDataMock {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(dataOrWidth: Uint8ClampedArray | number, width?: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth;
      this.height = width ?? 0;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
      return;
    }

    this.data = dataOrWidth;
    this.width = width ?? 0;
    this.height = height ?? 0;
  }
}

function createImageDataMock(width: number, height: number) {
  return new ImageData(width, height);
}

function createCanvasContextMock(canvas: HTMLCanvasElement) {
  const noop = () => undefined;
  const imageDataFactory = (width: number, height: number) => createImageDataMock(width, height);

  return {
    canvas,
    globalAlpha: 1,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    imageSmoothingEnabled: false,
    createImageData: imageDataFactory,
    getImageData: imageDataFactory,
    putImageData: noop,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    drawImage: noop,
    fillText: noop,
    strokeText: noop,
    measureText: (text: string) =>
      ({
        width: text.length * 8,
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: text.length * 8,
        fontBoundingBoxAscent: 8,
        fontBoundingBoxDescent: 2,
        alphabeticBaseline: 0,
        emHeightAscent: 8,
        emHeightDescent: 2,
        hangingBaseline: 0,
        ideographicBaseline: 0,
      }) as TextMetrics,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    rect: noop,
    stroke: noop,
    fill: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    setLineDash: noop,
  } as unknown as CanvasRenderingContext2D;
}

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

if (typeof globalThis.ImageData === "undefined") {
  Object.defineProperty(globalThis, "ImageData", {
    configurable: true,
    writable: true,
    value: ImageDataMock,
  });
}

if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value(this: HTMLCanvasElement, contextId: string) {
      if (contextId !== "2d") {
        return null;
      }
      return createCanvasContextMock(this);
    },
  });

  if (typeof HTMLCanvasElement.prototype.toDataURL !== "function") {
    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      configurable: true,
      writable: true,
      value() {
        return "data:image/png;base64,";
      },
    });
  }
}

if (typeof globalThis.createImageBitmap !== "function") {
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    writable: true,
    value: async () =>
      ({
        width: 1,
        height: 1,
        close() {
          return undefined;
        },
      }) as ImageBitmap,
  });
}

// Stub URL.createObjectURL / revokeObjectURL para suprimir warnings de
// "not fully decoded/resolved objectURL" no jsdom durante testes de assets.
if (typeof URL.createObjectURL !== "function") {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: () => `blob:mock-object-url-${Math.random().toString(36).slice(2)}`,
  });
}

if (typeof URL.revokeObjectURL !== "function") {
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
}

// Suprimir warnings de --localstorage-file do host Node (externo ao repo).
// Esses warnings vêm do runtime do Vitest/jsdom e não indicam falha real.
const _originalConsoleWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const msg = args.length > 0 ? String(args[0]) : "";
  if (
    msg.includes("--localstorage-file") ||
    msg.includes("objectURL") ||
    msg.includes("not fully decoded")
  ) {
    return;
  }
  _originalConsoleWarn(...args);
};

if (typeof originalFetch === "function") {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (!requestUrl.startsWith("asset://")) {
        return originalFetch(input as RequestInfo, init);
      }

      const absolutePath = decodeURIComponent(requestUrl.slice("asset://".length));
      if (absolutePath.toLowerCase().endsWith(".ppm")) {
        return new Response(TEST_PPM_FALLBACK, { status: 200 });
      }

      return new Response(new Uint8Array([0]), { status: 200 });
    },
  });
}
