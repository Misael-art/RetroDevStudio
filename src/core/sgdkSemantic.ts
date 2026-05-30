export interface SgdkSourceLocation {
  file: string;
  line: number;
}

export interface SgdkNamedSourceItem {
  name: string;
  source: SgdkSourceLocation;
}

export interface SgdkDefineInventory {
  name: string;
  function_like: boolean;
  value: string;
  source: SgdkSourceLocation;
}

export interface SgdkSemanticGap {
  kind: string;
  subject: string;
  detail: string;
  source?: SgdkSourceLocation | null;
  impact: string;
  severity: string;
  suggestion: string;
  blocks_nocode: boolean;
  blocks_build: boolean;
  blocks_round_trip: boolean;
}

export interface SgdkResourceInventory {
  kind: string;
  name: string;
  asset_path: string;
  params: string[];
  asset_exists: boolean;
  source: SgdkSourceLocation;
}

export interface SgdkCanonicalSourceMapping {
  source: SgdkSourceLocation;
  model_path: string;
  impact: string;
}

export interface SgdkIrFiles {
  source_files: string[];
  header_files: string[];
  resource_manifests: string[];
}

export interface SgdkIrPreprocessor {
  includes: SgdkNamedSourceItem[];
  defines: SgdkDefineInventory[];
  macro_bridges: SgdkDefineInventory[];
  conditional_bridges: SgdkSemanticGap[];
}

export interface SgdkIrSymbols {
  globals: SgdkNamedSourceItem[];
  arrays: SgdkNamedSourceItem[];
  structs: SgdkNamedSourceItem[];
  enums: SgdkNamedSourceItem[];
  functions: number;
  callbacks: number;
}

export interface SgdkIrControlFlow {
  main_loops: SgdkNamedSourceItem[];
  update_functions: number;
  state_machines: number;
  states: number;
  transitions: number;
  actions: number;
}

export interface SgdkIrResources {
  sprite_resources: SgdkResourceInventory[];
  tilemap_resources: SgdkResourceInventory[];
  audio_resources: SgdkResourceInventory[];
  other_resources: SgdkResourceInventory[];
}

export interface SgdkIrHardwareOps {
  input_calls: number;
  sprite_calls: number;
  tilemap_calls: number;
  audio_calls: number;
  vdp_calls: number;
  dma_calls: number;
  palette_calls: number;
  hblank_callbacks: number;
  shadow_highlight_calls: number;
}

export interface SgdkSemanticIrReport {
  schema_version: string;
  project_name: string;
  source_root: string;
  files: SgdkIrFiles;
  preprocessor: SgdkIrPreprocessor;
  symbols: SgdkIrSymbols;
  control_flow: SgdkIrControlFlow;
  resources: SgdkIrResources;
  hardware_ops: SgdkIrHardwareOps;
  bridges: SgdkSemanticGap[];
  source_mappings: SgdkCanonicalSourceMapping[];
  node_graph_json: string;
  report_path?: string | null;
}

export interface SgdkNodeCoverageReport {
  schema_version: string;
  project_name: string;
  source_root: string;
  total_logic_units: number;
  converted_logic_units: number;
  bridge_logic_units: number;
  unsupported_logic_units: number;
  editable_node_coverage_percent: number;
  buildable_after_roundtrip: boolean;
  emulation_visible_ok?: boolean | null;
  hardware_constraint_status: string;
  unit_breakdown: Record<string, number>;
  report_path?: string | null;
}

export interface SgdkRoundTripReport {
  schema_version: string;
  project_name: string;
  source_root: string;
  generated_c_path: string;
  generated_res_path: string;
  bridge_prevents_full_edit: boolean;
  buildable_after_roundtrip: boolean;
  build_attempted: boolean;
  build_ok?: boolean | null;
  emulation_visible_ok?: boolean | null;
  warnings: string[];
  report_path?: string | null;
}

export interface SgdkHardwareConstraintAxis {
  id: string;
  status: string;
  measured: string;
  limit: string;
  warnings: string[];
  evidence: string[];
}

export interface SgdkHardwareConstraintReport {
  schema_version: string;
  project_name: string;
  source_root: string;
  status: string;
  axes: SgdkHardwareConstraintAxis[];
  report_path?: string | null;
}

export interface SgdkNodeGraphExportReport {
  schema_version: string;
  project_name: string;
  source_root: string;
  node_graph_json: string;
  node_count: number;
  edge_count: number;
  bridge_node_count: number;
  node_type_counts: Record<string, number>;
  report_path?: string | null;
}

export interface SgdkSemanticReportBundle {
  semantic_ir: SgdkSemanticIrReport;
  coverage: SgdkNodeCoverageReport;
  roundtrip: SgdkRoundTripReport;
  hardware_constraints: SgdkHardwareConstraintReport;
}
