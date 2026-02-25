import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

// ── Types (mirror do Rust) ────────────────────────────────────────────────────

export interface BuildLogLine {
  level: "info" | "warn" | "error" | "success";
  message: string;
}

export interface BuildResult {
  ok: boolean;
  rom_path: string;
  log: BuildLogLine[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface GenerateResult {
  ok: boolean;
  main_c: string;
  resources_res: string;
  errors: string[];
  warnings: string[];
}

// ── IPC calls ─────────────────────────────────────────────────────────────────

/**
 * Valida um projeto .rds contra as hardware constraints.
 * Retorna ok=false com lista de erros se houver violações.
 */
export function validateProject(projectDir: string): Promise<ValidationResult> {
  return invoke<ValidationResult>("validate_project", { projectDir });
}

/**
 * Gera main.c + resources.res sem compilar.
 * Útil para inspecionar o código C gerado antes do build.
 */
export function generateCCode(projectDir: string): Promise<GenerateResult> {
  return invoke<GenerateResult>("generate_c_code", { projectDir });
}

/**
 * Orquestra o build completo: UGDM → C → ROM.
 *
 * @param projectDir  Caminho absoluto para o diretório do projeto .rds
 * @param onLog       Callback chamado em tempo real para cada linha de log do compilador
 * @returns           BuildResult final (ok, rom_path, log completo)
 */
export async function buildProject(
  projectDir: string,
  onLog: (line: BuildLogLine) => void
): Promise<BuildResult> {
  // Escuta eventos de streaming antes de invocar o comando
  let unlisten: UnlistenFn | null = null;

  unlisten = await listen<BuildLogLine>("build://log", (event) => {
    onLog(event.payload);
  });

  try {
    const result = await invoke<BuildResult>("build_project", { projectDir });
    return result;
  } finally {
    if (unlisten) unlisten();
  }
}
