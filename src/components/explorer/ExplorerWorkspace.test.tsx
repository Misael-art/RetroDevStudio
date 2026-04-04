import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ExplorerWorkspace from "./ExplorerWorkspace";
import { useEditorStore } from "../../core/store/editorStore";
import type { LegacySgdkIndex } from "../../core/ipc/sceneService";

const mocks = vi.hoisted(() => ({
  listScenes: vi.fn(),
  switchScene: vi.fn(),
  listProjectAssets: vi.fn(),
  readLegacyProjectFile: vi.fn(),
  listenToProjectAssetChanges: vi.fn(),
  hydrateSceneResult: vi.fn(),
  persistActiveScene: vi.fn(),
}));

vi.mock("../common/AssetPreview", () => ({
  default: ({ alt }: { alt: string }) => <div data-testid="asset-preview">{alt}</div>,
}));

vi.mock("../../core/ipc/sceneService", () => ({
  listScenes: mocks.listScenes,
  switchScene: mocks.switchScene,
}));

vi.mock("../../core/ipc/toolsService", () => ({
  listProjectAssets: mocks.listProjectAssets,
  readLegacyProjectFile: mocks.readLegacyProjectFile,
}));

vi.mock("../../core/ipc/projectWatcherService", () => ({
  listenToProjectAssetChanges: mocks.listenToProjectAssetChanges,
}));

vi.mock("../../core/scenePersistence", () => ({
  hydrateSceneResult: mocks.hydrateSceneResult,
  persistActiveScene: mocks.persistActiveScene,
}));

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent?.includes(label)
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }

  return button;
}

const LEGACY_INDEX: LegacySgdkIndex = {
  host_root: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/legacy",
  source_files: ["src/main.c", "src/player.c"],
  header_files: ["inc/main.h"],
  manifest_files: ["res/game.res"],
  resource_files: ["assets/hero.png"],
  output_files: [],
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("ExplorerWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();

    mocks.listScenes.mockResolvedValue([
      {
        path: "scenes/main.json",
        scene_id: "main",
        display_name: "Main Scene",
      },
    ]);
    mocks.listProjectAssets.mockResolvedValue([
      {
        relative_path: "assets/sprites/hero.png",
        absolute_path:
          "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/assets/sprites/hero.png",
        kind: "image",
      },
    ]);
    mocks.listenToProjectAssetChanges.mockResolvedValue(() => {});
    mocks.readLegacyProjectFile.mockResolvedValue({
      relative_path: "src/main.c",
      absolute_path:
        "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/legacy/src/main.c",
      content: "int main(void) { return 0; }",
      previewable: true,
      readonly: true,
      note: "Arquivo legado somente leitura.",
    });
    mocks.hydrateSceneResult.mockResolvedValue({
      sourceScene: null,
      resolvedScene: null,
    });
    mocks.persistActiveScene.mockResolvedValue(true);

    useEditorStore.setState({
      activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      activeProjectName: "Legacy Host",
      activeTarget: "megadrive",
      activeScenePath: "scenes/main.json",
      activeScene: null,
      activeSceneSource: null,
      projectSourceKind: "external_sgdk",
      projectLegacyIndex: structuredClone(LEGACY_INDEX),
      selectedEntityId: null,
      consoleEntries: [],
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<ExplorerWorkspace />);
      await flush();
      await flush();
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it("explains the legacy overlay contract before anything is selected", () => {
    expect(container.querySelector("[data-testid='legacy-host-summary']")?.textContent).toContain(
      "Overlay SGDK"
    );
    expect(container.querySelector("[data-testid='legacy-host-summary']")?.textContent).toContain(
      "Overlay rds/"
    );
    expect(container.querySelector("[data-testid='legacy-host-summary']")?.textContent).toContain(
      "Build & Run delega ao Makefile do host"
    );
    expect(container.querySelector("[data-testid='legacy-host-summary']")?.textContent).toContain(
      "5 arquivo(s) indexado(s)"
    );
    expect(container.querySelector("[data-testid='legacy-host-summary']")?.textContent).toContain(
      LEGACY_INDEX.host_root
    );
    expect(container.querySelector("[data-testid='explorer-empty-state-copy']")?.textContent).toContain(
      "overlay"
    );
    expect(container.querySelector("[data-testid='explorer-empty-state-copy']")?.textContent).toContain(
      "somente leitura"
    );
  });

  it("labels scene and asset selections as overlay content in legacy SGDK projects", async () => {
    await act(async () => {
      findButton(container, "Main Scene").click();
      await flush();
    });

    expect(container.querySelector("[data-testid='explorer-selection-source']")?.textContent).toContain(
      "Origem: overlay rds/scenes"
    );

    await act(async () => {
      findButton(container, "hero.png").click();
      await flush();
    });

    expect(container.querySelector("[data-testid='explorer-selection-source']")?.textContent).toContain(
      "Origem: assets canônicos do overlay"
    );
  });
});
