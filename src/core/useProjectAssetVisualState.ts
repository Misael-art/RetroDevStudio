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
import { imageDataToPngDataUrl, isPpmPath, loadProjectPpmImageData } from "./ppmImage";

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

  const ppmRequest = useMemo(() => {
    const projectCandidate = String(projectDir ?? "").trim();
    const relativeCandidate = String(relativePath ?? "").trim();
    return !String(absolutePath ?? "").trim() && projectCandidate && isPpmPath(relativeCandidate)
      ? { projectDir: projectCandidate, relativePath: relativeCandidate }
      : null;
  }, [absolutePath, projectDir, relativePath]);
  // PPM goes through the canonical IPC bytes + decoder path; the WebView cannot decode it.
  const [ppmSrc, setPpmSrc] = useState<{ key: string; src: string | null } | null>(null);
  const ppmKey = ppmRequest ? `${ppmRequest.projectDir}::${ppmRequest.relativePath}` : null;
  useEffect(() => {
    if (!ppmRequest || !ppmKey) return;
    let cancelled = false;
    void loadProjectPpmImageData(ppmRequest.projectDir, ppmRequest.relativePath)
      .then((imageData) => {
        if (!cancelled) setPpmSrc({ key: ppmKey, src: imageDataToPngDataUrl(imageData) });
      })
      .catch(() => {
        if (!cancelled) setPpmSrc({ key: ppmKey, src: null });
      });
    return () => {
      cancelled = true;
    };
  }, [ppmKey, ppmRequest]);

  const directSrc = useMemo(() => {
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
  const ppmResolved = ppmKey !== null && ppmSrc?.key === ppmKey;
  const src = ppmKey !== null ? (ppmResolved ? ppmSrc?.src ?? null : null) : directSrc;

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
    if (ppmKey !== null && !ppmResolved) {
      setPreviewStatus("loading");
      return;
    }
    if (ppmKey !== null && !src) {
      setPreviewStatus("failed");
      return;
    }
    if (!src) {
      setPreviewStatus(hadPathIntent ? "missing" : "idle");
      return;
    }
    setPreviewStatus("loading");
  }, [hadPathIntent, ppmKey, ppmResolved, src]);

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
