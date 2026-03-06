import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

import { emulatorReadMemory } from "./emulatorService";

describe("emulatorReadMemory", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockReset();
  });

  it("invokes the Tauri memory reader with canonical arguments", async () => {
    const payload = { ok: true, data: [0x10, 0x11, 0x12], total_size: 64 };
    mocks.invoke.mockResolvedValue(payload);

    await expect(emulatorReadMemory(2, 0x10, 0x20)).resolves.toEqual(payload);

    expect(mocks.invoke).toHaveBeenCalledWith("emulator_read_memory", {
      region: 2,
      offset: 0x10,
      length: 0x20,
    });
  });
});
