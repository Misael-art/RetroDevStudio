use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const HOST_READINESS_SCHEMA: &str = "rds-host-readiness/v1";
const RUNTIME_DIAGNOSTICS_SCHEMA: &str = "rds-runtime-dependency-diagnostics/v2";
const RUNTIME_DIAGNOSTICS_REPORT: &str = "runtime-dependency-diagnostics.json";

#[derive(Debug, Clone, Serialize)]
pub struct DependencyLogLine {
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyStatus {
    pub id: String,
    pub label: String,
    pub applicable: bool,
    pub installed: bool,
    pub version: Option<String>,
    pub status_code: String,
    pub status_label: String,
    pub severity: String,
    pub install_dir: String,
    pub source_url: String,
    pub auto_install_supported: bool,
    pub cache_available: bool,
    pub manual_configuration_required: bool,
    pub actionable_message: String,
    pub notes: Vec<String>,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyStatusReport {
    pub schema: String,
    pub generated_at_unix: u64,
    pub report_path: String,
    pub host_state: String,
    pub host_fingerprint: Option<String>,
    pub lock_digest: Option<String>,
    pub blockers: Vec<String>,
    pub summary: DependencyStatusSummary,
    pub items: Vec<DependencyStatus>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyStatusSummary {
    pub total: usize,
    pub installed: usize,
    pub blocking: usize,
    pub warnings: usize,
    pub manual_required: usize,
    pub cache_available: usize,
    pub download_failed: usize,
    pub not_applicable: usize,
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

#[derive(Debug, Clone, Deserialize)]
struct HostReadinessReport {
    schema: String,
    state: String,
    lock_digest: Option<String>,
    host_fingerprint: Option<String>,
    #[serde(default)]
    blockers: Vec<String>,
    #[serde(default)]
    checks: Vec<HostReadinessCheck>,
}

#[derive(Debug, Clone, Deserialize)]
struct HostReadinessCheck {
    id: String,
    #[serde(default)]
    applicable: bool,
    status: String,
    version: Option<String>,
    path: Option<String>,
    #[serde(default)]
    installed: bool,
    compatible: Option<bool>,
    #[serde(default)]
    install_supported: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DependencyKind {
    Jdk,
    Sgdk,
    PvsnesLib,
    LibretroMegaDriveCore,
    LibretroSnesCore,
    Msvc,
    GitBash,
    WebDriver,
    TauriDriver,
}

impl DependencyKind {
    fn all() -> [Self; 9] {
        [
            Self::Jdk,
            Self::Sgdk,
            Self::PvsnesLib,
            Self::LibretroMegaDriveCore,
            Self::LibretroSnesCore,
            Self::Msvc,
            Self::GitBash,
            Self::WebDriver,
            Self::TauriDriver,
        ]
    }

    fn from_id(id: &str) -> Result<Self, String> {
        match id {
            "jdk" => Ok(Self::Jdk),
            "sgdk" => Ok(Self::Sgdk),
            "pvsneslib" => Ok(Self::PvsnesLib),
            "libretro_megadrive" => Ok(Self::LibretroMegaDriveCore),
            "libretro_snes" => Ok(Self::LibretroSnesCore),
            "msvc" => Ok(Self::Msvc),
            "git_bash" => Ok(Self::GitBash),
            "webdriver" => Ok(Self::WebDriver),
            "tauri_driver" => Ok(Self::TauriDriver),
            other => Err(format!("Dependencia de terceiros desconhecida: '{other}'.")),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Jdk => "jdk",
            Self::Sgdk => "sgdk",
            Self::PvsnesLib => "pvsneslib",
            Self::LibretroMegaDriveCore => "libretro_megadrive",
            Self::LibretroSnesCore => "libretro_snes",
            Self::Msvc => "msvc",
            Self::GitBash => "git_bash",
            Self::WebDriver => "webdriver",
            Self::TauriDriver => "tauri_driver",
        }
    }

    fn host_check_id(self) -> &'static str {
        match self {
            Self::Jdk => "jdk21",
            Self::Sgdk => "sgdk",
            Self::PvsnesLib => "pvsneslib",
            Self::LibretroMegaDriveCore => "libretro_md",
            Self::LibretroSnesCore => "libretro_snes",
            Self::Msvc => "msvc",
            Self::GitBash => "git_bash",
            Self::WebDriver => "webdriver",
            Self::TauriDriver => "tauri_driver",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Jdk => "JDK 21 (Temurin)",
            Self::Sgdk => "SGDK 2.11",
            Self::PvsnesLib => "PVSnesLib 4.5.0",
            Self::LibretroMegaDriveCore => "Libretro Core: Mega Drive",
            Self::LibretroSnesCore => "Libretro Core: SNES",
            Self::Msvc => "MSVC Build Tools",
            Self::GitBash => "Git Bash / MSYS2",
            Self::WebDriver => "WebDriver",
            Self::TauriDriver => "tauri-driver",
        }
    }

    fn source_url(self) -> &'static str {
        match self {
            Self::Jdk => "https://adoptium.net/temurin/releases/",
            Self::Sgdk => "https://github.com/Stephane-D/SGDK/releases/tag/v2.11",
            Self::PvsnesLib => "https://github.com/alekmaul/pvsneslib/releases/tag/4.5.0",
            Self::LibretroMegaDriveCore | Self::LibretroSnesCore => {
                "https://buildbot.libretro.com/stable/1.22.2/"
            }
            Self::Msvc => "https://visualstudio.microsoft.com/visual-cpp-build-tools/",
            Self::GitBash => "https://git-scm.com/download/win",
            Self::WebDriver => "https://v2.tauri.app/reference/webdriver/",
            Self::TauriDriver => "https://v2.tauri.app/reference/webdriver/",
        }
    }

    fn applicable_without_report(self) -> bool {
        if cfg!(target_os = "windows") {
            true
        } else {
            !matches!(self, Self::Msvc | Self::GitBash)
        }
    }
}

pub fn dependency_status_report() -> DependencyStatusReport {
    let _ = run_host_manager("diagnose", |_| {});
    let report_path = runtime_diagnostics_report_path();
    let report = build_dependency_status_report(load_host_readiness_report(), &report_path);
    if let Err(error) = write_dependency_status_report_to_path(&report, &report_path) {
        eprintln!("[dependency_manager] falha ao gravar relatorio Runtime Setup: {error}");
    }
    report
}

fn build_dependency_status_report(
    host_report: Option<HostReadinessReport>,
    report_path: &Path,
) -> DependencyStatusReport {
    let items = DependencyKind::all()
        .into_iter()
        .map(|dependency| dependency_status_from_host(dependency, host_report.as_ref()))
        .collect::<Vec<_>>();
    let blockers = host_report
        .as_ref()
        .map(|report| report.blockers.clone())
        .unwrap_or_else(|| vec!["host_readiness:missing_or_invalid".to_string()]);

    DependencyStatusReport {
        schema: RUNTIME_DIAGNOSTICS_SCHEMA.to_string(),
        generated_at_unix: unix_timestamp_now(),
        report_path: report_path.to_string_lossy().to_string(),
        host_state: host_report
            .as_ref()
            .map(|report| report.state.clone())
            .unwrap_or_else(|| "BLOCKED".to_string()),
        host_fingerprint: host_report
            .as_ref()
            .and_then(|report| report.host_fingerprint.clone()),
        lock_digest: host_report
            .as_ref()
            .and_then(|report| report.lock_digest.clone()),
        blockers,
        summary: summarize_dependency_statuses(&items),
        items,
    }
}

fn dependency_status_from_host(
    dependency: DependencyKind,
    host_report: Option<&HostReadinessReport>,
) -> DependencyStatus {
    let check = host_report.and_then(|report| {
        report
            .checks
            .iter()
            .find(|check| check.id == dependency.host_check_id())
    });
    let applicable = check
        .map(|check| check.applicable)
        .unwrap_or_else(|| dependency.applicable_without_report());
    let installed = check.is_some_and(|check| {
        applicable && check.status == "ready" && check.installed && check.compatible.unwrap_or(true)
    });
    let report_ready = host_report.is_some_and(|report| {
        matches!(report.state.as_str(), "READY" | "REPAIRED") && report.blockers.is_empty()
    });
    let status_code = if !applicable {
        "not_applicable"
    } else if installed {
        "installed"
    } else if host_report.is_none() {
        "host_report_missing"
    } else if check.is_none() {
        "contract_drift"
    } else {
        "blocked"
    };
    let (status_label, severity) = match status_code {
        "not_applicable" => ("NAO APLICAVEL", "ok"),
        "installed" => ("PRONTO", "ok"),
        "contract_drift" => ("DRIFT DE CONTRATO", "blocking"),
        "host_report_missing" => ("SEM DIAGNOSTICO", "blocking"),
        _ => ("BLOQUEADO", "blocking"),
    };
    let mut issues = Vec::new();
    if applicable && !installed {
        if let Some(report) = host_report {
            issues.extend(
                report
                    .blockers
                    .iter()
                    .filter(|blocker| {
                        blocker.starts_with(dependency.host_check_id())
                            || blocker.starts_with(dependency.id())
                    })
                    .cloned(),
            );
            if issues.is_empty() {
                issues.push(format!(
                    "Probe '{}' nao esta pronto no relatorio comum.",
                    dependency.host_check_id()
                ));
            }
        } else {
            issues.push("Relatorio host-readiness.json ausente ou invalido.".to_string());
        }
    }

    let actionable_message = match status_code {
        "installed" => format!(
            "{} validada pelo lock e pelo probe operacional do host comum.",
            dependency.label()
        ),
        "not_applicable" => format!(
            "{} nao se aplica a este sistema operacional e nao bloqueia o host.",
            dependency.label()
        ),
        _ => "Execute o reparo comum do host (`npm run host:ensure` ou o bootstrap nivel zero) e revalide; o Runtime Setup nao consulta releases mutaveis."
            .to_string(),
    };
    let mut notes = Vec::new();
    if let Some(report) = host_report {
        if let Some(digest) = report.lock_digest.as_deref() {
            notes.push(format!("Lock digest: {digest}"));
        }
        if let Some(fingerprint) = report.host_fingerprint.as_deref() {
            notes.push(format!("Host fingerprint: {fingerprint}"));
        }
    }
    if applicable && installed && !report_ready {
        notes.push(
            "A dependencia passou isoladamente, mas o host completo ainda nao esta READY."
                .to_string(),
        );
    }

    DependencyStatus {
        id: dependency.id().to_string(),
        label: dependency.label().to_string(),
        applicable,
        installed,
        version: check.and_then(|check| check.version.clone()),
        status_code: status_code.to_string(),
        status_label: status_label.to_string(),
        severity: severity.to_string(),
        install_dir: check
            .and_then(|check| check.path.clone())
            .unwrap_or_else(|| "Resolvido pelo host-readiness.json".to_string()),
        source_url: dependency.source_url().to_string(),
        auto_install_supported: applicable
            && !installed
            && check.is_none_or(|check| check.install_supported),
        cache_available: false,
        manual_configuration_required: false,
        actionable_message,
        notes,
        issues,
    }
}

pub fn install_dependency<F>(dependency_id: &str, on_log: F) -> DependencyInstallResult
where
    F: Fn(DependencyLogLine),
{
    let dependency = match DependencyKind::from_id(dependency_id) {
        Ok(dependency) => dependency,
        Err(error) => {
            let mut status = dependency_status_from_host(DependencyKind::Jdk, None);
            status.id = dependency_id.to_string();
            status.label = "Dependencia desconhecida".to_string();
            status.applicable = false;
            status.status_code = "invalid_dependency_id".to_string();
            status.status_label = "ID INVALIDO".to_string();
            status.auto_install_supported = false;
            status.actionable_message = error.clone();
            status.issues = vec![error.clone()];
            return DependencyInstallResult {
                ok: false,
                dependency_id: dependency_id.to_string(),
                message: error,
                status,
                log: Vec::new(),
            };
        }
    };
    let mut log = Vec::new();
    let mut emit = |level: &str, message: String| {
        let line = DependencyLogLine {
            level: level.to_string(),
            message: sanitize_log_message(&message),
        };
        on_log(line.clone());
        log.push(line);
    };

    let before = dependency_status_from_host(dependency, load_host_readiness_report().as_ref());
    if before.installed || !before.applicable {
        let message = before.actionable_message.clone();
        emit("info", message.clone());
        return DependencyInstallResult {
            ok: true,
            dependency_id: dependency.id().to_string(),
            message,
            status: before,
            log,
        };
    }

    emit(
        "info",
        "Delegando reparo ao orquestrador comum bloqueado pelo manifesto.".to_string(),
    );
    let command_result = run_host_manager("ensure", |line| {
        let sanitized = DependencyLogLine {
            level: line.level,
            message: sanitize_log_message(&line.message),
        };
        on_log(sanitized.clone());
        log.push(sanitized);
    });
    let report = load_host_readiness_report();
    let status = dependency_status_from_host(dependency, report.as_ref());
    let ok = command_result.is_ok() && status.installed;
    let message = if ok {
        format!(
            "{} reparada e validada pelo host comum.",
            dependency.label()
        )
    } else {
        command_result.err().unwrap_or_else(|| {
            format!(
                "{} continua bloqueada; consulte host-readiness.json.",
                dependency.label()
            )
        })
    };

    DependencyInstallResult {
        ok,
        dependency_id: dependency.id().to_string(),
        message,
        status,
        log,
    }
}

fn run_host_manager<F>(mode: &str, mut on_log: F) -> Result<(), String>
where
    F: FnMut(DependencyLogLine),
{
    let root = repo_root();
    let node = load_host_readiness_report()
        .and_then(|report| {
            report
                .checks
                .into_iter()
                .find(|check| check.id == "node" && check.status == "ready")
                .and_then(|check| check.path)
        })
        .map(PathBuf::from)
        .filter(|path| path.exists())
        .or_else(|| {
            find_in_path(if cfg!(target_os = "windows") {
                &["node.exe", "node"]
            } else {
                &["node"]
            })
        });

    let mut command = if let Some(node) = node {
        let mut command = Command::new(node);
        command
            .arg(root.join("scripts").join("host-manager.mjs"))
            .arg(mode)
            .arg("--profile")
            .arg("full");
        command
    } else if mode == "ensure" && cfg!(target_os = "windows") {
        let mut command = Command::new("powershell");
        command
            .arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(root.join("scripts").join("bootstrap.ps1"))
            .arg("-Ensure")
            .arg("-Profile")
            .arg("Full");
        command
    } else if mode == "ensure" {
        let mut command = Command::new("bash");
        command
            .arg(root.join("scripts").join("bootstrap.sh"))
            .arg("--ensure")
            .arg("--profile")
            .arg("full");
        command
    } else {
        return Err(
            "Node oficial nao encontrado; execute o bootstrap nivel zero antes do diagnostico."
                .to_string(),
        );
    };
    let output = command
        .current_dir(&root)
        .output()
        .map_err(|error| format!("Falha ao iniciar orquestrador comum: {error}"))?;

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if !line.trim().is_empty() {
            on_log(DependencyLogLine {
                level: "info".to_string(),
                message: sanitize_log_message(line),
            });
        }
    }
    for line in String::from_utf8_lossy(&output.stderr).lines() {
        if !line.trim().is_empty() {
            on_log(DependencyLogLine {
                level: "warn".to_string(),
                message: sanitize_log_message(line),
            });
        }
    }
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Orquestrador comum encerrou com codigo {}.",
            output.status.code().unwrap_or(-1)
        ))
    }
}

