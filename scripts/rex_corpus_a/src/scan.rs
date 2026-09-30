//! Rastrexo de candidatos Kosinski nunha imaxe.
//!
//! Un decode limpo **non** confirma un recurso: isto entrega candidatos coa
//! súa medida, e a confirmación chega en [`crate::consumer`].

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScanLimits {
    pub from: usize,
    pub to: Option<usize>,
    pub stride: usize,
    pub min_output: usize,
    pub max_output: usize,
    pub work_limit: usize,
    pub max_candidates: usize,
}

impl ScanLimits {
    pub const DEFAULT: ScanLimits = ScanLimits {
        from: 0,
        to: None,
        stride: 2,
        min_output: 16,
        max_output: 0x20_0000,
        work_limit: 4_000_000,
        max_candidates: 4096,
    };
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub offset: usize,
    pub bytes_consumed: usize,
    pub output_size: usize,
    pub output_sha256: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Refusals {
    pub truncated: usize,
    pub invalid_reference: usize,
    pub excessive_output: usize,
    pub work_limit: usize,
    pub empty_input: usize,
    pub below_min_output: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScanReport {
    pub attempts: usize,
    pub candidates: Vec<Candidate>,
    pub refusals: Refusals,
    pub truncated_by_limit: bool,
}

pub fn scan(_image: &[u8], _limits: &ScanLimits) -> ScanReport {
    todo!()
}
