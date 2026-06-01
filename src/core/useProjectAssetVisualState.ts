import { useCallback, useEffect, useMemo, useState } from "react";

import {
  resolveProjectAssetVisualState,
  type AssetVisualLoadStatus,
  type ProjectAssetVisualState,
} from "./assetVisualState";
import {
  resolveAbsoluteAssetPreviewSrc,
  resolveProjectAssetPreviewSrc,
} from "./pathUtils";
import {
  dataUrlFromPreviewPayload,
  readProjectAssetPreview,
} from "./ipc/assetPreviewService";

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
  const [bridgedSrc, setBridgedSrc] = useState<string | null>(null);
  const effectiveSrc = bridgedSrc ?? src;

  const hadPathIntent = useMemo(() => {
    const absoluteCandidate = String(absolutePath ?? "").trim();
    const relativeCandidate = String(relativePath ?? "").trim();
    const projectCandidate = String(projectDir ?? "").trim();
    return Boolean(absoluteCandidate || (relativeCandidate && projectCandidate));
  }, [absolutePath, projectDir, relativePath]);

  const [previewStatus, setPreviewStatus] = useState<AssetVisualLoadStatus>(() => {
    if (effectiveSrc) {
      return "loading";
    }
    return hadPathIntent ? "missing" : "idle";
  });

  useEffect(() => {
    if (!effectiveSrc) {
      setPreviewStatus(hadPathIntent ? "missing" : "idle");
      return;
    }
    setPreviewStatus("loading");
  }, [effectiveSrc, hadPathIntent]);

  useEffect(() => {
    const projectCandidate = String(projectDir ?? "").trim();
    const relativeCandidate = String(relativePath ?? "").trim();
    if (!projectCandidate || !relativeCandidate) {
      setBridgedSrc(null);
      return;
    }

    let cancelled = false;
    setBridgedSrc(null);
    void readProjectAssetPreview(projectCandidate, relativeCandidate)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        const dataUrl = dataUrlFromPreviewPayload(payload);
        if (!dataUrl) {
          return;
        }
        setBridgedSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setBridgedSrc(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectDir, relativePath]);

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

  const setLoaded = useCallback(() => setPreviewStatus("loaded"), []);
  const setFailed = useCallback(() => setPreviewStatus("failed"), []);

  return {
    src: effectiveSrc,
    previewStatus,
    visualState,
    setLoaded,
    setFailed,
  };
}
