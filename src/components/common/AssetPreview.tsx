import { useEffect, useRef } from "react";

import {
  type AssetVisualLoadStatus,
  type ProjectAssetVisualState,
} from "../../core/assetVisualState";
import { useProjectAssetVisualState } from "../../core/useProjectAssetVisualState";

export type AssetPreviewLoadStatus = AssetVisualLoadStatus;

type AssetPreviewProps = {
  alt: string;
  absolutePath?: string | null;
  projectDir?: string | null;
  relativePath?: string | null;
  imageClassName: string;
  fallbackClassName: string;
  fallbackLabel?: string;
  pixelated?: boolean;
  testId?: string;
  fallbackTestId?: string;
  legacyFallback?: boolean;
  legacyFallbackDetail?: string | null;
  onStatusChange?: (status: AssetPreviewLoadStatus) => void;
  onVisualStateChange?: (state: ProjectAssetVisualState) => void;
};

export default function AssetPreview({
  alt,
  absolutePath,
  projectDir,
  relativePath,
  imageClassName,
  fallbackClassName,
  fallbackLabel,
  pixelated = false,
  testId,
  fallbackTestId,
  legacyFallback = false,
  legacyFallbackDetail = null,
  onStatusChange,
  onVisualStateChange,
}: AssetPreviewProps) {
  const statusCallbackRef = useRef<AssetPreviewProps["onStatusChange"]>(onStatusChange);
  const visualStateCallbackRef = useRef<AssetPreviewProps["onVisualStateChange"]>(onVisualStateChange);

  useEffect(() => {
    statusCallbackRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    visualStateCallbackRef.current = onVisualStateChange;
  }, [onVisualStateChange]);

  const {
    src,
    previewStatus,
    visualState,
    setLoaded,
    setFailed,
  } = useProjectAssetVisualState({
    absolutePath,
    projectDir,
    relativePath,
    legacyFallback,
    legacyFallbackDetail,
  });

  useEffect(() => {
    statusCallbackRef.current?.(previewStatus);
  }, [previewStatus]);

  useEffect(() => {
    visualStateCallbackRef.current?.(visualState);
  }, [visualState]);

  const effectiveFallbackLabel = fallbackLabel ?? visualState.title;

  if (!src || visualState.kind === "idle" || visualState.kind === "missing" || visualState.kind === "failed") {
    return (
      <div
        data-testid={fallbackTestId}
        className={fallbackClassName}
        title={visualState.detail}
      >
        {effectiveFallbackLabel}
      </div>
    );
  }

  return (
    <div className="relative inline-flex max-w-full flex-col items-center justify-center">
      {previewStatus === "loading" ? (
        <div
          className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center rounded bg-black/25 text-[9px] font-semibold uppercase tracking-wide text-[#a6adc8]"
          aria-live="polite"
        >
          Carregando…
        </div>
      ) : null}
      <img
        data-testid={testId}
        src={src}
        alt={alt}
        loading="lazy"
        draggable={false}
        onLoad={setLoaded}
        onError={setFailed}
        className={`${imageClassName} ${previewStatus === "loading" ? "opacity-25" : ""}`}
        style={pixelated ? { imageRendering: "pixelated" } : undefined}
      />
    </div>
  );
}
