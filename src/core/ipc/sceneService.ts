import { invoke } from "@tauri-apps/api/core";

// ── UGDM types (mirror of Rust structs) ───────────────────────────────────────

export interface Transform {
  x: number;
  y: number;
}

export interface AnimationDef {
  frames: number[];
  fps: number;
  loop: boolean;
}

export interface Pivot {
  x: number;
  y: number;
}

export interface SpriteComponent {
  asset: string;
  frame_width: number;
  frame_height: number;
  pivot?: Pivot;
  palette_slot?: number;
  animations?: Record<string, AnimationDef>;
  priority?: string;
}

export interface CollisionOffset {
  x: number;
  y: number;
}

export interface CollisionComponent {
  shape: string;
  width: number;
  height: number;
  offset?: CollisionOffset;
  solid?: boolean;
  layer?: string;
  collides_with?: string[];
}

export interface InputComponent {
  device: string;
  mapping: Record<string, string>;
}

export interface Velocity {
  x: number;
  y: number;
}

export interface PhysicsComponent {
  gravity?: boolean;
  gravity_strength?: number;
  max_velocity?: Velocity;
  friction?: number;
  bounce?: number;
}

export interface AudioComponent {
  sfx?: Record<string, string>;
  bgm?: string;
}

export interface LogicVariable {
  type: string;
  default: unknown;
  min?: number;
  max?: number;
}

export interface LogicComponent {
  graph?: string;
  variables?: Record<string, LogicVariable>;
}

export interface CameraComponent {
  follow_entity?: string;
  offset_x?: number;
  offset_y?: number;
}

export interface TilemapComponent {
  tileset: string;
  map_width: number;
  map_height: number;
  scroll_x?: number;
  scroll_y?: number;
}

export interface Components {
  sprite?: SpriteComponent;
  collision?: CollisionComponent;
  input?: InputComponent;
  physics?: PhysicsComponent;
  audio?: AudioComponent;
  logic?: LogicComponent;
  camera?: CameraComponent;
  tilemap?: TilemapComponent;
}

export interface Entity {
  entity_id: string;
  prefab?: string | null;
  transform: Transform;
  components: Components;
}

export interface ScrollSpeed {
  x: number;
  y: number;
}

export interface BackgroundLayer {
  layer_id: string;
  depth: number;
  tileset: string;
  scroll_speed?: ScrollSpeed;
  tilemap?: string;
}

export interface PaletteEntry {
  slot: number;
  colors: string[];
}

export interface Scene {
  scene_id: string;
  display_name?: string | null;
  entities: Entity[];
  background_layers: BackgroundLayer[];
  palettes?: PaletteEntry[];
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
