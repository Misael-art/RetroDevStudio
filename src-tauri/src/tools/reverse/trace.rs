use std::collections::{HashMap, HashSet};

use super::manifest::{RomSegment, TraceStatus};
use super::platform::LoadedRom;

#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct CpuState {
    pub m_flag: bool,
    pub x_flag: bool,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ExecutionTraceLog {
    pub executed_pcs: HashSet<u32>,
    pub cpu_states: HashMap<u32, CpuState>,
}

impl ExecutionTraceLog {
    pub fn mark_executed(&mut self, pc: u32) {
        self.executed_pcs.insert(pc);
    }

    pub fn mark_executed_with_state(&mut self, pc: u32, state: CpuState) {
        self.executed_pcs.insert(pc);
        self.cpu_states.insert(pc, state);
    }

    pub fn was_executed(&self, pc: u32) -> bool {
        self.executed_pcs.contains(&pc)
    }
}

pub fn default_trace_status(loaded: &LoadedRom) -> TraceStatus {
    TraceStatus {
        available: false,
        executed_regions: Vec::new(),
        note: loaded.trace_note.clone(),
    }
}

pub fn trace_status_from_log(
    loaded: &LoadedRom,
    trace: &ExecutionTraceLog,
    note: impl Into<String>,
) -> TraceStatus {
    let mut executed_regions = loaded
        .segments
        .iter()
        .filter(|segment| {
            trace
                .executed_pcs
                .iter()
                .any(|pc| *pc >= segment.start && *pc < segment.end)
        })
        .cloned()
        .collect::<Vec<_>>();

    if executed_regions.is_empty() && !trace.executed_pcs.is_empty() {
        let mut executed_pcs = trace.executed_pcs.iter().copied().collect::<Vec<_>>();
        executed_pcs.sort_unstable();

        let start = executed_pcs[0];
        let end = executed_pcs
            .last()
            .copied()
            .unwrap_or(start)
            .saturating_add(2);

        executed_regions.push(RomSegment {
            start,
            end,
            kind: "executed_trace".to_string(),
            label: "Executed trace window".to_string(),
            bank_index: None,
            confidence: 100,
        });
    }

    TraceStatus {
        available: !trace.executed_pcs.is_empty(),
        executed_regions,
        note: note.into(),
    }
}
