use crate::ugdm::entities::Scene;

use super::{md_profile, snes_profile, HwStatus};

pub fn hw_status_for_target(target: &str, scene: &Scene) -> Result<HwStatus, String> {
    match target {
        "megadrive" => Ok(md_profile::hw_status(scene)),
        "snes" => Ok(snes_profile::hw_status(scene)),
        other => Err(format!(
            "Target '{}' nao suportado. Use 'megadrive' ou 'snes'.",
            other
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ugdm::entities::Scene;

    fn empty_scene() -> Scene {
        Scene {
            scene_id: "main".to_string(),
            display_name: Some("Main Scene".to_string()),
            background_layers: Vec::new(),
            entities: Vec::new(),
            palettes: Vec::new(),
        }
    }

    #[test]
    fn rejects_unknown_target() {
        let error = hw_status_for_target("unknown", &empty_scene()).expect_err("target should fail");
        assert!(error.contains("nao suportado"));
    }

    #[test]
    fn returns_status_for_megadrive_scene() {
        let status = hw_status_for_target("megadrive", &empty_scene()).expect("megadrive status");
        assert_eq!(status.vram_limit, 65_536);
        assert_eq!(status.bg_layers_limit, 3);
    }
}
