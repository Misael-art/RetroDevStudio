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
  listenToProjectAssetChanges,
  pollProjectAssetChanges,
} from "./projectWatcherService";

describe("pollProjectAssetChanges", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockReset();
  });

  it("polls the canonical Tauri project asset watcher", async () => {
    const payload = { changed: true, changed_paths: ["assets/sprites/hero.ppm"] };
    mocks.invoke.mockResolvedValue(payload);

    await expect(
      pollProjectAssetChanges("F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy")
    ).resolves.toEqual(payload);

    expect(mocks.invoke).toHaveBeenCalledWith("poll_project_asset_changes", {
      projectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
    });
  });
});

describe("listenToProjectAssetChanges", () => {
  beforeEach(() => {
    mocks.listen.mockReset();
  });

  it("subscribes to the canonical project asset change event", async () => {
    const unlisten = vi.fn();
    const payload = {
      project_dir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      changed_paths: ["assets/sprites/hero.ppm"],
    };
    mocks.listen.mockResolvedValue(unlisten);

    const received = vi.fn();
    const stop = await listenToProjectAssetChanges(received);
    const handler = mocks.listen.mock.calls[0]?.[1] as ((event: { payload: typeof payload }) => void);

    expect(mocks.listen).toHaveBeenCalledWith("project://assets-changed", expect.any(Function));
    handler({ payload });
    expect(received).toHaveBeenCalledWith(payload);
    stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
