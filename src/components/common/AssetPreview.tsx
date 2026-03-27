import { useEffect, useMemo, useState } from "react";
import {
  resolveAbsoluteAssetPreviewSrc,
  resolveProjectAssetPreviewSrc,
} from "../../core/pathUtils";

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
};

export default function AssetPreview({
  alt,
  absolutePath,
  projectDir,
  relativePath,
  imageClassName,
  fallbackClassName,
  fallbackLabel = "Preview indisponivel",
  pixelated = false,
  testId,
  fallbackTestId,
}: AssetPreviewProps) {
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

  const [loadFailed, setLoadFailed] = useState(!src);

  useEffect(() => {
    setLoadFailed(!src);
  }, [src]);

  if (!src || loadFailed) {
    return (
      <div
        data-testid={fallbackTestId}
        className={fallbackClassName}
      >
        {fallbackLabel}
      </div>
    );
  }

  return (
    <img
      data-testid={testId}
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setLoadFailed(true)}
      className={imageClassName}
      style={pixelated ? { imageRendering: "pixelated" } : undefined}
    />
  );
}