fn sanitize_log_message(message: &str) -> String {
    let mut sanitized = message.to_string();
    for name in ["RDS_GITHUB_TOKEN", "GITHUB_TOKEN"] {
        if let Ok(secret) = std::env::var(name) {
            if !secret.trim().is_empty() {
                sanitized = sanitized.replace(&secret, "[REDACTED]");
            }
        }
    }
    if let Some(home) = std::env::var_os(if cfg!(target_os = "windows") {
        "USERPROFILE"
    } else {
        "HOME"
    }) {
        let home = home.to_string_lossy();
        if !home.is_empty() {
            sanitized = sanitized.replace(home.as_ref(), "~");
        }
    }
    sanitized
}

fn load_host_readiness_report() -> Option<HostReadinessReport> {
    let raw = fs::read_to_string(host_readiness_report_path()).ok()?;
    let report = serde_json::from_str::<HostReadinessReport>(&raw).ok()?;
    (report.schema == HOST_READINESS_SCHEMA).then_some(report)
}

fn host_readiness_report_path() -> PathBuf {
    std::env::var_os("RDS_HOST_READINESS_REPORT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            repo_root()
                .join("src-tauri")
                .join("target-test")
                .join("validation")
                .join("host-readiness.json")
        })
}

fn runtime_diagnostics_report_path() -> PathBuf {
    repo_root()
        .join("src-tauri")
        .join("target-test")
        .join("validation")
        .join(RUNTIME_DIAGNOSTICS_REPORT)
}

