use std::collections::HashSet;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::blocking::{Client, RequestBuilder, Response};
use reqwest::header::{HeaderValue, AUTHORIZATION};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use zip::ZipArchive;

const INSTALL_MANIFEST_PREFIX: &str = ".retrodev-install-";
const MEGADRIVE_CORE_CANDIDATES: &[&str] = &["genesis_plus_gx_libretro", "picodrive_libretro"];
const SNES_CORE_CANDIDATES: &[&str] = &["snes9x_libretro", "bsnes_libretro"];
const HTTP_RETRY_ATTEMPTS: usize = 3;

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

#[derive(Debug, Deserialize)]
struct AdoptiumAvailableReleases {
    most_recent_lts: u32,
}

#[derive(Debug, Deserialize)]
struct AdoptiumPackage {
    link: String,
}

#[derive(Debug, Deserialize)]
struct AdoptiumBinary {
    package: AdoptiumPackage,
}

#[derive(Debug, Deserialize)]
struct AdoptiumRelease {
    binary: AdoptiumBinary,
    release_link: String,
    release_name: String,
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
    Jdk,
    Sgdk,
    PvsnesLib,
    LibretroMegaDriveCore,
    LibretroSnesCore,
}

impl DependencyKind {
    fn from_id(id: &str) -> Result<Self, String> {
        match id {
            "jdk" => Ok(Self::Jdk),
            "sgdk" => Ok(Self::Sgdk),
            "pvsneslib" => Ok(Self::PvsnesLib),
            "libretro_megadrive" => Ok(Self::LibretroMegaDriveCore),
            "libretro_snes" => Ok(Self::LibretroSnesCore),
            other => Err(format!(
                "Dependencia de terceiros desconhecida: '{}'.",
                other
            )),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Jdk => "jdk",
            Self::Sgdk => "sgdk",
            Self::PvsnesLib => "pvsneslib",
            Self::LibretroMegaDriveCore => "libretro_megadrive",
            Self::LibretroSnesCore => "libretro_snes",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Jdk => "JDK (Temurin LTS)",
            Self::Sgdk => "SGDK",
            Self::PvsnesLib => "PVSnesLib",
            Self::LibretroMegaDriveCore => "Libretro Core: Mega Drive",
            Self::LibretroSnesCore => "Libretro Core: SNES",
        }
    }

