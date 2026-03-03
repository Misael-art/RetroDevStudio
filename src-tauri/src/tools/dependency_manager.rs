use std::collections::HashSet;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use zip::ZipArchive;

const INSTALL_MANIFEST_PREFIX: &str = ".retrodev-install-";
const MEGADRIVE_CORE_CANDIDATES: &[&str] = &["genesis_plus_gx_libretro", "picodrive_libretro"];
const SNES_CORE_CANDIDATES: &[&str] = &["snes9x_libretro", "bsnes_libretro"];

#[derive(Debug, Clone, Serialize)]
pub struct DependencyLogLine {
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyStatus {
    pub id: String,
    pub label: String,
    pub installed: bool,
    pub version: Option<String>,
    pub install_dir: String,
    pub source_url: String,
    pub auto_install_supported: bool,
    pub notes: Vec<String>,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyStatusReport {
    pub items: Vec<DependencyStatus>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyInstallResult {
    pub ok: bool,
    pub dependency_id: String,
    pub message: String,
    pub status: DependencyStatus,
    pub log: Vec<DependencyLogLine>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RomDependencyResult {
    pub dependency_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstallManifest {
    dependency_id: String,
    version: String,
    source_url: String,
    installed_at_unix: u64,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
}

struct InstallLogger<'a, F>
where
    F: Fn(DependencyLogLine),
{
    log: Vec<DependencyLogLine>,
    on_log: &'a F,
}

impl<'a, F> InstallLogger<'a, F>
where
    F: Fn(DependencyLogLine),
{
    fn new(on_log: &'a F) -> Self {
        Self {
            log: Vec::new(),
            on_log,
        }
    }

    fn emit(&mut self, level: &str, message: impl Into<String>) {
        let entry = DependencyLogLine {
            level: level.to_string(),
            message: message.into(),
        };
        (self.on_log)(entry.clone());
        self.log.push(entry);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DependencyKind {
    Sgdk,
    PvsnesLib,
    LibretroMegaDriveCore,
    LibretroSnesCore,
}

impl DependencyKind {
    fn from_id(id: &str) -> Result<Self, String> {
        match id {
            "sgdk" => Ok(Self::Sgdk),
            "pvsneslib" => Ok(Self::PvsnesLib),
            "libretro_megadrive" => Ok(Self::LibretroMegaDriveCore),
            "libretro_snes" => Ok(Self::LibretroSnesCore),
            other => Err(format!("Dependencia de terceiros desconhecida: '{}'.", other)),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Sgdk => "sgdk",
            Self::PvsnesLib => "pvsneslib",
            Self::LibretroMegaDriveCore => "libretro_megadrive",
            Self::LibretroSnesCore => "libretro_snes",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Sgdk => "SGDK",
            Self::PvsnesLib => "PVSnesLib",
            Self::LibretroMegaDriveCore => "Libretro Core: Mega Drive",
            Self::LibretroSnesCore => "Libretro Core: SNES",
        }
    }

    fn source_url(self) -> &'static str {
        match self {
            Self::Sgdk => "https://github.com/Stephane-D/SGDK/releases",
            Self::PvsnesLib => "https://github.com/alekmaul/pvsneslib/releases",
            Self::LibretroMegaDriveCore | Self::LibretroSnesCore => {
                "https://buildbot.libretro.com/stable/"
            }
        }
    }

    fn install_dir(self) -> PathBuf {
        match self {
            Self::Sgdk => repo_root().join("toolchains").join("sgdk"),
            Self::PvsnesLib => repo_root().join("toolchains").join("pvsneslib"),
            Self::LibretroMegaDriveCore | Self::LibretroSnesCore => repo_root()
                .join("toolchains")
                .join("libretro")
                .join("cores"),
        }
    }

    fn manifest_dir(self) -> PathBuf {
        match self {
            Self::LibretroMegaDriveCore | Self::LibretroSnesCore => {
                repo_root().join("toolchains").join("libretro")
            }
            _ => self.install_dir(),
        }
    }

    fn is_installed(self) -> bool {
        match self {
            Self::Sgdk => {
                let root = self.install_dir();
                root.join("makefile.gen").exists()
                    || (root.join("bin").exists() && root.join("inc").exists())
            }
            Self::PvsnesLib => self.install_dir().join("devkitsnes").join("snes_rules").exists(),
            Self::LibretroMegaDriveCore => contains_core_candidate(&self.install_dir(), &[
                MEGADRIVE_CORE_CANDIDATES[0],
                MEGADRIVE_CORE_CANDIDATES[1],
            ]),
            Self::LibretroSnesCore => {
                contains_core_candidate(&self.install_dir(), SNES_CORE_CANDIDATES)
            }
        }
    }

    fn status(self) -> DependencyStatus {
        let install_dir = self.install_dir();
        let manifest = read_manifest(self.manifest_dir(), manifest_file_name(self));
        let installed = self.is_installed();
        let mut notes = Vec::new();
        let mut issues = Vec::new();

        match self {
            Self::Sgdk => {
                notes.push(
                    "Instalacao automatica usa a release oficial do SGDK em GitHub Releases."
                        .to_string(),
                );
                notes.push(
                    "O build do Mega Drive continua falhando explicitamente se o toolchain nao estiver operacional."
                        .to_string(),
                );
                if cfg!(target_os = "windows") && find_in_path(&["java"]).is_none() {
                    issues.push(
                        "Java nao encontrado no PATH. O SGDK upstream usa Java em parte das ferramentas."
                            .to_string(),
                    );
                }
            }
            Self::PvsnesLib => {
                notes.push(
                    "Instalacao automatica usa a release oficial do PVSnesLib para Windows."
                        .to_string(),
                );
                notes.push(
                    "No Windows o build do SNES exige shell Unix-like (Git Bash ou MSYS2) por causa do snes_rules."
                        .to_string(),
                );
                notes.push(
                    "Quando o sistema nao tiver GNU make no PATH, o fluxo SNES reutiliza o make.exe instalado junto do SGDK."
                        .to_string(),
                );
                if cfg!(target_os = "windows") && detect_bash_program().is_none() {
                    issues.push(
                        "Git Bash ou MSYS2 bash nao encontrado. O caminho SNES precisa de shell Unix-like no Windows."
                            .to_string(),
                    );
                }
                if cfg!(target_os = "windows")
                    && find_in_path(&["make", "mingw32-make"]).is_none()
                    && detect_dependency_root("SGDK_ROOT", "sgdk")
                        .as_deref()
                        .and_then(detect_make_program)
                        .is_none()
                {
                    issues.push(
                        "GNU make nao encontrado. Instale SGDK pelo setup sob demanda ou disponibilize make/mingw32-make no PATH para builds SNES."
                            .to_string(),
                    );
                }
            }
            Self::LibretroMegaDriveCore | Self::LibretroSnesCore => {
                notes.push(
                    "Os cores sao baixados sob demanda do buildbot oficial do Libretro/RetroArch para o ambiente local do usuario."
                        .to_string(),
                );
                notes.push(
                    "Revise a licenca do core escolhido antes de redistribuir ou usar em contexto comercial."
                        .to_string(),
                );
            }
        }

        if !installed {
            issues.push(format!(
                "Nao instalado em '{}'.",
                install_dir.to_string_lossy()
            ));
        }

        DependencyStatus {
            id: self.id().to_string(),
            label: self.label().to_string(),
            installed,
            version: manifest
                .map(|manifest| manifest.version)
                .or_else(|| installed.then(|| "externo/manual".to_string())),
            install_dir: install_dir.to_string_lossy().to_string(),
            source_url: self.source_url().to_string(),
            auto_install_supported: cfg!(target_os = "windows"),
            notes,
            issues,
        }
    }
}

pub fn dependency_status_report() -> DependencyStatusReport {
    DependencyStatusReport {
        items: [
            DependencyKind::Sgdk,
            DependencyKind::PvsnesLib,
            DependencyKind::LibretroMegaDriveCore,
            DependencyKind::LibretroSnesCore,
        ]
        .into_iter()
        .map(DependencyKind::status)
        .collect(),
    }
}

pub fn dependency_for_rom_path(rom_path: &Path) -> Option<&'static str> {
    let extension = rom_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase());

    match extension.as_deref() {
        Some("md") | Some("gen") => Some(DependencyKind::LibretroMegaDriveCore.id()),
        Some("sfc") | Some("smc") => Some(DependencyKind::LibretroSnesCore.id()),
        Some("bin") => {
            if has_megadrive_header(rom_path) {
                Some(DependencyKind::LibretroMegaDriveCore.id())
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn install_dependency<F>(dependency_id: &str, on_log: F) -> DependencyInstallResult
where
    F: Fn(DependencyLogLine),
{
    let dependency = match DependencyKind::from_id(dependency_id) {
        Ok(dependency) => dependency,
        Err(error) => {
            let status = DependencyStatus {
                id: dependency_id.to_string(),
                label: dependency_id.to_string(),
                installed: false,
                version: None,
                install_dir: String::new(),
                source_url: String::new(),
                auto_install_supported: false,
                notes: Vec::new(),
                issues: vec![error.clone()],
            };
            return DependencyInstallResult {
                ok: false,
                dependency_id: dependency_id.to_string(),
                message: error,
                status,
                log: Vec::new(),
            };
        }
    };

    let mut logger = InstallLogger::new(&on_log);
    if !cfg!(target_os = "windows") {
        logger.emit(
            "error",
            "Instalacao automatica de dependencias de terceiros esta habilitada apenas para Windows nesta versao.",
        );
        return DependencyInstallResult {
            ok: false,
            dependency_id: dependency.id().to_string(),
            message: "Instalacao automatica nao suportada neste sistema operacional.".to_string(),
            status: dependency.status(),
            log: logger.log,
        };
    }

    let client = match Client::builder().user_agent("RetroDevStudio").build() {
        Ok(client) => client,
        Err(error) => {
            logger.emit("error", format!("Falha ao preparar cliente HTTP: {}", error));
            return DependencyInstallResult {
                ok: false,
                dependency_id: dependency.id().to_string(),
                message: format!("Falha ao preparar cliente HTTP: {}", error),
                status: dependency.status(),
                log: logger.log,
            };
        }
    };

    let install_result = match dependency {
        DependencyKind::Sgdk => install_sgdk(&client, &mut logger),
        DependencyKind::PvsnesLib => install_pvsneslib(&client, &mut logger),
        DependencyKind::LibretroMegaDriveCore | DependencyKind::LibretroSnesCore => {
            install_libretro_cores(&client, &mut logger)
        }
    };

    match install_result {
        Ok(message) => DependencyInstallResult {
            ok: true,
            dependency_id: dependency.id().to_string(),
            message,
            status: dependency.status(),
            log: logger.log,
        },
        Err(error) => {
            logger.emit("error", error.clone());
            DependencyInstallResult {
                ok: false,
                dependency_id: dependency.id().to_string(),
                message: error,
                status: dependency.status(),
                log: logger.log,
            }
        }
    }
}

fn install_sgdk<F>(client: &Client, logger: &mut InstallLogger<F>) -> Result<String, String>
where
    F: Fn(DependencyLogLine),
{
    logger.emit("info", "Consultando release oficial do SGDK...");
    let release = fetch_latest_release(client, "https://api.github.com/repos/Stephane-D/SGDK/releases/latest")?;
    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name.to_ascii_lowercase().ends_with(".7z"))
        .ok_or_else(|| "A release oficial do SGDK nao expoe um asset .7z esperado.".to_string())?;

    let temp_dir = temp_install_dir("sgdk")?;
    let archive_path = temp_dir.join(&asset.name);
    download_to_file(client, &asset.browser_download_url, &archive_path, logger)?;

    let extracted_dir = temp_dir.join("extracted");
    fs::create_dir_all(&extracted_dir)
        .map_err(|e| format!("Falha ao preparar extracao do SGDK: {}", e))?;
    logger.emit("info", "Extraindo SGDK...");
    sevenz_rust2::decompress_file(&archive_path, &extracted_dir)
        .map_err(|e| format!("Falha ao extrair pacote SGDK: {}", e))?;

    let source_root = find_install_root(&extracted_dir, |path| {
        path.join("makefile.gen").exists() || (path.join("bin").exists() && path.join("inc").exists())
    })
    .ok_or_else(|| "Pacote SGDK extraido sem estrutura reconhecivel.".to_string())?;

    let install_dir = DependencyKind::Sgdk.install_dir();
    replace_dir_contents(&source_root, &install_dir)?;
    write_manifest(
        DependencyKind::Sgdk.manifest_dir(),
        manifest_file_name(DependencyKind::Sgdk),
        &InstallManifest {
            dependency_id: DependencyKind::Sgdk.id().to_string(),
            version: release.tag_name.clone(),
            source_url: asset.browser_download_url.clone(),
            installed_at_unix: unix_timestamp_now(),
        },
    )?;

    if find_in_path(&["java"]).is_none() {
        logger.emit(
            "warn",
            "SGDK instalado, mas Java nao foi encontrado no PATH. Algumas ferramentas upstream podem requerer Java.",
        );
    }

    let message = format!(
        "SGDK {} instalada em '{}'.",
        release.tag_name,
        install_dir.to_string_lossy()
    );
    logger.emit("success", &message);
    Ok(message)
}

fn install_pvsneslib<F>(client: &Client, logger: &mut InstallLogger<F>) -> Result<String, String>
where
    F: Fn(DependencyLogLine),
{
    logger.emit("info", "Consultando release oficial do PVSnesLib...");
    let release = fetch_latest_release(
        client,
        "https://api.github.com/repos/alekmaul/pvsneslib/releases/latest",
    )?;
    let asset = release
        .assets
        .iter()
        .find(|asset| {
            let lower = asset.name.to_ascii_lowercase();
            lower.ends_with(".zip") && lower.contains("windows")
        })
        .ok_or_else(|| {
            "A release oficial do PVSnesLib nao expoe um asset Windows .zip esperado."
                .to_string()
        })?;

    let temp_dir = temp_install_dir("pvsneslib")?;
    let archive_path = temp_dir.join(&asset.name);
    download_to_file(client, &asset.browser_download_url, &archive_path, logger)?;

    let extracted_dir = temp_dir.join("extracted");
    fs::create_dir_all(&extracted_dir)
        .map_err(|e| format!("Falha ao preparar extracao do PVSnesLib: {}", e))?;
    logger.emit("info", "Extraindo PVSnesLib...");
    extract_zip(&archive_path, &extracted_dir)?;

    let source_root = find_install_root(&extracted_dir, |path| {
        path.join("devkitsnes").join("snes_rules").exists()
    })
    .ok_or_else(|| "Pacote PVSnesLib extraido sem estrutura reconhecivel.".to_string())?;

    let install_dir = DependencyKind::PvsnesLib.install_dir();
    replace_dir_contents(&source_root, &install_dir)?;
    write_manifest(
        DependencyKind::PvsnesLib.manifest_dir(),
        manifest_file_name(DependencyKind::PvsnesLib),
        &InstallManifest {
            dependency_id: DependencyKind::PvsnesLib.id().to_string(),
            version: release.tag_name.clone(),
            source_url: asset.browser_download_url.clone(),
            installed_at_unix: unix_timestamp_now(),
        },
    )?;

    if detect_bash_program().is_none() {
        logger.emit(
            "warn",
            "PVSnesLib instalado, mas Git Bash/MSYS2 nao foi encontrado. O build SNES requer shell Unix-like no Windows.",
        );
    }

    let message = format!(
        "PVSnesLib {} instalada em '{}'.",
        release.tag_name,
        install_dir.to_string_lossy()
    );
    logger.emit("success", &message);
    Ok(message)
}

fn install_libretro_cores<F>(
    client: &Client,
    logger: &mut InstallLogger<F>,
) -> Result<String, String>
where
    F: Fn(DependencyLogLine),
{
    logger.emit("info", "Consultando release oficial mais recente do RetroArch...");
    let release = fetch_latest_release(
        client,
        "https://api.github.com/repos/libretro/RetroArch/releases/latest",
    )?;
    let version = release.tag_name.trim_start_matches('v');
    let download_url = format!(
        "https://buildbot.libretro.com/stable/{}/windows/x86_64/RetroArch_cores.7z",
        version
    );

    let temp_dir = temp_install_dir("libretro-cores")?;
    let archive_path = temp_dir.join("RetroArch_cores.7z");
    download_to_file(client, &download_url, &archive_path, logger)?;

    let install_dir = DependencyKind::LibretroMegaDriveCore.install_dir();
    logger.emit("info", "Extraindo apenas os cores Libretro suportados pelo app...");
    let copied_cores = extract_supported_libretro_cores(&archive_path, &install_dir)?;
    let manifest = InstallManifest {
        dependency_id: "libretro_cores".to_string(),
        version: release.tag_name.clone(),
        source_url: download_url.clone(),
        installed_at_unix: unix_timestamp_now(),
    };
    write_manifest(
        DependencyKind::LibretroMegaDriveCore.manifest_dir(),
        manifest_file_name(DependencyKind::LibretroMegaDriveCore),
        &manifest,
    )?;
    write_manifest(
        DependencyKind::LibretroSnesCore.manifest_dir(),
        manifest_file_name(DependencyKind::LibretroSnesCore),
        &manifest,
    )?;

    if !DependencyKind::LibretroMegaDriveCore.is_installed()
        || !DependencyKind::LibretroSnesCore.is_installed()
    {
        return Err(
            "O pacote de cores Libretro foi extraido, mas os DLLs esperados nao foram encontrados."
                .to_string(),
        );
    }

    let message = format!(
        "Pacote oficial de cores Libretro {} instalado em '{}' ({}).",
        release.tag_name,
        install_dir.to_string_lossy(),
        copied_cores.join(", ")
    );
    logger.emit("success", &message);
    Ok(message)
}

fn fetch_latest_release(client: &Client, url: &str) -> Result<GithubRelease, String> {
    client
        .get(url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|e| format!("Falha ao consultar release oficial: {}", e))?
        .json::<GithubRelease>()
        .map_err(|e| format!("Falha ao ler metadata de release oficial: {}", e))
}

fn download_to_file<F>(
    client: &Client,
    url: &str,
    destination: &Path,
    logger: &mut InstallLogger<F>,
) -> Result<(), String>
where
    F: Fn(DependencyLogLine),
{
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Falha ao preparar download em '{}': {}", parent.display(), e))?;
    }

    logger.emit("info", format!("Baixando: {}", url));
    let mut response = client
        .get(url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|e| format!("Falha no download '{}': {}", url, e))?;

    if let Some(length) = response.content_length() {
        logger.emit(
            "info",
            format!("Tamanho informado pelo servidor: {:.1} MB", length as f64 / 1_048_576.0),
        );
    }

    let mut file = File::create(destination)
        .map_err(|e| format!("Falha ao criar arquivo '{}': {}", destination.display(), e))?;
    io::copy(&mut response, &mut file)
        .map_err(|e| format!("Falha ao gravar download '{}': {}", destination.display(), e))?;
    Ok(())
}

fn extract_zip(archive_path: &Path, target_dir: &Path) -> Result<(), String> {
    let file = File::open(archive_path)
        .map_err(|e| format!("Falha ao abrir arquivo zip '{}': {}", archive_path.display(), e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Falha ao ler zip '{}': {}", archive_path.display(), e))?;
    archive
        .extract(target_dir)
        .map_err(|e| format!("Falha ao extrair zip '{}': {}", archive_path.display(), e))
}

fn replace_dir_contents(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        fs::remove_dir_all(destination).map_err(|e| {
            format!(
                "Falha ao limpar destino de instalacao '{}': {}",
                destination.display(),
                e
            )
        })?;
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Falha ao preparar '{}': {}", parent.display(), e))?;
    }

    copy_dir_all(source, destination)
}

fn copy_dir_all(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|e| format!("Falha ao criar '{}': {}", destination.display(), e))?;

    for entry in fs::read_dir(source)
        .map_err(|e| format!("Falha ao listar '{}': {}", source.display(), e))?
    {
        let entry = entry.map_err(|e| format!("Falha ao ler entrada em '{}': {}", source.display(), e))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir_all(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path).map_err(|e| {
                format!(
                    "Falha ao copiar '{}' para '{}': {}",
                    source_path.display(),
                    destination_path.display(),
                    e
                )
            })?;
        }
    }

    Ok(())
}

fn find_install_root<F>(start: &Path, predicate: F) -> Option<PathBuf>
where
    F: Copy + Fn(&Path) -> bool,
{
    if predicate(start) {
        return Some(start.to_path_buf());
    }

    let entries = fs::read_dir(start).ok()?;
    for entry in entries {
        let entry = entry.ok()?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Some(found) = find_install_root(&path, predicate) {
            return Some(found);
        }
    }

    None
}

fn contains_core_candidate(root: &Path, candidates: &[&str]) -> bool {
    let extension = shared_library_extension();

    candidates
        .iter()
        .map(|candidate| root.join(format!("{}.{}", candidate, extension)))
        .any(|path| path.exists())
}

fn extract_supported_libretro_cores(archive_path: &Path, destination: &Path) -> Result<Vec<String>, String> {
    if destination.exists() {
        fs::remove_dir_all(destination).map_err(|e| {
            format!(
                "Falha ao limpar destino de instalacao '{}': {}",
                destination.display(),
                e
            )
        })?;
    }

    fs::create_dir_all(destination)
        .map_err(|e| format!("Falha ao preparar '{}': {}", destination.display(), e))?;

    let extension = shared_library_extension();
    let supported_file_names = MEGADRIVE_CORE_CANDIDATES
        .iter()
        .chain(SNES_CORE_CANDIDATES.iter())
        .map(|candidate| format!("{}.{}", candidate, extension))
        .collect::<HashSet<_>>();
    let mut copied = Vec::new();

    sevenz_rust2::decompress_file_with_extract_fn(archive_path, destination, |entry, reader, _| {
        if entry.is_directory() {
            return Ok(true);
        }

        let entry_name = entry.name().replace('\\', "/");
        let Some(file_name) = Path::new(&entry_name).file_name().and_then(|name| name.to_str()) else {
            io::copy(reader, &mut io::sink()).map_err(sevenz_rust2::Error::io)?;
            return Ok(true);
        };

        if !supported_file_names.contains(file_name) {
            io::copy(reader, &mut io::sink()).map_err(sevenz_rust2::Error::io)?;
            return Ok(true);
        }

        let destination_path = destination.join(file_name);
        sevenz_rust2::default_entry_extract_fn(entry, reader, &destination_path)?;

        if let Some(stem) = Path::new(file_name).file_stem().and_then(|name| name.to_str()) {
            if !copied.iter().any(|existing| existing == stem) {
                copied.push(stem.to_string());
            }
        }

        Ok(true)
    })
    .map_err(|e| format!("Falha ao extrair pacote de cores Libretro: {}", e))?;

    if !copied
        .iter()
        .any(|candidate| MEGADRIVE_CORE_CANDIDATES.iter().any(|expected| expected == candidate))
    {
        return Err("Nenhum core suportado de Mega Drive foi encontrado no pacote oficial.".to_string());
    }

    if !copied
        .iter()
        .any(|candidate| SNES_CORE_CANDIDATES.iter().any(|expected| expected == candidate))
    {
        return Err("Nenhum core suportado de SNES foi encontrado no pacote oficial.".to_string());
    }

    Ok(copied)
}

fn shared_library_extension() -> &'static str {
    if cfg!(target_os = "windows") {
        "dll"
    } else if cfg!(target_os = "macos") {
        "dylib"
    } else {
        "so"
    }
}

#[cfg(test)]
fn copy_supported_libretro_cores_for_test(
    source_root: &Path,
    destination: &Path,
) -> Result<Vec<String>, String> {
    if destination.exists() {
        fs::remove_dir_all(destination).map_err(|e| {
            format!(
                "Falha ao limpar destino de teste '{}': {}",
                destination.display(),
                e
            )
        })?;
    }

    fs::create_dir_all(destination)
        .map_err(|e| format!("Falha ao preparar destino de teste '{}': {}", destination.display(), e))?;

    let extension = shared_library_extension();
    let mut copied = Vec::new();

    for candidate in MEGADRIVE_CORE_CANDIDATES
        .iter()
        .chain(SNES_CORE_CANDIDATES.iter())
    {
        let source = source_root.join(format!("{}.{}", candidate, extension));
        if !source.exists() {
            continue;
        }

        let destination_path = destination.join(format!("{}.{}", candidate, extension));
        fs::copy(&source, &destination_path).map_err(|e| {
            format!(
                "Falha ao copiar '{}' para '{}': {}",
                source.display(),
                destination_path.display(),
                e
            )
        })?;
        copied.push((*candidate).to_string());
    }

    Ok(copied)
}

fn read_manifest(manifest_dir: PathBuf, file_name: String) -> Option<InstallManifest> {
    let path = manifest_dir.join(file_name);
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice::<InstallManifest>(&bytes).ok()
}

fn write_manifest(
    manifest_dir: PathBuf,
    file_name: String,
    manifest: &InstallManifest,
) -> Result<(), String> {
    fs::create_dir_all(&manifest_dir)
        .map_err(|e| format!("Falha ao preparar manifest em '{}': {}", manifest_dir.display(), e))?;
    let path = manifest_dir.join(file_name);
    let json = serde_json::to_vec_pretty(manifest)
        .map_err(|e| format!("Falha ao serializar manifest '{}': {}", path.display(), e))?;
    fs::write(&path, json).map_err(|e| format!("Falha ao gravar manifest '{}': {}", path.display(), e))
}

fn manifest_file_name(dependency: DependencyKind) -> String {
    format!("{}{}.json", INSTALL_MANIFEST_PREFIX, dependency.id())
}

fn temp_install_dir(prefix: &str) -> Result<PathBuf, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "retro-dev-studio-install-{}-{}-{}",
        prefix,
        std::process::id(),
        nonce
    ));
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Falha ao criar pasta temporaria '{}': {}", dir.display(), e))?;
    Ok(dir)
}

fn unix_timestamp_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

fn detect_dependency_root(env_var: &str, local_dir_name: &str) -> Option<PathBuf> {
    std::env::var_os(env_var)
        .map(PathBuf::from)
        .filter(|path| path.exists())
        .or_else(|| {
            let local = repo_root().join("toolchains").join(local_dir_name);
            local.exists().then_some(local)
        })
}

fn detect_make_program(root: &Path) -> Option<PathBuf> {
    let bundled = root.join("bin").join(if cfg!(target_os = "windows") {
        "make.exe"
    } else {
        "make"
    });
    bundled.exists().then_some(bundled)
}

fn find_in_path(candidates: &[&str]) -> Option<PathBuf> {
    let locator = if cfg!(target_os = "windows") { "where" } else { "which" };
    for candidate in candidates {
        if let Ok(output) = Command::new(locator).arg(candidate).output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .map(PathBuf::from)?;
                if path.exists() {
                    return Some(path);
                }
            }
        }
    }

    None
}

