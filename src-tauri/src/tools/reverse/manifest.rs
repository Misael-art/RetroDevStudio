use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RomHashes {
    pub crc32: String,
    pub sha1: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RomHeader {
    pub console_name: String,
    pub internal_title: String,
    pub region: Option<String>,
    pub version: Option<String>,
    pub publisher: Option<String>,
    pub entry_point: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RomSegment {
    pub start: u32,
    pub end: u32,
    pub kind: String,
    pub label: String,
    pub bank_index: Option<u32>,
    pub confidence: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct GraphicsCandidate {
    pub id: String,
    pub start: u32,
    pub end: u32,
    pub kind: String,
    pub bpp: u8,
    pub tile_width: u32,
    pub tile_height: u32,
    pub tile_count: u32,
    pub palette_slot: Option<u8>,
    pub confidence: u8,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct TextCandidate {
    pub id: String,
    pub start: u32,
    pub end: u32,
    pub encoding: String,
    pub preview: String,
    pub confidence: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct AudioCandidate {
    pub id: String,
    pub start: u32,
    pub end: u32,
    pub format: String,
    pub driver: Option<String>,
    pub confidence: u8,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct PointerTableCandidate {
    pub start: u32,
    pub end: u32,
    pub entry_size: u8,
    pub encoding: String,
    pub destinations: Vec<u32>,
    pub confidence: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct CompressionRegion {
    pub start: u32,
    pub end: u32,
    pub scheme: String,
    pub confidence: u8,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct DisassemblyRow {
    pub offset: u32,
    pub bytes: Vec<u8>,
    pub size: u8,
    pub text: String,
    pub kind: String,
    pub target: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct FunctionCandidate {
    pub address: u32,
    pub end: u32,
    pub name: String,
    pub executed: bool,
    pub confidence: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct CodeXref {
    pub from: u32,
    pub to: u32,
    pub kind: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct CallGraphEdge {
    pub from: u32,
    pub to: u32,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct CodeRegion {
    pub start: u32,
    pub end: u32,
    pub architecture: String,
    pub entry_points: Vec<u32>,
    pub functions: Vec<FunctionCandidate>,
    pub xrefs: Vec<CodeXref>,
    pub disassembly: Vec<DisassemblyRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct LogicHint {
    pub id: String,
    pub category: String,
    pub message: String,
    pub start: Option<u32>,
    pub end: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ReverseAnnotation {
    pub kind: String,
    pub start: u32,
    pub end: Option<u32>,
    pub label: String,
    pub comment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct TraceStatus {
    pub available: bool,
    pub executed_regions: Vec<RomSegment>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ProjectionStatus {
    pub supported: bool,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SaveRamStatus {
    pub status: String,
    pub declared: bool,
    pub observed: bool,
    pub missing: bool,
    pub size_bytes: Option<usize>,
    pub observed_size_bytes: Option<usize>,
    pub address_start: Option<u32>,
    pub address_end: Option<u32>,
    pub note: String,
}

impl Default for SaveRamStatus {
    fn default() -> Self {
        Self {
            status: "missing".to_string(),
            declared: false,
            observed: false,
            missing: true,
            size_bytes: None,
            observed_size_bytes: None,
            address_start: None,
            address_end: None,
            note: "Nenhuma SRAM declarada ou observada nesta evidencia.".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct DisassemblyResult {
    pub ok: bool,
    pub error: String,
    pub total_size: usize,
    pub rows: Vec<DisassemblyRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[allow(dead_code)]
pub struct ProjectionReport {
    pub ok: bool,
    pub message: String,
    pub output_dir: Option<String>,
    pub projected_scene_candidates: usize,
    pub experimental: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RomAnalysisManifest {
    pub ok: bool,
    pub error: String,
    pub target: String,
    pub source_path: String,
    pub detected_format: String,
    pub stripped_header_bytes: usize,
    pub total_size: usize,
    pub hashes: RomHashes,
    pub header: RomHeader,
    pub mapper: String,
    pub special_chips: Vec<String>,
    pub segments: Vec<RomSegment>,
    pub graphics_regions: Vec<GraphicsCandidate>,
    pub text_regions: Vec<TextCandidate>,
    pub audio_regions: Vec<AudioCandidate>,
    pub code_regions: Vec<CodeRegion>,
    pub pointer_tables: Vec<PointerTableCandidate>,
    pub compression_regions: Vec<CompressionRegion>,
    pub call_graph: Vec<CallGraphEdge>,
    pub logic_hints: Vec<LogicHint>,
    pub annotations: Vec<ReverseAnnotation>,
    pub trace: TraceStatus,
    pub save: SaveRamStatus,
    pub projection_status: ProjectionStatus,
}