    fn source_url(self) -> &'static str {
        match self {
            Self::Jdk => "https://adoptium.net/temurin/releases/",
            Self::Sgdk => "https://github.com/Stephane-D/SGDK/releases",
            Self::PvsnesLib => "https://github.com/alekmaul/pvsneslib/releases",
            Self::LibretroMegaDriveCore | Self::LibretroSnesCore => {
                "https://buildbot.libretro.com/stable/"
            }
        }
    }

    fn install_dir(self) -> PathBuf {
        match self {
            Self::Jdk => repo_root().join("toolchains").join("jdk"),
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
            Self::Jdk => detect_java_program().is_some(),
            Self::Sgdk => {
                let root = self.install_dir();
                root.join("makefile.gen").exists()
                    || (root.join("bin").exists() && root.join("inc").exists())
            }
            Self::PvsnesLib => self
                .install_dir()
                .join("devkitsnes")
                .join("snes_rules")
                .exists(),
            Self::LibretroMegaDriveCore => contains_core_candidate(
                &self.install_dir(),
                &[MEGADRIVE_CORE_CANDIDATES[0], MEGADRIVE_CORE_CANDIDATES[1]],
            ),
            Self::LibretroSnesCore => {
                contains_core_candidate(&self.install_dir(), SNES_CORE_CANDIDATES)
            }
        }
    }

    fn status(self) -> DependencyStatus {
        let install_dir = match self {
            Self::Jdk => detect_java_install_dir(),
            _ => self.install_dir(),
        };
        let manifest = read_manifest(self.manifest_dir(), manifest_file_name(self));
        let installed = self.is_installed();
        let mut notes = Vec::new();
        let mut issues = Vec::new();

        match self {
            Self::Jdk => {
                notes.push(
                    "Instalacao automatica usa o Temurin LTS oficial em formato ZIP, sem alterar o sistema global."
                        .to_string(),
                );
                notes.push(
                    "Quando presente em `toolchains/jdk`, o app injeta `JAVA_HOME` e `PATH` localmente no build SGDK."
                        .to_string(),
                );
                if !installed {
                    issues.push(
                        "Java/JDK nao encontrado em JAVA_HOME, `toolchains/jdk` ou PATH."
                            .to_string(),
                    );
                }
            }
            Self::Sgdk => {
                notes.push(
                    "Instalacao automatica usa a release oficial do SGDK em GitHub Releases."
                        .to_string(),
                );
                notes.push(
                    "O build do Mega Drive continua falhando explicitamente se o toolchain nao estiver operacional."
                        .to_string(),
                );
                if cfg!(target_os = "windows") && detect_java_program().is_none() {
                    issues.push(
                        "Java/JDK nao encontrado. O SGDK upstream usa Java em parte das ferramentas."
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

fn ensure_sgdk_boot_templates(install_dir: &Path) -> Result<(), String> {
    let boot_dir = install_dir.join("src").join("boot");
    let sega_source = boot_dir.join("sega.s");
    let rom_head_source = boot_dir.join("rom_head.c");
    if sega_source.exists() && rom_head_source.exists() {
        return Ok(());
    }

    let fallback_boot_dir = install_dir
        .join("project")
        .join("template")
        .join("src")
        .join("boot");
    let fallback_sega = fallback_boot_dir.join("sega.s");
    let fallback_rom_head = fallback_boot_dir.join("rom_head.c");

    if !fallback_sega.exists() || !fallback_rom_head.exists() {
        return Err(format!(
            "Instalacao do SGDK em '{}' nao contem boot files em 'src/boot' nem no template oficial.",
            install_dir.display()
        ));
    }

    fs::create_dir_all(&boot_dir).map_err(|e| {
        format!(
            "Falha ao preparar boot files do SGDK em '{}': {}",
            boot_dir.display(),
            e
        )
    })?;

    fs::copy(&fallback_sega, &sega_source).map_err(|e| {
        format!(
            "Falha ao restaurar '{}': {}",
            sega_source.display(),
            e
        )
    })?;
    fs::copy(&fallback_rom_head, &rom_head_source).map_err(|e| {
        format!(
            "Falha ao restaurar '{}': {}",
            rom_head_source.display(),
            e
        )
    })?;

    Ok(())
}

pub fn dependency_status_report() -> DependencyStatusReport {
    DependencyStatusReport {
        items: [
            DependencyKind::Jdk,
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
    let current_status = dependency.status();

    if current_status.installed {
        if matches!(dependency, DependencyKind::Sgdk) {
            if let Err(error) = ensure_sgdk_boot_templates(&dependency.install_dir()) {
                logger.emit("error", &error);
                return DependencyInstallResult {
                    ok: false,
                    dependency_id: dependency.id().to_string(),
                    message: error,
                    status: dependency.status(),
                    log: logger.log,
                };
            }
        }

        let message = format!(
            "{} ja esta disponivel em '{}'.",
            current_status.label, current_status.install_dir
        );
        logger.emit("info", &message);
        return DependencyInstallResult {
            ok: true,
            dependency_id: dependency.id().to_string(),
            message,
            status: current_status,
            log: logger.log,
        };
    }

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
            logger.emit(
                "error",
                format!("Falha ao preparar cliente HTTP: {}", error),
            );
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
        DependencyKind::Jdk => install_jdk(&client, &mut logger),
        DependencyKind::Sgdk => install_sgdk(&client, &mut logger),
        DependencyKind::PvsnesLib => install_pvsneslib(&client, &mut logger),
        DependencyKind::LibretroMegaDriveCore | DependencyKind::LibretroSnesCore => {
            install_libretro_cores(&client, &mut logger)
        }
    };

    match install_result {
        Ok(message) => {
            let status = dependency.status();
            if !status.installed {
                let error = format!(
                    "{} reportada como instalada, mas os arquivos esperados nao foram encontrados em '{}'.",
                    dependency.label(),
                    status.install_dir
                );
                logger.emit("error", error.clone());
                return DependencyInstallResult {
                    ok: false,
                    dependency_id: dependency.id().to_string(),
                    message: error,
                    status,
                    log: logger.log,
                };
            }

            DependencyInstallResult {
                ok: true,
                dependency_id: dependency.id().to_string(),
                message,
                status,
                log: logger.log,
            }
        }
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

fn install_jdk<F>(client: &Client, logger: &mut InstallLogger<F>) -> Result<String, String>
where
    F: Fn(DependencyLogLine),
{
    logger.emit("info", "Consultando release oficial do Temurin LTS...");
    let (release_name, release_link, package_link) = fetch_latest_temurin_lts_package(client)?;
    logger.emit("info", format!("Release LTS selecionada: {}", release_name));

    let temp_dir = temp_install_dir("jdk")?;
    let archive_name = package_link
        .rsplit('/')
        .next()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("temurin-jdk.zip");
    let archive_path = temp_dir.join(archive_name);
    download_to_file(client, &package_link, &archive_path, logger)?;

    let extracted_dir = temp_dir.join("extracted");
    fs::create_dir_all(&extracted_dir)
        .map_err(|e| format!("Falha ao preparar extracao do JDK: {}", e))?;
    logger.emit("info", "Extraindo JDK...");
    extract_zip(&archive_path, &extracted_dir)?;

    let source_root = find_install_root(&extracted_dir, is_java_home_candidate)
        .ok_or_else(|| "Pacote JDK extraido sem estrutura reconhecivel.".to_string())?;

    let install_dir = DependencyKind::Jdk.install_dir();
    replace_dir_contents(&source_root, &install_dir)?;
    write_manifest(
        DependencyKind::Jdk.manifest_dir(),
        manifest_file_name(DependencyKind::Jdk),
        &InstallManifest {
            dependency_id: DependencyKind::Jdk.id().to_string(),
            version: release_name.clone(),
            source_url: release_link,
            installed_at_unix: unix_timestamp_now(),
        },
    )?;

    let java_program = install_dir.join("bin").join(platform_java_name());
    if !java_program.exists() {
        return Err(format!(
            "JDK instalada em '{}', mas '{}' nao foi encontrado.",
            install_dir.display(),
            java_program.display()
        ));
    }

    let message = format!(
        "JDK {} instalada em '{}'.",
        release_name,
        install_dir.to_string_lossy()
    );
    logger.emit("success", &message);
    Ok(message)
}

fn install_sgdk<F>(client: &Client, logger: &mut InstallLogger<F>) -> Result<String, String>
where
    F: Fn(DependencyLogLine),
{
    logger.emit("info", "Consultando release oficial do SGDK...");
    let release = fetch_latest_release(
        client,
        "https://api.github.com/repos/Stephane-D/SGDK/releases/latest",
        logger,
    )?;
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
        path.join("makefile.gen").exists()
            || (path.join("bin").exists() && path.join("inc").exists())
    })
    .ok_or_else(|| "Pacote SGDK extraido sem estrutura reconhecivel.".to_string())?;

    let install_dir = DependencyKind::Sgdk.install_dir();
    replace_dir_contents(&source_root, &install_dir)?;
    ensure_sgdk_boot_templates(&install_dir)?;
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

    if detect_java_program().is_none() {
        logger.emit(
            "warn",
            "SGDK instalado, mas Java/JDK nao foi encontrado. Instale o item 'JDK (Temurin LTS)' no Runtime Setup para completar o ambiente.",
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
        logger,
    )?;
    let asset = release
        .assets
        .iter()
        .find(|asset| {
            let lower = asset.name.to_ascii_lowercase();
            lower.ends_with(".zip") && lower.contains("windows")
        })
        .ok_or_else(|| {
            "A release oficial do PVSnesLib nao expoe um asset Windows .zip esperado.".to_string()
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
    logger.emit(
        "info",
        "Consultando release oficial mais recente do RetroArch...",
    );
    let release = fetch_latest_release(
        client,
        "https://api.github.com/repos/libretro/RetroArch/releases/latest",
        logger,
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
    logger.emit(
        "info",
        "Extraindo apenas os cores Libretro suportados pelo app...",
    );
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

fn fetch_latest_release<F>(
    client: &Client,
    url: &str,
    logger: &mut InstallLogger<F>,
) -> Result<GithubRelease, String>
where
    F: Fn(DependencyLogLine),
{
    let cache_path = github_release_cache_path(url);
    match send_request_with_retry(|| github_api_get(client, url)) {
        Ok(response) => {
            let raw = response
                .text()
                .map_err(|e| format!("Falha ao ler metadata de release oficial: {}", e))?;
            if let Some(path) = cache_path.as_ref() {
                if let Err(error) = write_github_release_cache(path, &raw) {
                    logger.emit("warn", error);
                }
            }
            parse_github_release_json(&raw)
                .map_err(|e| format!("Falha ao ler metadata de release oficial: {}", e))
        }
        Err(error) => {
            if let Some(path) = cache_path.as_ref() {
                if let Ok(raw) = fs::read_to_string(path) {
                    logger.emit(
                        "warn",
                        format!(
                            "{} Usando metadata cacheada em '{}'.",
                            github_release_error_message(url, &error),
                            path.display()
                        ),
                    );
                    return parse_github_release_json(&raw).map_err(|parse_error| {
                        format!(
                            "Falha ao ler metadata cacheada de release oficial em '{}': {}. Apague o cache e tente novamente.",
                            path.display(),
                            parse_error
                        )
                    });
                }
            }

            Err(github_release_error_message(url, &error))
        }
    }
}

fn github_api_get(client: &Client, url: &str) -> RequestBuilder {
    let request = client.get(url);
    if !url.starts_with("https://api.github.com/") {
        return request;
    }

    let Some(token) = github_api_token() else {
        return request;
    };
    let auth_value = format!("Bearer {}", token);
    match HeaderValue::from_str(&auth_value) {
        Ok(value) => request.header(AUTHORIZATION, value),
        Err(_) => request,
    }
}

fn github_api_token() -> Option<String> {
    std::env::var("RDS_GITHUB_TOKEN")
        .ok()
        .or_else(|| std::env::var("GITHUB_TOKEN").ok())
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
}

fn github_release_cache_path(url: &str) -> Option<PathBuf> {
    let repo = url
        .strip_prefix("https://api.github.com/repos/")?
        .strip_suffix("/releases/latest")?;
    let filename = repo.replace(['/', '\\'], "__");
    Some(
        repo_root()
            .join("toolchains")
            .join(".cache")
            .join("github-releases")
            .join(format!("{}__latest.json", filename)),
    )
}

fn write_github_release_cache(path: &Path, raw: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Falha ao preparar cache de metadata GitHub em '{}': {}",
                parent.display(),
                e
            )
        })?;
    }
    fs::write(path, raw).map_err(|e| {
        format!(
            "Falha ao gravar cache de metadata GitHub em '{}': {}",
            path.display(),
            e
        )
    })
}

fn parse_github_release_json(raw: &str) -> Result<GithubRelease, serde_json::Error> {
    serde_json::from_str::<GithubRelease>(raw)
}

fn github_release_error_message(url: &str, error: &reqwest::Error) -> String {
    let mut message = format!(
        "Falha ao consultar release oficial em '{}': {}.",
        url, error
    );
    if let Some(status) = error.status().and_then(github_api_status_hint) {
        message.push(' ');
        message.push_str(status);
    }
    message
}

fn github_api_status_hint(status: StatusCode) -> Option<&'static str> {
    match status {
        StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => Some(
            "A API do GitHub limitou a requisicao. Configure RDS_GITHUB_TOKEN ou GITHUB_TOKEN para aumentar o limite, ou tente novamente mais tarde.",
        ),
        status if status.is_server_error() => Some(
            "O servidor remoto respondeu com erro temporario; o Runtime Setup tentou novamente com backoff antes de falhar.",
        ),
        _ => None,
    }
}

fn send_request_with_retry<F>(mut build_request: F) -> Result<Response, reqwest::Error>
where
    F: FnMut() -> RequestBuilder,
{
    for attempt in 0..HTTP_RETRY_ATTEMPTS {
        match build_request()
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
        {
            Ok(response) => return Ok(response),
            Err(error) if attempt + 1 < HTTP_RETRY_ATTEMPTS && is_retryable_http_error(&error) => {
                std::thread::sleep(http_retry_delay(attempt));
            }
            Err(error) => return Err(error),
        }
    }

    unreachable!("HTTP retry loop must return on success or final error")
}

fn is_retryable_http_error(error: &reqwest::Error) -> bool {
    error.is_timeout() || error.is_connect() || error.status().is_some_and(is_retryable_http_status)
}

fn is_retryable_http_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::TOO_MANY_REQUESTS
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
    ) || status.is_server_error()
}

fn http_retry_delay(attempt: usize) -> Duration {
    Duration::from_millis(350 * (attempt as u64 + 1))
}

fn fetch_latest_temurin_lts_package(client: &Client) -> Result<(String, String, String), String> {
    let available = send_request_with_retry(|| {
        client.get("https://api.adoptium.net/v3/info/available_releases")
    })
    .map_err(|e| format!("Falha ao consultar releases LTS do Temurin: {}", e))?
    .json::<AdoptiumAvailableReleases>()
    .map_err(|e| format!("Falha ao ler releases LTS do Temurin: {}", e))?;

    let releases_url = format!(
        "https://api.adoptium.net/v3/assets/latest/{}/hotspot?os=windows&architecture=x64&image_type=jdk&jvm_impl=hotspot&heap_size=normal&vendor=eclipse",
        available.most_recent_lts
    );
    let mut releases = send_request_with_retry(|| client.get(&releases_url))
        .map_err(|e| format!("Falha ao consultar pacote Temurin LTS: {}", e))?
        .json::<Vec<AdoptiumRelease>>()
        .map_err(|e| format!("Falha ao ler metadata do pacote Temurin LTS: {}", e))?;

    let release = releases.drain(..).next().ok_or_else(|| {
        "A API oficial do Temurin nao retornou um pacote JDK LTS para Windows x64.".to_string()
    })?;

    Ok((
        release.release_name,
        release.release_link,
        release.binary.package.link,
    ))
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
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Falha ao preparar download em '{}': {}",
                parent.display(),
                e
            )
        })?;
    }

    logger.emit("info", format!("Baixando: {}", url));
    let mut response = send_request_with_retry(|| client.get(url))
        .map_err(|e| format!("Falha no download '{}': {}", url, e))?;

    if let Some(length) = response.content_length() {
        logger.emit(
            "info",
            format!(
                "Tamanho informado pelo servidor: {:.1} MB",
                length as f64 / 1_048_576.0
            ),
        );
    }

    let mut file = File::create(destination)
        .map_err(|e| format!("Falha ao criar arquivo '{}': {}", destination.display(), e))?;
    io::copy(&mut response, &mut file).map_err(|e| {
        format!(
            "Falha ao gravar download '{}': {}",
            destination.display(),
            e
        )
    })?;
    Ok(())
}

