use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};

use crate::compiler::ast_generator::generate_ast;
use crate::compiler::sgdk_emitter::emit_sgdk;
use crate::compiler::snes_emitter::emit_snes;
use crate::core::project_mgr::{load_project, load_scene};
use crate::hardware::md_profile;
use crate::hardware::snes_profile;

// ── Build Result ──────────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize, Clone)]
pub struct BuildLogLine {
    pub level: String, // "info" | "warn" | "error" | "success"
    pub message: String,
}

#[derive(Debug, serde::Serialize)]
pub struct BuildResult {
    pub ok: bool,
    pub rom_path: String,
    pub log: Vec<BuildLogLine>,
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Orquestra o build completo: UGDM → C → ROM.
/// `on_log`: callback chamado a cada linha de output do compilador.
pub fn run_build<F>(project_dir: &Path, on_log: F) -> BuildResult
where
    F: Fn(BuildLogLine),
{
    let mut log: Vec<BuildLogLine> = Vec::new();

    macro_rules! emit {
        ($level:expr, $msg:expr) => {{
            let entry = BuildLogLine {
                level: $level.to_string(),
                message: $msg.to_string(),
            };
            on_log(entry.clone());
            log.push(entry);
        }};
    }

    // ── 1. Carregar e validar projeto ─────────────────────────────────────────
    emit!("info", format!("Carregando projeto em: {}", project_dir.display()));

    let project = match load_project(project_dir) {
        Ok(p) => p,
        Err(e) => {
            emit!("error", format!("Falha ao carregar project.rds: {}", e));
            return BuildResult { ok: false, rom_path: String::new(), log };
        }
    };

    emit!("info", format!("Projeto '{}' carregado. Target: {}", project.name, project.target));

    let scene = match load_scene(project_dir, &project.entry_scene) {
        Ok(s) => s,
        Err(e) => {
            emit!("error", format!("Falha ao carregar cena '{}': {}", project.entry_scene, e));
            return BuildResult { ok: false, rom_path: String::new(), log };
        }
    };

    emit!("info", format!("Cena '{}' carregada ({} entidade(s)).", scene.scene_id, scene.entities.len()));

    // ── 2. Hardware validation ────────────────────────────────────────────────
    let hw_errors: Vec<_> = match project.target.as_str() {
        "megadrive" => md_profile::validate_scene(&scene)
            .into_iter()
            .map(|e| (e.message, e.is_fatal))
            .collect(),
        "snes" => snes_profile::validate_scene(&scene)
            .into_iter()
            .map(|e| (e.message, e.is_fatal))
            .collect(),
        other => {
            emit!("error", format!("Target '{}' não suportado. Use 'megadrive' ou 'snes'.", other));
            return BuildResult { ok: false, rom_path: String::new(), log };
        }
    };

    for (msg, is_fatal) in &hw_errors {
        if *is_fatal {
            emit!("error", msg);
        } else {
            emit!("warn", msg);
        }
    }

    if hw_errors.iter().any(|(_, is_fatal)| *is_fatal) {
        emit!("error", "Build abortado: erros de hardware constraints.");
        return BuildResult { ok: false, rom_path: String::new(), log };
    }

    // ── 3. Gerar código C ─────────────────────────────────────────────────────
    emit!("info", "Gerando código C via AST generator...");

    let ast = generate_ast(&project, &scene);
    let emit_out = match project.target.as_str() {
        "snes" => {
            emit!("info", "Target: SNES — usando emitter PVSnesLib.");
            let out = emit_snes(&ast, &project.name);
            // Wrap into a common shape reusing sgdk EmitOutput fields
            crate::compiler::sgdk_emitter::EmitOutput {
                main_c: out.main_c,
                resources_res: out.resources_res,
            }
        }
        _ => {
            emit!("info", "Target: Mega Drive — usando emitter SGDK.");
            emit_sgdk(&ast, &project.name)
        }
    };

    // ── 4. Preparar pasta de build ────────────────────────────────────────────
    let build_dir = project_dir.join("build");
    if let Err(e) = fs::create_dir_all(&build_dir) {
        emit!("error", format!("Não foi possível criar pasta build/: {}", e));
        return BuildResult { ok: false, rom_path: String::new(), log };
    }

    let main_c_path = build_dir.join("main.c");
    let resources_res_path = build_dir.join("resources.res");

    if let Err(e) = fs::write(&main_c_path, &emit_out.main_c) {
        emit!("error", format!("Falha ao gravar main.c: {}", e));
        return BuildResult { ok: false, rom_path: String::new(), log };
    }

    if let Err(e) = fs::write(&resources_res_path, &emit_out.resources_res) {
        emit!("error", format!("Falha ao gravar resources.res: {}", e));
        return BuildResult { ok: false, rom_path: String::new(), log };
    }

    emit!("success", format!("main.c gravado em: {}", main_c_path.display()));
    emit!("success", format!("resources.res gravado em: {}", resources_res_path.display()));

    // ── 5. Localizar toolchain ────────────────────────────────────────────────
    let toolchain = locate_toolchain(project_dir);

    match toolchain {
        ToolchainLocation::NotFound => {
            emit!("warn", "Toolchain SGDK não encontrada em toolchains/sgdk/.");
            emit!("warn", "Código C gerado com sucesso — instale o SGDK para compilar a ROM.");
            emit!("warn", "Consulte docs/02_TECH_STACK.md para instruções de instalação.");
            // Não é erro fatal — entrega o C gerado como resultado parcial válido.
            BuildResult {
                ok: true,
                rom_path: main_c_path.to_string_lossy().to_string(),
                log,
            }
        }
        ToolchainLocation::Found { gcc_path, sgdk_root } => {
            emit!("info", format!("Toolchain SGDK encontrada: {}", sgdk_root.display()));
            invoke_gcc(&gcc_path, &sgdk_root, &build_dir, &project.name, &mut log, &on_log)
        }
    }
}

// ── Toolchain discovery ───────────────────────────────────────────────────────

enum ToolchainLocation {
    NotFound,
    Found { gcc_path: PathBuf, sgdk_root: PathBuf },
}

/// Procura pelo GCC m68k em locais canônicos:
/// 1. toolchains/sgdk/ relativo à raiz do projeto (doc 08)
/// 2. Variável de ambiente SGDK_ROOT
/// 3. PATH do sistema (m68k-elf-gcc ou m68k-linux-gnu-gcc)
fn locate_toolchain(project_dir: &Path) -> ToolchainLocation {
    // Raiz do projeto = pai de "build/"
    let project_root = project_dir;

    // 1. toolchains/sgdk/ canônico
    let local_sgdk = project_root.join("toolchains").join("sgdk");
    let local_gcc = local_sgdk.join("bin").join(gcc_binary_name());

    if local_gcc.exists() {
        return ToolchainLocation::Found {
            gcc_path: local_gcc,
            sgdk_root: local_sgdk,
        };
    }

    // 2. SGDK_ROOT env var
    if let Ok(sgdk_env) = std::env::var("SGDK_ROOT") {
        let env_root = PathBuf::from(&sgdk_env);
        let env_gcc = env_root.join("bin").join(gcc_binary_name());
        if env_gcc.exists() {
            return ToolchainLocation::Found {
                gcc_path: env_gcc,
                sgdk_root: env_root,
            };
        }
    }

    // 3. PATH do sistema
    let system_gcc = which_gcc();
    if let Some(gcc) = system_gcc {
        // SGDK_ROOT deve estar definido se o GCC está no PATH
        let sgdk_root = std::env::var("SGDK_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/opt/sgdk"));
        return ToolchainLocation::Found {
            gcc_path: gcc,
            sgdk_root,
        };
    }

