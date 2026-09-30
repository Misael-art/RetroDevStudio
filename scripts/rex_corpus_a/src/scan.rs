//! Rastrexo de candidatos Kosinski nunha imaxe.
//!
//! Un decode limpo **non** confirma un recurso: isto entrega candidatos coa
//! súa medida, e a confirmación chega en [`crate::consumer`]. Por iso o
//! resultado separa intentos, candidatos e negativas **por motivo exacto**:
//! se todo fallo se agrupase nun só contador, a ferramenta non podería
//! distinguir un fluxo truncado dunha referencia imposible.
//!
//! O decodificador consumido é o fixado en `crates/rex-kosinski` (Kosinski
//! base, sen maxia: o fluxo empeza directamente no descritor). Non se escribe
//! unha segunda implementación do codec.

use rex_kosinski::edit::sha256_hex;
use rex_kosinski::KosError;

/// Versión do contrato de saída do barrido.
pub const SCHEMA_SCAN: &str = "rex-corpus-scan/v1";

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
    /// Decodificación limpa pero demasiado curta para ser un recurso. Non é un
    /// negativo do formato: Kosinski acepta secións curtas por construción.
    pub below_min_output: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScanReport {
    pub attempts: usize,
    pub candidates: Vec<Candidate>,
    pub refusals: Refusals,
    pub truncated_by_limit: bool,
}

fn conta(refusals: &mut Refusals, e: KosError) {
    match e {
        KosError::Truncated => refusals.truncated += 1,
        KosError::InvalidReference => refusals.invalid_reference += 1,
        KosError::ExcessiveOutput => refusals.excessive_output += 1,
        KosError::WorkLimit => refusals.work_limit += 1,
        KosError::EmptyInput => refusals.empty_input += 1,
    }
}

pub fn scan(image: &[u8], limits: &ScanLimits) -> ScanReport {
    let to = limits.to.unwrap_or(image.len()).min(image.len());
    let from = limits.from.min(to);
    let mut report = ScanReport {
        attempts: 0,
        candidates: Vec::new(),
        refusals: Refusals::default(),
        truncated_by_limit: false,
    };
    if limits.stride == 0 {
        return report;
    }
    let mut offset = from;
    while offset + 1 < to {
        if report.candidates.len() >= limits.max_candidates {
            report.truncated_by_limit = true;
            break;
        }
        report.attempts += 1;
        match rex_kosinski::decode(&image[offset..to], limits.max_output, limits.work_limit) {
            Ok(d) => {
                if d.output.len() >= limits.min_output {
                    report.candidates.push(Candidate {
                        offset,
                        bytes_consumed: d.bytes_consumed,
                        output_size: d.output.len(),
                        output_sha256: sha256_hex(&d.output),
                    });
                } else {
                    report.refusals.below_min_output += 1;
                }
            }
            Err(e) => conta(&mut report.refusals, e),
        }
        offset += limits.stride;
    }
    report
}
