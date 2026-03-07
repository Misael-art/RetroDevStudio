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

import { emulatorReadMemory, listenToAudioStream } from "./emulatorService";

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

describe("listenToAudioStream", () => {
  beforeEach(() => {
    mocks.listen.mockReset();
  });

  it("subscribes to the canonical emulator audio event", async () => {
    const unlisten = vi.fn();
    const payload = { sample_rate: 44100, samples: [1, -1, 2, -2] };
    mocks.listen.mockResolvedValue(unlisten);

    const received = vi.fn();
    const stop = await listenToAudioStream(received);
    const handler = mocks.listen.mock.calls[0]?.[1] as ((event: { payload: typeof payload }) => void);

    expect(mocks.listen).toHaveBeenCalledWith("emulator://audio", expect.any(Function));
    handler({ payload });
    expect(received).toHaveBeenCalledWith(payload);
    stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