    ToolchainLocation::NotFound
}

fn gcc_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "m68k-elf-gcc.exe"
    } else {
        "m68k-elf-gcc"
    }
}

fn which_gcc() -> Option<PathBuf> {
    let candidates = ["m68k-elf-gcc", "m68k-linux-gnu-gcc"];
    for name in &candidates {
        let which_cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
        if let Ok(output) = Command::new(which_cmd).arg(name).output() {
            if output.status.success() {
                let path_str = String::from_utf8_lossy(&output.stdout);
                let path = PathBuf::from(path_str.trim());
                if path.exists() {
                    return Some(path);
                }
            }
        }
    }
    None
}

// ── GCC invocation ────────────────────────────────────────────────────────────

fn invoke_gcc<F>(
    gcc_path: &Path,
    sgdk_root: &Path,
    build_dir: &Path,
    project_name: &str,
    log: &mut Vec<BuildLogLine>,
    on_log: &F,
) -> BuildResult
where
    F: Fn(BuildLogLine),
{
    macro_rules! emit {
        ($level:expr, $msg:expr) => {{
            let entry = BuildLogLine {
                level: $level.to_string(),
                message: $msg.to_string(),
            };
            on_log(entry.clone());
            log.push(entry);
        }};
    }

    let main_c = build_dir.join("main.c");
    let rom_path = build_dir.join(format!("{}.md", project_name.to_lowercase().replace(' ', "_")));

    let sgdk_include = sgdk_root.join("inc");
    let sgdk_lib = sgdk_root.join("lib").join("libmd.a");

    emit!("info", format!("Invocando GCC m68k: {}", gcc_path.display()));
    emit!("info", format!("Saída ROM: {}", rom_path.display()));

    // Comando SGDK canônico:
    // m68k-elf-gcc -m68000 -Wall -O1 -fomit-frame-pointer -fno-builtin
    //   -I<sgdk>/inc -o out.elf main.c <sgdk>/lib/libmd.a
    //   -T <sgdk>/md.ld
    let mut cmd = Command::new(gcc_path);
    cmd.arg("-m68000")
        .arg("-Wall")
        .arg("-O1")
        .arg("-fomit-frame-pointer")
        .arg("-fno-builtin")
        .arg(format!("-I{}", sgdk_include.display()))
        .arg("-o")
        .arg(rom_path.with_extension("elf"))
        .arg(&main_c)
        .arg(&sgdk_lib)
        .arg("-T")
        .arg(sgdk_root.join("md.ld"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(build_dir);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            emit!("error", format!("Não foi possível iniciar o compilador: {}", e));
            return BuildResult { ok: false, rom_path: String::new(), log: log.clone() };
        }
    };

    // Captura stderr (GCC imprime warnings/errors no stderr) linha a linha
    if let Some(stderr) = child.stderr.take() {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let level = if line.contains("error:") { "error" } else { "warn" };
            emit!(level, &line);
        }
    }

    // Captura stdout linha a linha
    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            emit!("info", &line);
        }
    }

    let status = match child.wait() {
        Ok(s) => s,
        Err(e) => {
            emit!("error", format!("Erro aguardando compilador: {}", e));
            return BuildResult { ok: false, rom_path: String::new(), log: log.clone() };
        }
    };

    if !status.success() {
        emit!("error", format!("GCC falhou com código de saída: {:?}", status.code()));
        return BuildResult { ok: false, rom_path: String::new(), log: log.clone() };
    }

    // Converte ELF → ROM binária (.md) com objcopy
    let objcopy_path = gcc_path
        .parent()
        .map(|p| p.join(if cfg!(target_os = "windows") { "m68k-elf-objcopy.exe" } else { "m68k-elf-objcopy" }))
        .unwrap_or_else(|| PathBuf::from("m68k-elf-objcopy"));

    emit!("info", "Convertendo ELF → ROM binária...");

    let objcopy_status = Command::new(&objcopy_path)
        .arg("-O")
        .arg("binary")
        .arg(rom_path.with_extension("elf"))
        .arg(&rom_path)
        .current_dir(build_dir)
        .status();

    match objcopy_status {
        Ok(s) if s.success() => {
            emit!("success", format!("ROM gerada: {}", rom_path.display()));
            BuildResult {
                ok: true,
                rom_path: rom_path.to_string_lossy().to_string(),
                log: log.clone(),
            }
        }
        Ok(s) => {
            emit!("error", format!("objcopy falhou com código: {:?}", s.code()));
            BuildResult { ok: false, rom_path: String::new(), log: log.clone() }
        }
        Err(e) => {
            emit!("error", format!("Não foi possível invocar objcopy: {}", e));
            BuildResult { ok: false, rom_path: String::new(), log: log.clone() }
        }
    }
}
