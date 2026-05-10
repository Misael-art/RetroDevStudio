import { useEffect, useMemo, useState } from "react";

import {
  resolveProjectAssetVisualState,
  type AssetVisualLoadStatus,
  type ProjectAssetVisualState,
} from "./assetVisualState";
import {
  resolveAbsoluteAssetPreviewSrc,
  resolveProjectAssetPreviewSrc,
} from "./pathUtils";

type UseProjectAssetVisualStateOptions = {
  absolutePath?: string | null;
  projectDir?: string | null;
  relativePath?: string | null;
  legacyFallback?: boolean;
  legacyFallbackDetail?: string | null;
};

export function useProjectAssetVisualState(options: UseProjectAssetVisualStateOptions): {
  src: string | null;
  previewStatus: AssetVisualLoadStatus;
  visualState: ProjectAssetVisualState;
  setLoaded: () => void;
  setFailed: () => void;
} {
  const {
    absolutePath,
    projectDir,
    relativePath,
    legacyFallback = false,
    legacyFallbackDetail = null,
  } = options;

  const src = useMemo(() => {
    const absoluteCandidate = String(absolutePath ?? "").trim();
    if (absoluteCandidate) {
      return resolveAbsoluteAssetPreviewSrc(absoluteCandidate);
    }

    const projectCandidate = String(projectDir ?? "").trim();
    const relativeCandidate = String(relativePath ?? "").trim();
    if (projectCandidate && relativeCandidate) {
      return resolveProjectAssetPreviewSrc(projectCandidate, relativeCandidate);
    }

    return null;
  }, [absolutePath, projectDir, relativePath]);

  const hadPathIntent = useMemo(() => {
    const absoluteCandidate = String(absolutePath ?? "").trim();
    const relativeCandidate = String(relativePath ?? "").trim();
    const projectCandidate = String(projectDir ?? "").trim();
    return Boolean(absoluteCandidate || (relativeCandidate && projectCandidate));
  }, [absolutePath, projectDir, relativePath]);

  const [previewStatus, setPreviewStatus] = useState<AssetVisualLoadStatus>(() => {
    if (src) {
      return "loading";
    }
    return hadPathIntent ? "missing" : "idle";
  });

  useEffect(() => {
    if (!src) {
      setPreviewStatus(hadPathIntent ? "missing" : "idle");
      return;
    }
    setPreviewStatus("loading");
  }, [hadPathIntent, src]);

  const visualState = useMemo(
    () =>
      resolveProjectAssetVisualState({
        relativePath: String(relativePath ?? "").trim() || String(absolutePath ?? "").trim() || null,
        loadStatus: previewStatus,
        legacyFallback,
        legacyFallbackDetail,
      }),
    [absolutePath, legacyFallback, legacyFallbackDetail, previewStatus, relativePath]
  );

  return {
    src,
    previewStatus,
    visualState,
    setLoaded: () => setPreviewStatus("loaded"),
    setFailed: () => setPreviewStatus("failed"),
  };
}
