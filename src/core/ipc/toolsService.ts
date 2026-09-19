import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { ActionableDiagnostic } from "../diagnostics";

// ── Types (mirror do Rust) ────────────────────────────────────────────────────

export interface PatchResult {
  ok: boolean;
  message: string;
  bytes_changed: number;
  patch_hash?: string | null;
}

export interface ProfileIssue {
  severity: "Info" | "Warning" | "Error";
  message: string;
}

export interface ProfileReport {
  ok: boolean;
  error: string;
  dma_heatmap: number[];      // 224 entries — bytes/scanline
  sprite_heatmap: number[];   // 224 entries — sprites/scanline
  dma_total_bytes: number;
  sprite_peak: number;
  sprite_count: number;
  issues: ProfileIssue[];
}

export interface ExtractionResult {
  ok: boolean;
  error: string;
  tiles_extracted: number;
  palettes_extracted: number;
  files: string[];
}

export interface ProjectAssetEntry {
  relative_path: string;
  absolute_path: string;
  kind: "image" | "audio" | "other";
}

export interface LegacyProjectFilePreview {
  relative_path: string;
  absolute_path: string;
  content: string;
  previewable: boolean;
  readonly: boolean;
  note: string;
}

export type AssetExtractorBppMode = "auto" | "2bpp" | "4bpp";

export type ThirdPartyDependencyId =
  | "jdk"
  | "sgdk"
  | "pvsneslib"
  | "libretro_megadrive"
  | "libretro_snes";

export interface DependencyLogLine {
  level: "info" | "warn" | "error" | "success";
  message: string;
}

export interface DependencyStatus {
  id: ThirdPartyDependencyId | string;
  label: string;
  applicable?: boolean;
  installed: boolean;
  version: string | null;
  status_code?: string;
  status_label?: string;
  severity?: "ok" | "warning" | "blocking" | string;
  install_dir: string;
  source_url: string;
  auto_install_supported: boolean;
  cache_available?: boolean;
  manual_configuration_required?: boolean;
  actionable_message?: string;
  notes: string[];
  issues: string[];
}

export interface DependencyStatusSummary {
  total: number;
  installed: number;
  blocking: number;
  warnings: number;
  manual_required: number;
  cache_available: number;
  download_failed: number;
  not_applicable?: number;
}

export interface DependencyStatusReport {
  schema?: string;
  generated_at_unix?: number;
  report_path?: string;
  host_state?: string;
  host_fingerprint?: string | null;
  lock_digest?: string | null;
  blockers?: string[];
  summary?: DependencyStatusSummary;
  items: DependencyStatus[];
}

export interface DependencyInstallResult {
  ok: boolean;
  dependency_id: string;
  message: string;
  status: DependencyStatus;
  log: DependencyLogLine[];
  diagnostics?: ActionableDiagnostic[];
}

export interface RomDependencyResult {
  dependency_id: string;
}

export interface ReverseExplorerRow {
  offset: number;
  bytes: number[];
  ascii: string;
  annotation: string;
}

export interface ReverseExplorerResult {
  ok: boolean;
  error: string;
  total_size: number;
  rows: ReverseExplorerRow[];
}

export interface RomHashes {
  crc32: string;
  sha1: string;
}

export interface RomHeader {
  console_name: string;
  internal_title: string;
  region?: string | null;
  version?: string | null;
  publisher?: string | null;
  entry_point?: number | null;
}

export interface RomSegment {
  start: number;
  end: number;
  kind: string;
  label: string;
  bank_index?: number | null;
  confidence: number;
}

export interface GraphicsCandidate {
  id: string;
  start: number;
  end: number;
  kind: string;
  bpp: number;
  tile_width: number;
  tile_height: number;
  tile_count: number;
  palette_slot?: number | null;
  confidence: number;
  note: string;
}

export interface TextCandidate {
  id: string;
  start: number;
  end: number;
  encoding: string;
  preview: string;
  confidence: number;
}

export interface AudioCandidate {
  id: string;
  start: number;
  end: number;
  format: string;
  driver?: string | null;
  confidence: number;
  note: string;
}

export interface PointerTableCandidate {
  start: number;
  end: number;
  entry_size: number;
  encoding: string;
  destinations: number[];
  confidence: number;
}

export interface CompressionRegion {
  start: number;
  end: number;
  scheme: string;
  confidence: number;
  note: string;
}

export interface DisassemblyRow {
  offset: number;
  bytes: number[];
  size: number;
  text: string;
  kind: string;
  target?: number | null;
}

