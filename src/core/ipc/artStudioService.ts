import { invoke } from "@tauri-apps/api/core";

export interface ArtContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  aligned_x: number;
  aligned_y: number;
  aligned_width: number;
  aligned_height: number;
  tile_cols: number;
  tile_rows: number;
}

export interface ArtSuggestedFrame {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArtProcessResult {
  ok: boolean;
  processed_base64: string | null;
  error: string | null;
  format: string | null;
  source_width: number | null;
  source_height: number | null;
  processed_width: number | null;
  processed_height: number | null;
  frame_count: number | null;
  background_mode: string | null;
  transparent_pixels: number | null;
  palette: string[];
  palette_size: number;
  content_bounds: ArtContentBounds | null;
  suggested_frame_width: number | null;
  suggested_frame_height: number | null;
  recommended_output_width: number | null;
  recommended_output_height: number | null;
  recommended_scale_percent: number | null;
  meta_sprite_candidate: boolean;
  slicing_mode: string | null;
  suggested_frames: ArtSuggestedFrame[];
  warnings: string[];
}

export interface ArtImportResult {
  ok: boolean;
  error: string | null;
  relative_path: string | null;
  absolute_path: string | null;
  sprite_name: string | null;
  frame_width: number | null;
  frame_height: number | null;
  frame_count: number;
  generated_width: number | null;
  generated_height: number | null;
}

export async function artProcessPalette(
  imagePath: string,
  options?: {
    gridWidth?: number | null;
    gridHeight?: number | null;
    slicingMode?: string | null;
  }
): Promise<ArtProcessResult> {
  return invoke<ArtProcessResult>("art_process_palette", {
    imagePath,
    gridWidth: options?.gridWidth ?? null,
    gridHeight: options?.gridHeight ?? null,
    slicingMode: options?.slicingMode ?? null,
  });
}

export async function importArtAsset(
  imagePath: string,
  projectRoot: string,
  options?: {
    spriteName?: string | null;
    gridWidth?: number | null;
    gridHeight?: number | null;
    slicingMode?: string | null;
  }
): Promise<ArtImportResult> {
  return invoke<ArtImportResult>("import_art_asset", {
    imagePath,
    projectRoot,
    spriteName: options?.spriteName ?? null,
    gridWidth: options?.gridWidth ?? null,
    gridHeight: options?.gridHeight ?? null,
    slicingMode: options?.slicingMode ?? null,
  });
}