fn extract_zip(archive_path: &Path, target_dir: &Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|e| {
        format!(
            "Falha ao abrir arquivo zip '{}': {}",
            archive_path.display(),
            e
        )
    })?;
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
        let entry =
            entry.map_err(|e| format!("Falha ao ler entrada em '{}': {}", source.display(), e))?;
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

fn extract_supported_libretro_cores(
    archive_path: &Path,
    destination: &Path,
) -> Result<Vec<String>, String> {
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
        let Some(file_name) = Path::new(&entry_name)
            .file_name()
            .and_then(|name| name.to_str())
        else {
            io::copy(reader, &mut io::sink()).map_err(sevenz_rust2::Error::io)?;
            return Ok(true);
        };

        if !supported_file_names.contains(file_name) {
            io::copy(reader, &mut io::sink()).map_err(sevenz_rust2::Error::io)?;
            return Ok(true);
        }

        let destination_path = destination.join(file_name);
        sevenz_rust2::default_entry_extract_fn(entry, reader, &destination_path)?;

        if let Some(stem) = Path::new(file_name)
            .file_stem()
            .and_then(|name| name.to_str())
        {
            if !copied.iter().any(|existing| existing == stem) {
                copied.push(stem.to_string());
            }
        }

        Ok(true)
    })
    .map_err(|e| format!("Falha ao extrair pacote de cores Libretro: {}", e))?;

    if !copied.iter().any(|candidate| {
        MEGADRIVE_CORE_CANDIDATES
            .iter()
            .any(|expected| expected == candidate)
    }) {
        return Err(
            "Nenhum core suportado de Mega Drive foi encontrado no pacote oficial.".to_string(),
        );
    }

    if !copied.iter().any(|candidate| {
        SNES_CORE_CANDIDATES
            .iter()
            .any(|expected| expected == candidate)
    }) {
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

    fs::create_dir_all(destination).map_err(|e| {
        format!(
            "Falha ao preparar destino de teste '{}': {}",
            destination.display(),
            e
        )
    })?;

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
    fs::create_dir_all(&manifest_dir).map_err(|e| {
        format!(
            "Falha ao preparar manifest em '{}': {}",
            manifest_dir.display(),
            e
        )
    })?;
    let path = manifest_dir.join(file_name);
    let json = serde_json::to_vec_pretty(manifest)
        .map_err(|e| format!("Falha ao serializar manifest '{}': {}", path.display(), e))?;
    fs::write(&path, json)
        .map_err(|e| format!("Falha ao gravar manifest '{}': {}", path.display(), e))
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

fn platform_java_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    }
}

