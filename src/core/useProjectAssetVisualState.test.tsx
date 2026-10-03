import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const pending = vi.hoisted(() => new Map<string, (value: ImageData) => void>());

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock("./ppmImage", () => ({
  isPpmPath: (path: string) => path.endsWith(".ppm"),
  loadProjectPpmImageData: (_projectDir: string, relativePath: string) =>
    new Promise<ImageData>((resolve) => pending.set(relativePath, resolve)),
  imageDataToPngDataUrl: (imageData: ImageData & { tag?: string }) => `data:image/png;${imageData.tag}`,
}));

import { useProjectAssetVisualState } from "./useProjectAssetVisualState";

function Probe({ relativePath }: { relativePath: string }) {
  const { src } = useProjectAssetVisualState({ projectDir: "/p", relativePath });
  return <span data-testid="src">{src ?? "none"}</span>;
}

describe("useProjectAssetVisualState", () => {
  it("never lets a late response for a previous asset replace the current thumbnail", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Probe relativePath="a.ppm" />));
    await act(async () => root.render(<Probe relativePath="b.ppm" />));
    await act(async () => pending.get("b.ppm")!({ tag: "b" } as unknown as ImageData));
    expect(container.textContent).toBe("data:image/png;b");
    // A resposta de "a.ppm" chega depois: deve ser descartada.
    await act(async () => pending.get("a.ppm")!({ tag: "a" } as unknown as ImageData));
    expect(container.textContent).toBe("data:image/png;b");
    await act(async () => root.unmount());
  });
});
