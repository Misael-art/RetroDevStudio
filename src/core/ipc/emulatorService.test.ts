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

import {
  keyToJoypad,
  emulatorPlayReplay,
  emulatorReadMemory,
  emulatorStartRecording,
  emulatorStopRecording,
  listenToAudioStream,
} from "./emulatorService";

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

describe("replay commands", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("invokes canonical replay recording commands", async () => {
    mocks.invoke.mockResolvedValue({
      ok: true,
      message: "ok",
      replay_path: "F:/replay.rds-replay",
      frames_recorded: 2,
      framebuffer_match: true,
    });

    await emulatorStartRecording();
    await emulatorStopRecording("F:/Projects/Test");
    await emulatorPlayReplay("F:/Projects/Test/replay.rds-replay");

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "emulator_start_recording");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "emulator_stop_recording", {
      projectDir: "F:/Projects/Test",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "emulator_play_replay", {
      replayPath: "F:/Projects/Test/replay.rds-replay",
    });
  });
});

describe("keyToJoypad", () => {
  const idle = {
    b: false, y: false, select: false, start: false, up: false, down: false,
    left: false, right: false, a: false, x: false, l: false, r: false,
  };

  it("routes Z/X/C to the RetroPad ids Genesis Plus GX binds to Mega Drive A/B/C", () => {
    expect(keyToJoypad(idle, "KeyZ", true)).toEqual({ ...idle, y: true });
    expect(keyToJoypad(idle, "KeyX", true, "megadrive")).toEqual({ ...idle, b: true });
    expect(keyToJoypad(idle, "KeyC", true, "megadrive")).toEqual({ ...idle, a: true });
    expect(keyToJoypad({ ...idle, y: true }, "KeyZ", false)).toEqual(idle);
  });

  it("keeps the native RetroPad layout for SNES", () => {
    expect(keyToJoypad(idle, "KeyZ", true, "snes")).toEqual({ ...idle, a: true });
    expect(keyToJoypad(idle, "KeyC", true, "snes")).toEqual({ ...idle, y: true });
  });

  it("ignores unmapped keys", () => {
    expect(keyToJoypad(idle, "KeyQ", true)).toBeNull();
  });
});
