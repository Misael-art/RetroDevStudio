use super::manifest::{ProjectionStatus, RomAnalysisManifest};

pub fn projection_status_for_manifest(manifest: &RomAnalysisManifest) -> ProjectionStatus {
    let can_project_assets = !manifest.graphics_regions.is_empty()
        || !manifest.text_regions.is_empty()
        || !manifest.audio_regions.is_empty();

    if can_project_assets {
        ProjectionStatus {
            supported: false,
            status: "analysis_only".to_string(),
            message: "Manifesto pronto para projecao futura, mas a conversao canonica ROM -> .rds ainda nao foi certificada nesta wave.".to_string(),
        }
    } else {
        ProjectionStatus {
            supported: false,
            status: "insufficient_signal".to_string(),
            message: "Nenhum conjunto confiavel de assets ou regioes semanticas foi detectado para projecao automatica.".to_string(),
        }
    }
}
