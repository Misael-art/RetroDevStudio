import { useEffect, useMemo, useState } from "react";

import type { LegacySgdkIndex } from "../../core/ipc/sceneService";
import { listenToProjectAssetChanges } from "../../core/ipc/projectWatcherService";
import {
  listProjectAssets,
  readLegacyProjectFile,
  type LegacyProjectFilePreview,
  type ProjectAssetEntry,
} from "../../core/ipc/toolsService";
import {
  buildLegacyIndexSections,
  type AssetBrowserState,
  type LegacyIndexSection,
} from "./assetBrowserModel";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type UseAssetBrowserStateOptions = {
  activeProjectDir: string;
  projectSourceKind: string;
  projectLegacyIndex: LegacySgdkIndex | null;
};

type UseAssetBrowserStateResult = AssetBrowserState & {
  legacySections: LegacyIndexSection[];
  setViewMode: (mode: "grid" | "tree") => void;
  toggleTreeNode: (path: string) => void;
  selectTreeAsset: (asset: ProjectAssetEntry) => void;
  clearTreeSelection: () => void;
  selectLegacyFile: (relativePath: string) => Promise<void>;
  clearLegacyPreview: () => void;
};

export function useAssetBrowserState(
  options: UseAssetBrowserStateOptions
): UseAssetBrowserStateResult {
  const { activeProjectDir, projectSourceKind, projectLegacyIndex } = options;
  const [assets, setAssets] = useState<ProjectAssetEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "tree">("tree");
  const [treeCollapsed, setTreeCollapsed] = useState<Set<string>>(new Set());
  const [selectedTreeAsset, setSelectedTreeAsset] = useState<ProjectAssetEntry | null>(null);
  const [selectedLegacyFile, setSelectedLegacyFile] = useState<string | null>(null);
  const [legacyPreview, setLegacyPreview] = useState<LegacyProjectFilePreview | null>(null);
  const [legacyPreviewBusy, setLegacyPreviewBusy] = useState(false);
  const [legacyPreviewError, setLegacyPreviewError] = useState<string | null>(null);

  const legacySections = useMemo(
    () => (projectSourceKind === "external_sgdk" ? buildLegacyIndexSections(projectLegacyIndex) : []),
    [projectLegacyIndex, projectSourceKind]
  );

  useEffect(() => {
    if (!activeProjectDir) {
      setAssets([]);
      setError(null);
      setSelectedTreeAsset(null);
      return;
    }

    let cancelled = false;

    async function loadAssets() {
      setBusy(true);
      try {
        const result = await listProjectAssets(activeProjectDir);
        if (!cancelled) {
          setAssets(result);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(describeError(loadError));
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }

    void loadAssets();

    return () => {
      cancelled = true;
    };
  }, [activeProjectDir]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    if (!activeProjectDir) {
      return () => {};
    }

    void listenToProjectAssetChanges((payload) => {
      if (cancelled || payload.project_dir !== activeProjectDir) {
        return;
      }

      setBusy(true);
      void listProjectAssets(activeProjectDir)
        .then((result) => {
          if (cancelled) {
            return;
          }
          setAssets(result);
          setError(null);
        })
        .catch((loadError) => {
          if (!cancelled) {
            setError(describeError(loadError));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setBusy(false);
          }
        });
    })
      .then((stop) => {
        if (cancelled) {
          stop();
          return;
        }
        unlisten = stop;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [activeProjectDir]);

  useEffect(() => {
    if (projectSourceKind === "external_sgdk" && projectLegacyIndex) {
      return;
    }

    setSelectedLegacyFile(null);
    setLegacyPreview(null);
    setLegacyPreviewError(null);
    setLegacyPreviewBusy(false);
  }, [projectLegacyIndex, projectSourceKind]);

  useEffect(() => {
    if (!selectedTreeAsset) {
      return;
    }
    const stillExists = assets.find((asset) => asset.relative_path === selectedTreeAsset.relative_path) ?? null;
    setSelectedTreeAsset(stillExists);
  }, [assets, selectedTreeAsset]);

  function toggleTreeNode(path: string) {
    setTreeCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function selectTreeAsset(asset: ProjectAssetEntry) {
    setSelectedTreeAsset(asset);
    setSelectedLegacyFile(null);
    setLegacyPreview(null);
    setLegacyPreviewError(null);
  }

  function clearLegacyPreview() {
    setSelectedLegacyFile(null);
    setLegacyPreview(null);
    setLegacyPreviewError(null);
    setLegacyPreviewBusy(false);
  }

  async function selectLegacyFile(relativePath: string) {
    if (!activeProjectDir) {
      return;
    }

    setSelectedLegacyFile(relativePath);
    setSelectedTreeAsset(null);
    setLegacyPreviewBusy(true);
    setLegacyPreviewError(null);
    try {
      const result = await readLegacyProjectFile(activeProjectDir, relativePath);
      setLegacyPreview(result);
    } catch (previewError) {
      setLegacyPreview(null);
      setLegacyPreviewError(describeError(previewError));
    } finally {
      setLegacyPreviewBusy(false);
    }
  }

  return {
    assets,
    busy,
    error,
    viewMode,
    treeCollapsed,
    selectedTreeAsset,
    selectedLegacyFile,
    legacyPreview,
    legacyPreviewBusy,
    legacyPreviewError,
    legacySections,
    setViewMode,
    toggleTreeNode,
    selectTreeAsset,
    clearTreeSelection: () => setSelectedTreeAsset(null),
    selectLegacyFile,
    clearLegacyPreview,
  };
}
