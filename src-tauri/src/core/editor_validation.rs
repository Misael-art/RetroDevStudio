use std::path::Path;

use serde::Serialize;

use crate::hardware::{constraint_engine, HwStatus};
use crate::ugdm::entities::Scene;

use super::project_mgr::{load_project, load_scene, validate_scene};

#[derive(Debug, Default, Serialize, Clone, PartialEq, Eq)]
pub struct DraftValidationResult {
    pub ok: bool,
    pub error: String,
    pub hw_status: HwStatus,
}

impl DraftValidationResult {
    pub fn success(hw_status: HwStatus) -> Self {
        Self {
            ok: true,
            error: String::new(),
            hw_status,
        }
    }

    pub fn failure(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: message.into(),
            hw_status: HwStatus::default(),
        }
    }
}

pub fn validate_scene_draft(project_dir: &Path, scene_json: &str) -> DraftValidationResult {
    let project = match load_project(project_dir) {
        Ok(project) => project,
        Err(error) => return DraftValidationResult::failure(error.to_string()),
    };

    let scene = match serde_json::from_str::<Scene>(scene_json) {
        Ok(scene) => scene,
        Err(error) => {
            return DraftValidationResult::failure(format!(
                "JSON de cena invalido para preview: {}",
                error
            ));
        }
    };

    if let Err(error) = validate_scene(&scene) {
        return DraftValidationResult::failure(error.to_string());
    }

    match constraint_engine::hw_status_for_target(&project.target, &scene) {
        Ok(hw_status) => DraftValidationResult::success(hw_status),
        Err(error) => DraftValidationResult::failure(error),
    }
}

pub fn authoritative_hw_status(project_dir: &Path) -> Result<HwStatus, String> {
    let project = load_project(project_dir).map_err(|error| error.to_string())?;
    let scene = load_scene(project_dir, &project.entry_scene).map_err(|error| error.to_string())?;

    constraint_engine::hw_status_for_target(&project.target, &scene)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn fixture_dir(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("projects")
            .join(name)
    }

    #[test]
    fn validates_canonical_megadrive_fixture_draft() {
        let project_dir = fixture_dir("megadrive_dummy");
        let scene_json = fs::read_to_string(project_dir.join("scenes").join("main.json"))
            .expect("read fixture scene");

        let result = validate_scene_draft(&project_dir, &scene_json);

        assert!(result.ok, "unexpected error: {}", result.error);
        assert!(result.hw_status.errors.is_empty());
    }

    #[test]
    fn rejects_invalid_scene_json() {
        let project_dir = fixture_dir("megadrive_dummy");
        let result = validate_scene_draft(&project_dir, "{ invalid json");

        assert!(!result.ok);
        assert!(result.error.contains("JSON de cena invalido"));
    }

    #[test]
    fn rejects_semantically_invalid_scene() {
        let project_dir = fixture_dir("megadrive_dummy");
        let invalid_scene = r#"{
          "scene_id": "main",
          "entities": [
            { "entity_id": "dup", "transform": { "x": 0, "y": 0 }, "components": {} },
            { "entity_id": "dup", "transform": { "x": 8, "y": 8 }, "components": {} }
          ],
          "background_layers": [],
          "palettes": []
        }"#;

        let result = validate_scene_draft(&project_dir, invalid_scene);

        assert!(!result.ok);
        assert!(result.error.contains("duplicado"));
    }

    #[test]
    fn live_preview_matches_authoritative_megadrive_hw_status() {
        let project_dir = fixture_dir("megadrive_dummy");
        let scene_json = fs::read_to_string(project_dir.join("scenes").join("main.json"))
            .expect("read fixture scene");

        let preview = validate_scene_draft(&project_dir, &scene_json);
        let authoritative = authoritative_hw_status(&project_dir).expect("authoritative status");

        assert!(preview.ok, "unexpected preview error: {}", preview.error);
        assert_eq!(preview.hw_status, authoritative);
    }

    #[test]
    fn live_preview_matches_authoritative_snes_hw_status() {
        let project_dir = fixture_dir("snes_dummy");
        let scene_json = fs::read_to_string(project_dir.join("scenes").join("main.json"))
            .expect("read fixture scene");

        let preview = validate_scene_draft(&project_dir, &scene_json);
        let authoritative = authoritative_hw_status(&project_dir).expect("authoritative status");

        assert!(preview.ok, "unexpected preview error: {}", preview.error);
        assert_eq!(preview.hw_status, authoritative);
    }
}
