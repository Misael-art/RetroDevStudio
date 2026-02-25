use std::path::Path;
use crate::ugdm::entities::{Project, Scene};

#[derive(Debug)]
pub struct LoadError(pub String);

impl std::fmt::Display for LoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Lê e desserializa o arquivo `project.rds` de um diretório de projeto.
pub fn load_project(project_dir: &Path) -> Result<Project, LoadError> {
    let rds_path = project_dir.join("project.rds");

    let content = std::fs::read_to_string(&rds_path).map_err(|e| {
        LoadError(format!(
            "Não foi possível ler '{}': {}",
            rds_path.display(),
            e
        ))
    })?;

    let project: Project = serde_json::from_str(&content).map_err(|e| {
        LoadError(format!(
            "project.rds inválido (erro de parsing JSON): {}",
            e
        ))
    })?;

    validate_project(&project)?;
    Ok(project)
}

/// Validações semânticas do Project (além do parsing JSON).
fn validate_project(project: &Project) -> Result<(), LoadError> {
    if project.name.trim().is_empty() {
        return Err(LoadError("project.rds: campo 'name' não pode ser vazio.".into()));
    }

    match project.target.as_str() {
        "megadrive" | "snes" => {}
        other => {
            return Err(LoadError(format!(
                "project.rds: target '{}' não reconhecido. Valores aceitos: 'megadrive', 'snes'.",
                other
            )))
        }
    }

    if project.fps != 50 && project.fps != 60 {
        return Err(LoadError(format!(
            "project.rds: fps '{}' inválido. Use 60 (NTSC) ou 50 (PAL).",
            project.fps
        )));
    }

    if project.entry_scene.trim().is_empty() {
        return Err(LoadError("project.rds: 'entry_scene' não pode ser vazio.".into()));
    }

    Ok(())
}

/// Lê e desserializa um arquivo de cena (ex: `scenes/level_01.json`).
pub fn load_scene(project_dir: &Path, scene_path: &str) -> Result<Scene, LoadError> {
    let full_path = project_dir.join(scene_path);

    let content = std::fs::read_to_string(&full_path).map_err(|e| {
        LoadError(format!(
            "Não foi possível ler cena '{}': {}",
            full_path.display(),
            e
        ))
    })?;

    let scene: Scene = serde_json::from_str(&content).map_err(|e| {
        LoadError(format!(
            "Cena '{}' inválida (erro de parsing JSON): {}",
            scene_path, e
        ))
    })?;

    Ok(scene)
}
