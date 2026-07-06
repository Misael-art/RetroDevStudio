import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildScriptUrl = pathToFileURL(path.join(repoRoot, "scripts", "build.mjs")).href;

function inspectBuildEnvironment(mode, hostPlatform, envOverrides = {}) {
  const code = `
    Object.assign(process.env, ${JSON.stringify(envOverrides)});
    const build = await import(${JSON.stringify(buildScriptUrl)});
    const env = build.buildCommandEnvironment(${JSON.stringify(mode)}, "C:/rds-target", ${JSON.stringify(hostPlatform)});
    console.log(JSON.stringify({
      exportedType: typeof build.buildCommandEnvironment,
      appBinaryLinux: build.appBinaryNameForPlatform("linux"),
      appBinaryWindows: build.appBinaryNameForPlatform("win32"),
      runtimeFilesLinux: build.runtimeFilesForProfile("debug", "linux").files,
      runtimeFilesWindows: build.runtimeFilesForProfile("debug", "win32").files,
      cargoTargetDir: env.CARGO_TARGET_DIR,
      tauriPlatform: env.TAURI_ENV_PLATFORM,
      tauriArch: env.TAURI_ENV_ARCH,
      tauriFamily: env.TAURI_ENV_FAMILY,
      tauriTargetTriple: env.TAURI_ENV_TARGET_TRIPLE,
      tauriDebug: env.TAURI_ENV_DEBUG,
      pathValue: env.Path ?? env.PATH,
    }));
  `;

  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
      cwd: repoRoot,
    })
  );
}

describe("build.mjs command environment", () => {
  it("marks only debug builds as Tauri debug builds on Windows", () => {
    expect(inspectBuildEnvironment("debug", "win32")).toMatchObject({
      exportedType: "function",
      cargoTargetDir: "C:/rds-target",
      tauriPlatform: "windows",
      tauriArch: "x86_64",
      tauriFamily: "windows",
      tauriTargetTriple: "x86_64-pc-windows-msvc",
      tauriDebug: "true",
    });

    expect(inspectBuildEnvironment("msi", "win32")).toMatchObject({
      exportedType: "function",
      cargoTargetDir: "C:/rds-target",
      tauriDebug: "false",
    });

    expect(inspectBuildEnvironment("portable", "win32")).toMatchObject({
      exportedType: "function",
      cargoTargetDir: "C:/rds-target",
      tauriDebug: "false",
    });
  });

  it("overrides stale Tauri target variables on Windows", () => {
    expect(
      inspectBuildEnvironment("portable", "win32", {
        TAURI_ENV_PLATFORM: "linux",
        TAURI_ENV_ARCH: "aarch64",
        TAURI_ENV_FAMILY: "unix",
        TAURI_ENV_TARGET_TRIPLE: "aarch64-unknown-linux-gnu",
        TAURI_ENV_DEBUG: "true",
      })
    ).toMatchObject({
      tauriPlatform: "windows",
      tauriArch: "x86_64",
      tauriFamily: "windows",
      tauriTargetTriple: "x86_64-pc-windows-msvc",
      tauriDebug: "false",
    });
  });

  it("does not inject Tauri target variables on non-Windows hosts", () => {
    const linuxEnv = inspectBuildEnvironment("debug", "linux");
    const macEnv = inspectBuildEnvironment("debug", "darwin");

    expect(linuxEnv).toMatchObject({
      exportedType: "function",
      cargoTargetDir: "C:/rds-target",
    });
    expect(linuxEnv.tauriPlatform).toBeUndefined();
    expect(macEnv.tauriDebug).toBeUndefined();
  });

  it("prepends the user Cargo bin to PATH on Windows", () => {
    const env = inspectBuildEnvironment("debug", "win32", {
      USERPROFILE: "C:\\Users\\tester",
      Path: "C:\\Windows\\System32",
    });

    expect(env.pathValue.split(";")[0]).toBe("C:\\Users\\tester\\.cargo\\bin");
  });

  it("uses platform-specific desktop artifact names", () => {
    const env = inspectBuildEnvironment("debug", "linux");

    expect(env.appBinaryLinux).toBe("retro-dev-studio");
    expect(env.runtimeFilesLinux).toEqual(["retro-dev-studio"]);
    expect(env.appBinaryWindows).toBe("retro-dev-studio.exe");
    expect(env.runtimeFilesWindows).toContain("retro-dev-studio.exe");
    expect(env.runtimeFilesWindows).toContain("app_lib.dll");
  });
});
