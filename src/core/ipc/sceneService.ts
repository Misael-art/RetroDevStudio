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
  /** Experimental: SGDK ResComp decomposes meta-sprites automatically. */
  meta_sprite?: boolean;
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
  graph_ref?: string | null;
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

export interface RetroFXParallaxLayer {
  id: string;
  name: string;
  speed_x: number;
  speed_y: number;
  enabled: boolean;
}

export interface RetroFXRasterLine {
  id: string;
  scanline: number;
  offset_x: number;
  enabled: boolean;
}

export interface RetroFXConfig {
  parallax_layers: RetroFXParallaxLayer[];
  raster_lines: RetroFXRasterLine[];
}

/** Mapa de colisão grid-based (schema 1.4.0+). */
export interface CollisionMap {
  /** Tamanho do tile em pixels (horizontal). Padrão: 8. */
  tile_width: number;
  /** Tamanho do tile em pixels (vertical). Padrão: 8. */
  tile_height: number;
  /** Número de tiles na horizontal. */
  width: number;
  /** Número de tiles na vertical. */
  height: number;
  /** Dados: 0 = livre, 1 = sólido. Tamanho = width * height. */
  data: number[];
}

export interface Scene {
  scene_id: string;
  schema_version?: string | null;
  display_name?: string | null;
  entities: Entity[];
  background_layers: BackgroundLayer[];
  palettes?: PaletteEntry[];
  retrofx?: RetroFXConfig | null;
  /** Mapa de colisão grid-based (schema 1.4.0+). Null = sem mapa de colisão. */
  collision_map?: CollisionMap | null;
}

export interface SceneInfo {
  path: string;
  scene_id: string;
  display_name: string;
}

export interface SceneDataResult {
  ok: boolean;
  error: string;
  scene_json: string;
  project_name: string;
  target: string;
  scene_path: string;
  source_kind: string;
}

export interface ResolveSceneResult {
  ok: boolean;
  error: string;
  scene_json: string;
}

// ── IPC wrappers ──────────────────────────────────────────────────────────────

export function getSceneData(projectDir: string, scenePath?: string): Promise<SceneDataResult> {
  return invoke("get_scene_data", { projectDir, scenePath });
}

export function saveSceneData(
  projectDir: string,
  sceneJson: string,
  scenePath?: string,
  resolvedSceneJson?: string
): Promise<{ ok: boolean; message: string }> {
  return invoke("save_scene_data", { projectDir, sceneJson, scenePath, resolvedSceneJson });
}

export function listScenes(projectDir: string): Promise<SceneInfo[]> {
  return invoke("list_scenes", { projectDir });
}

export function switchScene(projectDir: string, scenePath: string): Promise<SceneDataResult> {
  return invoke("switch_scene", { projectDir, scenePath });
}

export function createScene(projectDir: string, displayName?: string): Promise<SceneInfo> {
  return invoke("create_scene", { projectDir, displayName });
}

export function resolveScenePrefabs(
  projectDir: string,
  scene: Scene
): Promise<ResolveSceneResult> {
  return invoke("resolve_scene_prefabs", {
    projectDir,
    sceneJson: JSON.stringify(scene),
  });
}

export function parseSceneJson(sceneJson?: string | null): Scene | null {
  if (!sceneJson) {
    return null;
  }

  try {
    return JSON.parse(sceneJson) as Scene;
  } catch {
    return null;
  }
}

/** Parseia scene_json da SceneDataResult em um objeto Scene tipado. */
export function parseScene(result: SceneDataResult): Scene | null {
  if (!result.ok) return null;
  return parseSceneJson(result.scene_json);
}
