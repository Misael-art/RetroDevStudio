import { invoke } from "@tauri-apps/api/core";

export interface ArtProcessResult {
  ok: boolean;
  processed_base64: string | null;
  error: string | null;
}

export async function artProcessPalette(imagePath: string): Promise<ArtProcessResult> {
  return invoke<ArtProcessResult>("art_process_palette", { imagePath });
}