fn detect_bash_program() -> Option<PathBuf> {
    [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
        r"C:\msys64\usr\bin\bash.exe",
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|path| path.exists())
    .or_else(|| {
        let output = Command::new("where").arg("bash").output().ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(PathBuf::from)
            .find(|path| {
                path.exists()
                    && !path
                        .to_string_lossy()
                        .to_ascii_lowercase()
                        .contains("\\windows\\system32\\bash.exe")
            })
    })
}

fn has_megadrive_header(path: &Path) -> bool {
    let bytes = fs::read(path).ok();
    matches!(
        bytes.as_deref(),
        Some(bytes) if bytes.len() >= 0x110 && &bytes[0x100..0x10F] == b"SEGA MEGA DRIVE"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "retro-dev-studio-deps-test-{}-{}-{}",
            prefix,
            std::process::id(),
            nonce
        ));
        fs::create_dir_all(&path).expect("create temp test dir");
        path
    }

    #[test]
    fn rom_dependency_detection_supports_known_extensions() {
        assert_eq!(
            dependency_for_rom_path(Path::new("game.md")),
            Some("libretro_megadrive")
        );
        assert_eq!(
            dependency_for_rom_path(Path::new("game.gen")),
            Some("libretro_megadrive")
        );
        assert_eq!(
            dependency_for_rom_path(Path::new("game.sfc")),
            Some("libretro_snes")
        );
        assert_eq!(
            dependency_for_rom_path(Path::new("game.smc")),
            Some("libretro_snes")
        );
    }

    #[test]
    fn manifest_file_names_are_stable() {
        assert_eq!(
            manifest_file_name(DependencyKind::Sgdk),
            ".retrodev-install-sgdk.json"
        );
        assert_eq!(
            manifest_file_name(DependencyKind::LibretroSnesCore),
            ".retrodev-install-libretro_snes.json"
        );
    }

    #[test]
    fn libretro_install_copies_only_supported_cores() {
        let source_dir = temp_dir("libretro-source");
        let destination_dir = temp_dir("libretro-destination");
        let extension = shared_library_extension();

        for candidate in MEGADRIVE_CORE_CANDIDATES
            .iter()
            .chain(SNES_CORE_CANDIDATES.iter())
        {
            fs::write(
                source_dir.join(format!("{}.{}", candidate, extension)),
                b"test-core",
            )
            .expect("write supported core");
        }
        fs::write(
            source_dir.join(format!("vice_xvic_libretro.{}", extension)),
            b"ignore-me",
        )
        .expect("write unsupported core");

        let copied = copy_supported_libretro_cores_for_test(&source_dir, &destination_dir)
            .expect("install supported cores");

        assert!(copied.iter().any(|candidate| candidate == "genesis_plus_gx_libretro"));
        assert!(copied.iter().any(|candidate| candidate == "snes9x_libretro"));
        assert!(
            !destination_dir
                .join(format!("vice_xvic_libretro.{}", extension))
                .exists()
        );

        let _ = fs::remove_dir_all(source_dir);
        let _ = fs::remove_dir_all(destination_dir);
    }
}
