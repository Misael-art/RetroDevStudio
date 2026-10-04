import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InspectionSpriteFrame } from "../../core/ipc/toolsService";
import SonicPixelEditor from "./SonicPixelEditor";

const frame = {
  width: 2, height: 2, frame_id: "sonic1_sonic/walk-1", data_url: "data:image/png;base64,test",
  sonic_context: { geometry_version: "vdp-column-major-dplc/v1", mapping_index: 6, anchor_x: 1, anchor_y: 1,
    dplc_offset: 100, palette_rgba: Array.from({ length: 16 }, (_, i) => [i * 16, 0, 0, i === 0 ? 0 : 255]),
    pixel_art_tiles: [40, 40, null, 30], tile_uses: [{ art_tile: 40, frames: [6, 7] }, { art_tile: 30, frames: [6] }],
    frames: [{ id: "sonic1_sonic/walk-2", label: "Caminhada · 2", mapping_index: 7 }] },
} as InspectionSpriteFrame;

let root: Root;
let element: HTMLDivElement;
const apply = vi.fn();

beforeEach(async () => {
  apply.mockReset().mockResolvedValue(undefined);
  element = document.createElement("div"); document.body.appendChild(element);
  root = createRoot(element);
  await act(async () => root.render(<SonicPixelEditor frame={frame} disabled={false} onApply={apply} />));
  vi.spyOn(element.querySelector("img")!, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 16, height: 16, right: 16, bottom: 16, toJSON: () => ({}) });
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.restoreAllMocks(); });

async function click(id: string) { await act(async () => (element.querySelector(`[data-testid="${id}"]`) as HTMLElement).click()); }
async function paint(x: number, y: number) {
  await act(async () => element.querySelector("img")!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y })));
}

it("uses backend tile identities and demands explicit shared-frame confirmation", async () => {
  await paint(1, 1);
  expect(element.textContent).toContain("tiles 40");
  expect(element.textContent).toContain("Caminhada · 2");
  expect((element.querySelector('[data-testid="sonic-paint-apply"]') as HTMLButtonElement).disabled).toBe(true);
  await click("sonic-paint-confirm-shared"); await click("sonic-paint-apply");
  expect(apply).toHaveBeenCalledWith([{ x: 0, y: 0, index: 1 }], true);
  expect(element.textContent).toContain("0 pixel(s) na fila");
});

it("index zero remains transparent and undo restores the previous queue", async () => {
  await click("sonic-color-0"); await paint(12, 12);
  expect(element.textContent).toContain("índice 0 (transparente)");
  await paint(1, 1);
  await click("sonic-paint-undo"); await click("sonic-paint-apply");
  expect(apply).toHaveBeenCalledWith([{ x: 1, y: 1, index: 0 }], false);
});

it("an unmapped gap cannot overwrite the paint queue", async () => {
  await paint(12, 12); await paint(1, 12);
  expect(element.textContent).toContain("não pertence a uma peça");
  expect(element.textContent).toContain("1 pixel(s) na fila");
  await click("sonic-paint-apply");
  expect(apply).toHaveBeenCalledWith([{ x: 1, y: 1, index: 1 }], false);
});

it("backend refusal preserves intent for correction instead of displaying success", async () => {
  apply.mockRejectedValue(new Error("sprite_edit_identity_mismatch"));
  await paint(12, 12); await click("sonic-paint-apply");
  expect(element.textContent).toContain("sprite_edit_identity_mismatch");
  expect(element.textContent).toContain("A fila foi preservada");
  expect(element.textContent).toContain("1 pixel(s) na fila");
  expect(element.textContent).not.toContain("Pintura gravada");
});