fn write_dependency_status_report_to_path(
    report: &DependencyStatusReport,
    path: &Path,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Falha ao preparar diretorio do relatorio '{}': {error}",
                parent.display()
            )
        })?;
    }
    let json = serde_json::to_vec_pretty(report)
        .map_err(|error| format!("Falha ao serializar relatorio: {error}"))?;
    fs::write(path, json)
        .map_err(|error| format!("Falha ao gravar relatorio '{}': {error}", path.display()))
}

fn summarize_dependency_statuses(items: &[DependencyStatus]) -> DependencyStatusSummary {
    DependencyStatusSummary {
        total: items.iter().filter(|item| item.applicable).count(),
        installed: items.iter().filter(|item| item.installed).count(),
        blocking: items
            .iter()
            .filter(|item| item.applicable && item.severity == "blocking")
            .count(),
        warnings: items
            .iter()
            .filter(|item| item.applicable && item.severity == "warning")
            .count(),
        manual_required: items
            .iter()
            .filter(|item| item.manual_configuration_required)
            .count(),
        cache_available: items.iter().filter(|item| item.cache_available).count(),
        download_failed: items
            .iter()
            .filter(|item| item.status_code == "download_failed")
            .count(),
        not_applicable: items.iter().filter(|item| !item.applicable).count(),
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
        Some("bin") if has_megadrive_header(rom_path) => {
            Some(DependencyKind::LibretroMegaDriveCore.id())
        }
        _ => None,
    }
}