fn is_java_home_candidate(path: &Path) -> bool {
    path.join("bin").join(platform_java_name()).exists()
}

fn detect_java_home() -> Option<PathBuf> {
    std::env::var_os("JAVA_HOME")
        .map(PathBuf::from)
        .filter(|path| is_java_home_candidate(path))
        .or_else(|| {
            let local = DependencyKind::Jdk.install_dir();
            is_java_home_candidate(&local).then_some(local)
        })
}

fn detect_java_program() -> Option<PathBuf> {
    detect_java_home()
        .map(|root| root.join("bin").join(platform_java_name()))
        .filter(|path| path.exists())
        .or_else(|| find_in_path(&["java"]))
}

fn detect_java_install_dir() -> PathBuf {
    detect_java_home()
        .or_else(|| {
            detect_java_program()
                .and_then(|program| program.parent().and_then(Path::parent).map(Path::to_path_buf))
        })
        .unwrap_or_else(|| DependencyKind::Jdk.install_dir())
}

fn find_in_path(candidates: &[&str]) -> Option<PathBuf> {
    let locator = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
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
    use std::ffi::OsString;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_serial_guard() -> std::sync::MutexGuard<'static, ()> {
        static TEST_SERIAL: OnceLock<Mutex<()>> = OnceLock::new();
        TEST_SERIAL
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("dependency_manager test serial lock poisoned")
    }

    fn restore_env_var(name: &str, value: Option<OsString>) {
        match value {
            Some(value) => unsafe { std::env::set_var(name, value) },
            None => unsafe { std::env::remove_var(name) },
        }
    }

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
    fn github_api_get_uses_ci_token_only_for_github_api() {
        let _serial = test_serial_guard();
        let previous_rds_token = std::env::var_os("RDS_GITHUB_TOKEN");
        let previous_github_token = std::env::var_os("GITHUB_TOKEN");
        unsafe {
            std::env::set_var("RDS_GITHUB_TOKEN", "test-token");
            std::env::remove_var("GITHUB_TOKEN");
        }

        let client = Client::builder()
            .user_agent("RetroDevStudioTest")
            .build()
            .expect("build test client");
        let github_request = github_api_get(
            &client,
            "https://api.github.com/repos/Stephane-D/SGDK/releases/latest",
        )
        .build()
        .expect("build github request");
        assert_eq!(
            github_request
                .headers()
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("Bearer test-token")
        );

        let non_github_request =
            github_api_get(&client, "https://api.adoptium.net/v3/info/available_releases")
                .build()
                .expect("build non github request");
        assert!(
            non_github_request.headers().get(AUTHORIZATION).is_none(),
            "GitHub token must not be sent to non-GitHub APIs"
        );

        restore_env_var("RDS_GITHUB_TOKEN", previous_rds_token);
        restore_env_var("GITHUB_TOKEN", previous_github_token);
    }

    #[test]
    fn github_release_cache_path_is_stable_and_local() {
        let path = github_release_cache_path(
            "https://api.github.com/repos/Stephane-D/SGDK/releases/latest",
        )
        .expect("github release cache path");

        assert!(path.ends_with(
            Path::new("toolchains")
                .join(".cache")
                .join("github-releases")
                .join("Stephane-D__SGDK__latest.json")
        ));
        assert!(github_release_cache_path("https://example.com/releases/latest").is_none());
    }

    #[test]
    fn github_rate_limit_hint_is_actionable_without_secret_values() {
        let hint = github_api_status_hint(StatusCode::TOO_MANY_REQUESTS).expect("rate limit hint");

        assert!(hint.contains("RDS_GITHUB_TOKEN"));
        assert!(hint.contains("GITHUB_TOKEN"));
        assert!(!hint.contains("Bearer"));
    }

    #[test]
    fn retry_policy_only_retries_transient_http_statuses() {
        assert!(is_retryable_http_status(StatusCode::TOO_MANY_REQUESTS));
        assert!(is_retryable_http_status(StatusCode::BAD_GATEWAY));
        assert!(is_retryable_http_status(StatusCode::SERVICE_UNAVAILABLE));
        assert!(is_retryable_http_status(StatusCode::INTERNAL_SERVER_ERROR));
        assert!(!is_retryable_http_status(StatusCode::FORBIDDEN));
        assert!(!is_retryable_http_status(StatusCode::NOT_FOUND));
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
            manifest_file_name(DependencyKind::Jdk),
            ".retrodev-install-jdk.json"
        );
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

        assert!(copied
            .iter()
            .any(|candidate| candidate == "genesis_plus_gx_libretro"));
        assert!(copied
            .iter()
            .any(|candidate| candidate == "snes9x_libretro"));
        assert!(!destination_dir
            .join(format!("vice_xvic_libretro.{}", extension))
            .exists());

        let _ = fs::remove_dir_all(source_dir);
        let _ = fs::remove_dir_all(destination_dir);
    }

    #[test]
    fn jdk_status_detects_java_home() {
        let _serial = test_serial_guard();
        let java_home = temp_dir("java-home");
        let java_bin = java_home.join("bin");
        fs::create_dir_all(&java_bin).expect("create java home bin dir");
        fs::write(java_bin.join(platform_java_name()), b"fake-java").expect("write fake java");

        let previous_java_home = std::env::var_os("JAVA_HOME");
        unsafe { std::env::set_var("JAVA_HOME", &java_home) };

        let status = DependencyKind::Jdk.status();
        assert!(status.installed, "jdk status should detect JAVA_HOME");
        assert_eq!(PathBuf::from(&status.install_dir), java_home);
        assert!(status.issues.is_empty(), "unexpected issues: {:?}", status.issues);

        restore_env_var("JAVA_HOME", previous_java_home);
        let _ = fs::remove_dir_all(status.install_dir);
    }
}