export interface FunctionCandidate {
  address: number;
  end: number;
  name: string;
  executed: boolean;
  confidence: number;
}

export interface CodeXref {
  from: number;
  to: number;
  kind: string;
  label: string;
}

export interface CallGraphEdge {
  from: number;
  to: number;
  kind: string;
}

export interface CodeRegion {
  start: number;
  end: number;
  architecture: string;
  entry_points: number[];
  functions: FunctionCandidate[];
  xrefs: CodeXref[];
  disassembly: DisassemblyRow[];
}

export interface LogicHint {
  id: string;
  category: string;
  message: string;
  start?: number | null;
  end?: number | null;
}

export interface ReverseAnnotation {
  kind: string;
  start: number;
  end?: number | null;
  label: string;
  comment: string;
}

export interface TraceStatus {
  available: boolean;
  executed_regions: RomSegment[];
  note: string;
}

export interface SaveRamStatus {
  status: string;
  declared: boolean;
  observed: boolean;
  missing: boolean;
  size_bytes: number | null;
  observed_size_bytes: number | null;
  address_start: number | null;
  address_end: number | null;
  note: string;
}

export interface ProjectionStatus {
  supported: boolean;
  status: string;
  message: string;
}

export interface RomContainerInfo {
  kind: string;
  member?: string | null;
  note: string;
}

export interface NormalizationStep {
  name: string;
  parameters: string;
  input_sha256: string;
  output_sha256: string;
  reversible: boolean;
}

export interface RomAnalysisManifest {
  ok: boolean;
  error: string;
  target: "megadrive" | "snes" | string;
  source_path: string;
  detected_format: string;
  stripped_header_bytes: number;
  total_size: number;
  hashes: RomHashes;
  /** REX-02: contêiner de origem e passos de normalização reversíveis; ausentes
   * em manifestos antigos. */
  container?: RomContainerInfo;
  normalization?: NormalizationStep[];
  header: RomHeader;
  mapper: string;
  special_chips: string[];
  segments: RomSegment[];
  graphics_regions: GraphicsCandidate[];
  text_regions: TextCandidate[];
  audio_regions: AudioCandidate[];
  code_regions: CodeRegion[];
  pointer_tables: PointerTableCandidate[];
  compression_regions: CompressionRegion[];
  call_graph: CallGraphEdge[];
  logic_hints: LogicHint[];
  annotations: ReverseAnnotation[];
  trace: TraceStatus;
  save: SaveRamStatus;
  projection_status: ProjectionStatus;
}

export interface DisassemblyResult {
  ok: boolean;
  error: string;
  total_size: number;
  rows: DisassemblyRow[];
}

export interface RomTextExtractionResult {
  text_regions: TextCandidate[];
  pointer_tables: PointerTableCandidate[];
}

export interface InspectionError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface InspectionRomIdentity {
  original_sha256: string;
  normalized_sha256: string;
  original_size: number;
  normalized_size: number;
  variant: string;
  header_console: string;
  header_title: string;
  region?: string | null;
  version?: string | null;
  size_note?: string | null;
}

export interface InspectionArtifactRef {
  label: string;
  path: string;
  sha256: string;
}

export interface InspectionSession {
  schema_version: string;
  session_id: string;
  rom_path: string;
  identity: InspectionRomIdentity;
  catalog_artifact: InspectionArtifactRef;
  artifact_refs: InspectionArtifactRef[];
  user_choice_artifacts: InspectionArtifactRef[];
  discovery_run_id?: string | null;
  status: string;
  candidates_total: number;
  unknown_bytes: number;
  created_at_unix: number;
  completed_at_unix?: number | null;
  error?: InspectionError | null;
}

export interface InspectionProgress {
  session_id: string;
  run_id: string;
  generation: number;
  phase: string;
  status: string;
  completed_work: number;
  total_work: number;
  candidates_found: number;
  message: string;
}

export interface InspectionRun {
  run_id: string;
  session_id: string;
  generation: number;
  status: string;
  progress: InspectionProgress;
  started_at_unix: number;
  finished_at_unix?: number | null;
  error?: InspectionError | null;
}

export interface InspectionStatus {
  session: InspectionSession;
  run?: InspectionRun | null;
}

export interface InspectionCandidate {
  id: string;
  offset: number;
  size: number;
  kind: string;
  status: string;
  method: string;
  confidence: number;
  evidence: Record<string, unknown>;
  previews: InspectionArtifactRef[];
}

export interface InspectionUnknownRegion {
  offset: number;
  size: number;
  kind: string;
  method: string;
}