fn find_in_path(candidates: &[&str]) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&path) {
        for candidate in candidates {
            let path = directory.join(candidate);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

fn repo_root() -> PathBuf {
    std::env::var_os("RDS_REPO_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
}

fn unix_timestamp_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
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

    fn ready_report() -> HostReadinessReport {
        HostReadinessReport {
            schema: HOST_READINESS_SCHEMA.to_string(),
            state: "READY".to_string(),
            lock_digest: Some("a".repeat(64)),
            host_fingerprint: Some("b".repeat(64)),
            blockers: Vec::new(),
            checks: vec![
                HostReadinessCheck {
                    id: "jdk21".to_string(),
                    applicable: true,
                    status: "ready".to_string(),
                    version: Some("21.0.11".to_string()),
                    path: Some("/cache/jdk".to_string()),
                    installed: true,
                    compatible: Some(true),
                    install_supported: true,
                },
                HostReadinessCheck {
                    id: "msvc".to_string(),
                    applicable: false,
                    status: "not_applicable".to_string(),
                    version: None,
                    path: None,
                    installed: false,
                    compatible: None,
                    install_supported: false,
                },
            ],
        }
    }

    #[test]
    fn runtime_status_uses_common_host_report() {
        let report = ready_report();
        let status = dependency_status_from_host(DependencyKind::Jdk, Some(&report));
        assert!(status.installed);
        assert_eq!(status.status_code, "installed");
        assert_eq!(status.version.as_deref(), Some("21.0.11"));
        assert!(status.actionable_message.contains("lock"));
    }

    #[test]
    fn non_applicable_windows_dependency_does_not_block_linux_report() {
        let report = ready_report();
        let status = dependency_status_from_host(DependencyKind::Msvc, Some(&report));
        assert!(!status.applicable);
        assert!(!status.installed);
        assert_eq!(status.status_code, "not_applicable");
        assert_eq!(status.severity, "ok");
    }

    #[test]
    fn missing_common_report_is_blocking_and_actionable() {
        let status = dependency_status_from_host(DependencyKind::Sgdk, None);
        assert_eq!(status.status_code, "host_report_missing");
        assert_eq!(status.severity, "blocking");
        assert!(status.actionable_message.contains("host:ensure"));
    }

    #[test]
    fn unknown_dependency_id_never_masquerades_as_jdk() {
        let result = install_dependency("unknown-tool", |_| {});
        assert!(!result.ok);
        assert_eq!(result.status.id, "unknown-tool");
        assert_eq!(result.status.status_code, "invalid_dependency_id");
        assert!(!result.status.auto_install_supported);
    }

    #[test]
    fn runtime_summary_excludes_not_applicable_dependencies() {
        let report = build_dependency_status_report(
            Some(ready_report()),
            Path::new("runtime-dependency-diagnostics.json"),
        );
        // A fixture declara `msvc` como nao aplicavel em qualquer host. `git_bash`
        // nao tem check na fixture, entao cai em `applicable_without_report()`:
        // aplicavel no Windows, nao aplicavel fora dele. Fixar numeros absolutos
        // fazia o teste passar so no host onde foi escrito (not_applicable=2 e
        // total=7 valem no Linux; no Windows sao 1 e 8).
        let expected_not_applicable = if cfg!(target_os = "windows") { 1 } else { 2 };
        assert_eq!(report.summary.not_applicable, expected_not_applicable);
        // `total` conta apenas os aplicaveis, entao as duas metricas particionam
        // o conjunto completo de DependencyKind. Assertar a invariante em vez de
        // um numero solto mantem o teste correto em qualquer host.
        assert_eq!(
            report.summary.total + report.summary.not_applicable,
            DependencyKind::all().len()
        );
        assert_eq!(report.schema, RUNTIME_DIAGNOSTICS_SCHEMA);
    }

    #[test]
    fn sanitizer_redacts_tokens_and_home_directory() {
        let previous_token = std::env::var_os("RDS_GITHUB_TOKEN");
        unsafe { std::env::set_var("RDS_GITHUB_TOKEN", "secret-test-token") };
        let output = sanitize_log_message("token=secret-test-token");
        assert_eq!(output, "token=[REDACTED]");
        match previous_token {
            Some(value) => unsafe { std::env::set_var("RDS_GITHUB_TOKEN", value) },
            None => unsafe { std::env::remove_var("RDS_GITHUB_TOKEN") },
        }
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
    fn runtime_report_writes_canonical_json() {
        let output = std::env::temp_dir().join(format!(
            "rds-runtime-report-{}-{}.json",
            std::process::id(),
            unix_timestamp_now()
        ));
        let report = build_dependency_status_report(Some(ready_report()), &output);
        write_dependency_status_report_to_path(&report, &output).expect("write report");
        let raw = fs::read_to_string(&output).expect("read report");
        assert!(raw.contains(RUNTIME_DIAGNOSTICS_SCHEMA));
        assert!(raw.contains("host_fingerprint"));
        let _ = fs::remove_file(output);
    }
}
