import { invoke } from "@tauri-apps/api/core";

// ── UGDM types (mirror of Rust structs) ───────────────────────────────────────

export interface Transform {
  x: number;
  y: number;
}

export interface SpriteComponent {
  asset: string;
  frame_width: number;
  frame_height: number;
  palette_slot: number;
  priority: string;
}

export interface CollisionComponent {
  shape: string;
  width: number;
  height: number;
  solid: boolean;
}

export interface Components {
  sprite?: SpriteComponent;
  collision?: CollisionComponent;
}

export interface Entity {
  entity_id: string;
  prefab?: string;
  transform: Transform;
  components: Components;
}

export interface BackgroundLayer {
  layer_id: string;
  depth: number;
  tileset: string;
}

export interface Scene {
  scene_id: string;
  display_name?: string;
  entities: Entity[];
  background_layers: BackgroundLayer[];
}

export interface SceneDataResult {
  ok: boolean;
  error: string;
  scene_json: string;
  project_name: string;
  target: string;
}

// ── IPC wrappers ──────────────────────────────────────────────────────────────

export function getSceneData(projectDir: string): Promise<SceneDataResult> {
  return invoke("get_scene_data", { projectDir });
}

export function saveSceneData(projectDir: string, sceneJson: string): Promise<{ ok: boolean; message: string }> {
  return invoke("save_scene_data", { projectDir, sceneJson });
}

/** Parseia scene_json da SceneDataResult em um objeto Scene tipado. */
export function parseScene(result: SceneDataResult): Scene | null {
  if (!result.ok) return null;
  try {
    return JSON.parse(result.scene_json) as Scene;
  } catch {
    return null;
  }
}
