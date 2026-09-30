import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import MugenVisualComparison from "./MugenVisualComparison";
import type { MugenVisualFrame, MugenVisualReview } from "../../core/mugenReview";

const frame = (action: number, element: number): MugenVisualFrame => ({
  action, element, group: action, image: element, sprite_size: [40, 60], sprite_axis: [20, 60], offset: [0, 0],
  hflip: false, vflip: false, duration: 6, indices_sha256: `indices-${action}-${element}`, palette_sha256: "palette",
  original_sha256: `original-${action}-${element}`, converted_sha256: `converted-${action}-${element}`,
  original_png: `data:image/png;base64,original-${action}-${element}`, converted_png: `data:image/png;base64,converted-${action}-${element}`,
});
const visual: MugenVisualReview = { width: 320, height: 320, anchor: [160, 190], frames: [frame(0, 0), frame(0, 1), frame(200, 0)], loop_start: { "0": 0, "200": 0 }, note: "quantização declarada" };
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

it("changes both actual image hrefs and clears an old frame when another source is loaded", async () => {
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<MugenVisualComparison visual={visual} />));
  const select = host.querySelector('[data-testid="mugen-review-action"]') as HTMLSelectElement;
  await act(async () => { select.value = "200"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  for (const kind of ["original", "converted"]) {
    const svg = host.querySelector(`[data-testid="mugen-review-${kind}"]`)!;
    expect(svg.getAttribute("data-action")).toBe("200");
    expect(svg.querySelector("image")?.getAttribute("href")).toContain(`${kind}-200-0`);
  }
  const next = { ...visual, frames: [frame(20, 0)] };
  await act(async () => root.render(<MugenVisualComparison visual={next} />));
  expect(host.querySelector('[data-testid="mugen-review-original"] image')?.getAttribute("href")).toContain("original-20-0");
  await act(async () => root.unmount());
});

it("plays at the source duration and loops at the persisted loop start", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<MugenVisualComparison visual={visual} />));
  await act(async () => (host.querySelector('[data-testid="mugen-review-play"]') as HTMLButtonElement).click());
  await act(async () => vi.advanceTimersByTime(99));
  expect(host.querySelector('[data-testid="mugen-review-original"]')?.getAttribute("data-element")).toBe("0");
  await act(async () => vi.advanceTimersByTime(1));
  expect(host.querySelector('[data-testid="mugen-review-original"]')?.getAttribute("data-element")).toBe("1");
  await act(async () => vi.advanceTimersByTime(100));
  expect(host.querySelector('[data-testid="mugen-review-original"]')?.getAttribute("data-element")).toBe("0");
  await act(async () => root.unmount());
});
