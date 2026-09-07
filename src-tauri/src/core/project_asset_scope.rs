use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use super::project_mgr::discover_project_rds;

#[derive(Default)]
pub struct ProjectAssetScopeState(pub Mutex<Option<PathBuf>>);

pub fn resolve_project_asset_root(project_dir: &str) -> Result<PathBuf, String> {
    let requested = project_dir.trim();
    if requested.is_empty() {
        return Err("Diretorio de projeto ausente para autorizar assets.".to_string());
    }

    let discovered = discover_project_rds(Path::new(requested)).map_err(|error| {
        format!(
            "Diretorio recusado pelo asset protocol: nao e um projeto RetroDev valido ({error})."
        )
    })?;
    fs::canonicalize(&discovered).map_err(|error| {
        format!(
            "Falha ao resolver diretorio de assets '{}': {error}",
            discovered.display()
        )
    })
}

pub fn authorize_project_assets(
    app: &AppHandle,
    state: &ProjectAssetScopeState,
    project_dir: &str,
) -> Result<String, String> {
    let canonical = resolve_project_asset_root(project_dir)?;
    let mut active = state
        .0
        .lock()
        .map_err(|_| "Estado do escopo de assets ficou indisponivel.".to_string())?;
    if active.as_ref() == Some(&canonical) {
        return Ok(canonical.to_string_lossy().to_string());
    }

    let scope = app.asset_protocol_scope();
    scope.allow_directory(&canonical, true).map_err(|error| {
        format!(
            "Falha ao autorizar assets do projeto '{}': {error}",
            canonical.display()
        )
    })?;
    if let Some(previous) = active.as_ref() {
        if let Err(error) = scope.forbid_directory(previous, true) {
            let _ = scope.forbid_directory(&canonical, true);
            return Err(format!(
                "Falha ao revogar o escopo de assets anterior '{}': {error}",
                previous.display()
            ));
        }
    }
    *active = Some(canonical.clone());
    Ok(canonical.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_fixture_is_an_authorized_project_root() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("projects")
            .join("megadrive_dummy");
        let resolved = resolve_project_asset_root(&fixture.to_string_lossy())
            .expect("canonical project should be accepted");
        assert!(resolved.join("project.rds").is_file());
    }

    #[test]
    fn arbitrary_directory_is_rejected() {
        let directory =
            std::env::temp_dir().join(format!("rds-rejected-asset-scope-{}", std::process::id()));
        fs::create_dir_all(&directory).expect("create temporary directory");
        let error = resolve_project_asset_root(&directory.to_string_lossy())
            .expect_err("directory without project.rds must be rejected");
        assert!(error.contains("nao e um projeto RetroDev valido"));
        let _ = fs::remove_dir_all(directory);
    }
}