export interface InspectionUserChoice {
  choice_id: string;
  session_id: string;
  tile_candidate_id: string;
  palette_candidate_id: string;
  source: string;
  artifact: InspectionArtifactRef;
}

export interface InspectionCatalogPage {
  session_id: string;
  run_id: string;
  offset: number;
  limit: number;
  total_candidates: number;
  candidates: InspectionCandidate[];
  unknown_regions: InspectionUnknownRegion[];
  user_choices: InspectionUserChoice[];
}

export interface InspectionPreview {
  session_id: string;
  candidate_id: string;
  available: boolean;
  reason?: string | null;
  artifact?: InspectionArtifactRef | null;
  data_url?: string | null;
  width?: number | null;
  height?: number | null;
  png_sha256?: string | null;
  pixels_sha256?: string | null;
}

export interface InspectionSpriteFramePart {
  tile_start: number;
  tile_count: number;
  tile_width: number;
  tile_height: number;
  x: number;
  y: number;
  x_flip: number;
  y_flip: number;
}

export interface InspectionSpriteFrame {
  session_id: string;
  resource_id: string;
  frame_id: string;
  available: boolean;
  reason?: string | null;
  width: number;
  height: number;
  data_url?: string | null;
  artifact?: InspectionArtifactRef | null;
  png_sha256?: string | null;
  pixels_sha256?: string | null;
  rom_sha256: string;
  tile_data_offset: number;
  tile_data_size: number;
  palette_offset: number;
  palette_size: number;
  descriptor_offset: number;
  flip_x: boolean;
  flip_y: boolean;
  transparency_index: number;
  parts: InspectionSpriteFramePart[];
  metadata_source: string;
  rom_evidence: string[];
  donor_evidence: string[];
  limitations: string[];
}

export const INSPECTION_PROGRESS_EVENT = "rex://inspection-progress";

export function inspectionOpen(romPath: string): Promise<InspectionSession> {
  return invoke<InspectionSession>("rex_inspection_open", { romPath });
}

export function inspectionReopen(romPath: string, sessionId: string): Promise<InspectionSession> {
  return invoke<InspectionSession>("rex_inspection_reopen", { romPath, sessionId });
}

export function inspectionStart(sessionId: string, generation: number): Promise<InspectionRun> {
  return invoke<InspectionRun>("rex_inspection_start", { sessionId, generation });
}

export function inspectionCancel(sessionId: string, runId: string): Promise<InspectionRun> {
  return invoke<InspectionRun>("rex_inspection_cancel", { sessionId, runId });
}

export function inspectionStatus(sessionId: string): Promise<InspectionStatus> {
  return invoke<InspectionStatus>("rex_inspection_status", { sessionId });
}

export function inspectionListSessions(): Promise<InspectionSession[]> {
  return invoke<InspectionSession[]>("rex_inspection_list_sessions");
}

export function inspectionCatalogPage(
  sessionId: string,
  offset: number,
  limit: number,
  query: string,
  kind: string
): Promise<InspectionCatalogPage> {
  return invoke<InspectionCatalogPage>("rex_inspection_catalog_page", {
    sessionId,
    offset,
    limit,
    query,
    kind,
  });
}

export function inspectionPreview(sessionId: string, candidateId: string): Promise<InspectionPreview> {
  return invoke<InspectionPreview>("rex_inspection_preview", { sessionId, candidateId });
}

export function inspectionSpriteFrame(
  sessionId: string,
  resourceId: string,
  frameId = `${resourceId}/frame-0`,
  flipX = false,
  flipY = false
): Promise<InspectionSpriteFrame> {
  return invoke<InspectionSpriteFrame>("rex_inspection_sprite_frame", {
    sessionId,
    resourceId,
    frameId,
    flipX,
    flipY,
  });
}

export function inspectionSavePaletteChoice(
  sessionId: string,
  tileCandidateId: string,
  paletteCandidateId: string
): Promise<InspectionUserChoice> {
  return invoke<InspectionUserChoice>("rex_inspection_save_palette_choice", {
    sessionId,
    tileCandidateId,
    paletteCandidateId,
  });
}

export function inspectionSave(sessionId: string): Promise<InspectionSession> {
  return invoke<InspectionSession>("rex_inspection_save", { sessionId });
}

export function listenInspectionProgress(
  callback: (progress: InspectionProgress) => void
): Promise<UnlistenFn> {
  return listen<InspectionProgress>(INSPECTION_PROGRESS_EVENT, (event) => callback(event.payload));
}

// ── Patch Studio ──────────────────────────────────────────────────────────────

