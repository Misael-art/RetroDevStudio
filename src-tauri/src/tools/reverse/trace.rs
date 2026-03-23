use super::manifest::TraceStatus;
use super::platform::LoadedRom;

pub fn default_trace_status(loaded: &LoadedRom) -> TraceStatus {
    TraceStatus {
        available: false,
        executed_regions: Vec::new(),
        note: loaded.trace_note.clone(),
    }
}
