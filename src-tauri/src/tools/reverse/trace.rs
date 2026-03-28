use std::collections::{HashMap, HashSet};

use super::manifest::TraceStatus;
use super::platform::LoadedRom;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CpuState {
    pub m_flag: bool,
    pub x_flag: bool,
}

#[derive(Debug, Clone, Default)]
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