export function patchCreateIps(
  originalPath: string,
  modifiedPath: string,
  patchPath: string,
  projectDir?: string | null
): Promise<PatchResult> {
  return invoke("patch_create_ips", { originalPath, modifiedPath, patchPath, projectDir: projectDir ?? null });
}

export function patchApplyIps(romPath: string, patchPath: string, outputPath: string): Promise<PatchResult> {
  return invoke("patch_apply_ips", { romPath, patchPath, outputPath });
}

export function patchCreateBps(
  originalPath: string,
  modifiedPath: string,
  patchPath: string,
  projectDir?: string | null
): Promise<PatchResult> {
  return invoke("patch_create_bps", { originalPath, modifiedPath, patchPath, projectDir: projectDir ?? null });
}

export function patchApplyBps(romPath: string, patchPath: string, outputPath: string): Promise<PatchResult> {
  return invoke("patch_apply_bps", { romPath, patchPath, outputPath });
}

// ── Deep Profiler ─────────────────────────────────────────────────────────────

export function profilerAnalyzeRom(romPath: string): Promise<ProfileReport> {
  return invoke("profiler_analyze_rom", { romPath });
}

// ── Asset Extractor ───────────────────────────────────────────────────────────

export function assetsExtract(
  romPath: string,
  outputDir: string,
  maxTiles: number,
  paletteSlot: number,
  bppMode: AssetExtractorBppMode
): Promise<ExtractionResult> {
  return invoke("assets_extract", { romPath, outputDir, maxTiles, paletteSlot, bppMode });
}

export function listProjectAssets(projectDir: string): Promise<ProjectAssetEntry[]> {
  return invoke<ProjectAssetEntry[]>("list_project_assets", { projectDir });
}

export function readLegacyProjectFile(
  projectDir: string,
  relativePath: string
): Promise<LegacyProjectFilePreview> {
  return invoke<LegacyProjectFilePreview>("read_legacy_project_file", {
    projectDir,
    relativePath,
  });
}

export function getThirdPartyStatus(): Promise<DependencyStatusReport> {
  return invoke<DependencyStatusReport>("third_party_get_status");
}

export function detectRomDependency(romPath: string): Promise<RomDependencyResult> {
  return invoke<RomDependencyResult>("third_party_detect_rom_dependency", { romPath });
}

export async function installThirdPartyDependency(
  dependencyId: ThirdPartyDependencyId | string,
  onLog: (line: DependencyLogLine) => void
): Promise<DependencyInstallResult> {
  const unlisten: UnlistenFn = await listen<DependencyLogLine>("deps://log", (event) => {
    onLog(event.payload);
  });

  try {
    return await invoke<DependencyInstallResult>("third_party_install", { dependencyId });
  } finally {
    unlisten();
  }
}

export function reverseExplorerRead(
  romPath: string,
  target: "megadrive" | "snes",
  offset: number,
  length: number
): Promise<ReverseExplorerResult> {
  return invoke<ReverseExplorerResult>("reverse_explorer_read", { romPath, target, offset, length });
}

export function romAnalyze(romPath: string): Promise<RomAnalysisManifest> {
  return invoke<RomAnalysisManifest>("rom_analyze", { romPath });
}

export function romAnalyzeWithEmulatorTrace(romPath: string): Promise<RomAnalysisManifest> {
  return invoke<RomAnalysisManifest>("rom_analyze_with_emulator_trace", { romPath });
}

export function romDisassemble(
  romPath: string,
  offset: number,
  length: number
): Promise<DisassemblyResult> {
  return invoke<DisassemblyResult>("rom_disassemble", { romPath, offset, length });
}

export function romGetXrefs(romPath: string): Promise<CodeXref[]> {
  return invoke<CodeXref[]>("rom_get_xrefs", { romPath });
}

export function romGetCallGraph(romPath: string): Promise<CallGraphEdge[]> {
  return invoke<CallGraphEdge[]>("rom_get_call_graph", { romPath });
}

export function romExtractGraphics(romPath: string): Promise<GraphicsCandidate[]> {
  return invoke<GraphicsCandidate[]>("rom_extract_graphics", { romPath });
}

export function romExtractText(romPath: string): Promise<RomTextExtractionResult> {
  return invoke<RomTextExtractionResult>("rom_extract_text", { romPath });
}

export function romExtractAudio(romPath: string): Promise<AudioCandidate[]> {
  return invoke<AudioCandidate[]>("rom_extract_audio", { romPath });
}

export function romSaveAnnotations(
  romPath: string,
  annotations: ReverseAnnotation[]
): Promise<number> {
  return invoke<number>("rom_save_annotations", { romPath, annotations });
}
