import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  HOST_READINESS_SCHEMA,
  acquireOperationLock,
  browserDriverCompatible,
  defaultManifestPath,
  detectHost,
  diagnose,
  ensure,
  ensurePortableArtifact,
  expandTokens,
  installSourceBuild,
  installRequirement,
  isSupportedHost,
  pacmanBatchPlan,
  privilegedPacmanCommand,
  probeRequirement,
  readManifest,
  resolveCommand,
  repoRoot,
  stableJson,
  validateManifest,
} from "./host-manager.mjs";

// Alguns casos escrevem fixtures "#!/bin/sh" e dependem de EXECUTAR esses
// arquivos para sondar versao. Isso so funciona em host POSIX: no Windows um
// arquivo sem extensao com shebang nao e executavel, a sonda retorna null e o
// requisito vira "missing". Simular `platform: linux` nao muda o host que roda
// o teste. Mesmo padrao de `scripts/linux-host-scripts.test.mjs`.
const posixIt = process.platform === "win32" ? it.skip : it;
// Estes fixtures sao executados diretamente por spawnSync. No runner Windows,
// arquivos de teste com shebang POSIX nao sao binarios executaveis; a cobertura
// operacional do caminho Windows permanece no desktop-smoke com as ferramentas
// reais do host.
const posixCommandFixtureIt = process.platform === "win32" ? it.skip : it;

const tempDirs = [];

function tempDir() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "rds-host-manager-"));
  tempDirs.push(directory);
  return directory;
}

function executable(directory, name, body = "#!/bin/sh\nexit 0\n") {
  mkdirSync(directory, { recursive: true });
  const target = path.join(directory, name);
  writeFileSync(target, body, "utf8");
  chmodSync(target, 0o755);
  return target;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe("host requirements contract", () => {
  it("accepts the tracked immutable lock", () => {
    const { manifest, lockDigest } = readManifest(defaultManifestPath);

    expect(validateManifest(manifest)).toEqual([]);
    expect(lockDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sources.sgdk.commit).toHaveLength(40);
    expect(manifest.sources.pvsneslib.commit).toHaveLength(40);
    const sgdk = manifest.requirements.find((requirement) => requirement.id === "sgdk");
    const configure = sgdk.install_by_platform.linux.steps.find((step) => step.label === "configure");
    expect(configure.args).toContain("-DCMAKE_BUILD_TYPE=RelWithDebInfo");
    expect(configure.args).not.toContain("-DCMAKE_BUILD_TYPE=Release");
    const gccConfigure = manifest.requirements
      .find((requirement) => requirement.id === "m68k_gcc")
      .install_by_platform.linux.steps.find((step) => step.label === "configure-gcc");
    expect(gccConfigure.args).toContain("--enable-lto");
    expect(gccConfigure.args).not.toContain("--disable-lto");
  });

  it("keeps operational upstream smokes mandatory in host certification", () => {
    const source = readFileSync(path.join(repoRoot, "scripts", "host-manager.mjs"), "utf8");

    expect(source).toContain('["scripts/validate-upstream-linux.sh", "--require-decomp-tools"]');
    expect(source).not.toContain('"scripts/validate-upstream-linux.sh", "--skip-rust-tests"');
    expect(source).not.toContain('"scripts\\\\validate-upstream-windows.ps1", "-SkipRustTests"');
  });

  it("rejects mutable artifacts and artifacts without sha256", () => {
    const manifest = JSON.parse(readFileSync(defaultManifestPath, "utf8"));
    manifest.artifacts = [{ id: "bad", url: "https://example.test/latest/tool.zip" }];

    expect(validateManifest(manifest)).toContain("artifact_url_invalid:bad");
    expect(validateManifest(manifest)).toContain("artifact_sha256_invalid:bad");
    expect(validateManifest(manifest)).toContain("artifact_size_invalid:bad");
  });

  it("rejects duplicate artifacts and dangling installer references", () => {
    const manifest = JSON.parse(readFileSync(defaultManifestPath, "utf8"));
    manifest.artifacts.push({ ...manifest.artifacts[0] });
    manifest.requirements[0].install = { kind: "artifact", artifact: "not-locked" };

    expect(validateManifest(manifest)).toContain(`artifact_duplicate:${manifest.artifacts[0].id}`);
    expect(validateManifest(manifest)).toContain("install_artifact_unknown:node:not-locked");
  });

  it("uses stable key ordering for lock digests", () => {
    expect(stableJson({ z: 1, a: { d: 2, b: 3 } })).toBe('{"a":{"b":3,"d":2},"z":1}');
  });

  it("rejects an unsupported platform in the supported-host declaration", () => {
    const manifest = JSON.parse(readFileSync(defaultManifestPath, "utf8"));
    manifest.supported_hosts.push({ platform: "darwin", arch: "arm64" });

    expect(validateManifest(manifest)).toContain("supported_host_invalid:darwin/arm64");
  });

  it("rejects a corrupt portable-cache artifact without a network fallback", () => {
    const sha256 = "0".repeat(64);
    const artifactPath = path.join(repoRoot, "toolchains", ".cache", "artifacts", sha256);
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, "corrupt", "utf8");
    try {
      expect(ensurePortableArtifact({ id: "corrupt", sha256, size: 7 }, { offline: true })).toMatchObject({
        ok: false,
        reason: "portable_cache_checksum_mismatch",
      });
    } finally {
      rmSync(artifactPath, { force: true });
    }
  });

  it("blocks offline when a verified portable artifact is absent", () => {
    const sha256 = createHash("sha256").update(`missing-${Date.now()}`).digest("hex");

    expect(ensurePortableArtifact({ id: "missing", sha256, size: 64 }, { offline: true })).toEqual({
      ok: false,
      reason: "offline_missing",
    });
  });

  it("reports insufficient portable-cache space before starting a download", () => {
    const sha256 = createHash("sha256").update(`space-${Date.now()}`).digest("hex");

    expect(
      ensurePortableArtifact(
        { id: "large", sha256, size: 1024 },
        { offline: false, statfs: () => ({ bavail: 0, bsize: 1 }) },
      ),
    ).toMatchObject({
      ok: false,
      reason: "insufficient_portable_cache_space",
      free_bytes: 0,
    });
  });

  it("serializes concurrent host mutations with an operation lock", () => {
    const directory = tempDir();
    const first = acquireOperationLock(directory);

    expect(first).not.toBeNull();
    expect(acquireOperationLock(directory)).toBeNull();
    first.release();
    expect(acquireOperationLock(directory)).not.toBeNull();
  });

  it("recovers an operation lock left by a dead process", () => {
    const directory = tempDir();
    const lockPath = path.join(directory, "operation.lock");
    mkdirSync(lockPath);
    writeFileSync(
      path.join(lockPath, "owner.json"),
      `${JSON.stringify({ pid: Number.MAX_SAFE_INTEGER, started_at: "2000-01-01T00:00:00.000Z" })}\n`,
    );

    const recovered = acquireOperationLock(directory);
    expect(recovered).not.toBeNull();
    expect(recovered.recovered_stale).toBe(true);
    recovered.release();
  });

  it("deduplicates Arch substrate packages into one privileged transaction", () => {
    const requirements = [
      { id: "first", install_by_platform: { linux: { kind: "pacman", packages: ["cmake", "make"] } } },
      { id: "second", install_by_platform: { linux: { kind: "pacman", packages: ["make", "bison"] } } },
      { id: "artifact", install_by_platform: { linux: { kind: "artifact", artifact: "fixture" } } },
    ];

    const plan = pacmanBatchPlan(requirements, { host: { platform: "linux" } });
    expect(plan.requirements.map((requirement) => requirement.id)).toEqual(["first", "second"]);
    expect(plan.packages).toEqual(["cmake", "make", "bison"]);
  });

  it("uses the BigLinux graphical privilege bridge when it is available", () => {
    const directory = tempDir();
    const executable = path.join(directory, "bigsudo");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const privilege = privilegedPacmanCommand({
      host: { platform: "linux", os_id: "biglinux" },
      env: { PATH: directory },
    });
    expect(privilege).toEqual({ program: "bigsudo", args: [] });
  });

  it("allows an explicit conservative privilege override", () => {
    const privilege = privilegedPacmanCommand({
      host: { platform: "linux", os_id: "manjaro" },
      env: { PATH: "", RDS_PRIVILEGE_COMMAND: "sudo" },
    });
    expect(privilege).toEqual({ program: "sudo", args: [] });
  });

  it("does not fabricate incompatibility when the browser version is unknown", () => {
    // Ausencia de observacao nao e evidencia de incompatibilidade. Antes, um host
    // onde a versao do navegador nao e detectavel (runner de CI, por exemplo)
    // marcava como `incompatible` um driver que funciona.
    const driver = {
      applicable: true,
      status: "ready",
      path: "C:/drivers/msedgedriver.exe",
      version: "MSEdgeDriver 140.0.4",
    };

    expect(browserDriverCompatible({ route: "browser" }, driver)).toBe(true);
    expect(browserDriverCompatible({ version: null, route: "browser" }, driver)).toBe(true);
    // Versao conhecida e divergente continua reprovando.
    expect(
      browserDriverCompatible({ version: "Microsoft Edge 139.0.1", route: "browser" }, driver)
    ).toBe(false);
  });

  it("rejects a browser and WebDriver with different major versions", () => {
    expect(
      browserDriverCompatible(
        { version: "Microsoft Edge 140.0.1", route: "browser" },
        {
          applicable: true,
          status: "ready",
          path: "C:/drivers/msedgedriver.exe",
          version: "MSEdgeDriver 139.0.4",
        }
      )
    ).toBe(false);
    expect(
      browserDriverCompatible(
        { version: "Microsoft Edge 140.0.1", route: "browser" },
        {
          applicable: true,
          status: "ready",
          path: "C:/drivers/msedgedriver.exe",
          version: "MSEdgeDriver 140.0.9",
        }
      )
    ).toBe(true);
  });

  it("accepts WebKitWebDriver only with the WebKit route", () => {
    const driver = {
      applicable: true,
      status: "ready",
      path: "/usr/bin/WebKitWebDriver",
      version: "Usage: WebKitWebDriver",
    };
    expect(browserDriverCompatible({ version: "WebKitGTK 2.50.6", route: "webkit" }, driver)).toBe(true);
    expect(browserDriverCompatible({ version: "Chromium 140.0.1", route: "browser" }, driver)).toBe(false);
  });

  it("resolves native commands through paths with spaces and accents", () => {
    const root = path.join(tempDir(), "Cartao SD", "Ferramentas acentuadas");
    const command = executable(root, "rds-tool");
    expect(
      resolveCommand(["rds-tool"], { platform: "linux" }, { PATH: root })
    ).toBe(command);
  });

  it("preserves and resumes a verified source build after an interrupted step", () => {
    const directory = tempDir();
    const packageRoot = path.join(directory, "package");
    const sourceRoot = path.join(packageRoot, "fixture-source");
    const archivePath = path.join(directory, "fixture.tar.gz");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(
      path.join(sourceRoot, "resume-step.mjs"),
      'import { existsSync, writeFileSync } from "node:fs";\n' +
        'if (!existsSync(".allow-resume")) { writeFileSync(".allow-resume", "ready\\n"); process.exit(7); }\n' +
        'writeFileSync("built.txt", "ok\\n");\n',
      "utf8",
    );
    const tar = spawnSync("tar", ["-czf", archivePath, "-C", packageRoot, "fixture-source"]);
    expect(tar.status).toBe(0);
    const archive = readFileSync(archivePath);
    const artifact = {
      id: "resume-source",
      platform: "all",
      version: "1.0.0",
      format: "tar.gz",
      sha256: createHash("sha256").update(archive).digest("hex"),
      size: statSync(archivePath).size,
      url: "https://example.test/resume-source.tar.gz",
    };
    const portablePath = path.join(repoRoot, "toolchains", ".cache", "artifacts", artifact.sha256);
    mkdirSync(path.dirname(portablePath), { recursive: true });
    writeFileSync(portablePath, archive);
    const hostCache = path.join(directory, "host-cache");
    const requirement = {
      id: "resume-fixture",
      install_by_platform: {
        linux: {
          kind: "source_build",
          artifacts: [artifact.id],
          steps: [{ label: "interrupt-once", program: process.execPath, args: ["resume-step.mjs"] }],
          target: "${hostCache}/toolchains/resume-fixture",
        },
      },
    };
    const context = {
      repo: repoRoot,
      hostCache,
      host: { platform: "linux", arch: "x64" },
      pathEnv: process.env.PATH,
      env: process.env,
      manifest: { artifacts: [artifact] },
    };
    try {
      const first = installSourceBuild(requirement, context, { offline: true });
      expect(first).toMatchObject({ ok: false, resumable: true, resumed: false, reason: "source_step_failed:interrupt-once" });
      expect(existsSync(first.log)).toBe(true);
      expect(existsSync(path.join(hostCache, "source-build-resume-fixture", "source", ".allow-resume"))).toBe(true);

      const second = installSourceBuild(requirement, context, { offline: true });
      expect(second).toMatchObject({ ok: true, resumed: true });
      expect(readFileSync(path.join(second.target, "built.txt"), "utf8")).toBe("ok\n");
      expect(existsSync(path.join(second.logs, "interrupt-once.log"))).toBe(true);
    } finally {
      rmSync(portablePath, { force: true });
    }
  });
});

describe("host detection and probes", () => {
  it("supports only the declared Windows and Arch-family x64 hosts", () => {
    const { manifest } = readManifest(defaultManifestPath);

    expect(isSupportedHost(manifest, detectHost({ RDS_HOST_TEST_PLATFORM: "linux", RDS_HOST_TEST_ARCH: "x64", RDS_HOST_TEST_OS_ID: "manjaro" }))).toBe(true);
    expect(isSupportedHost(manifest, detectHost({ RDS_HOST_TEST_PLATFORM: "linux", RDS_HOST_TEST_ARCH: "x64", RDS_HOST_TEST_OS_ID: "ubuntu" }))).toBe(false);
    expect(isSupportedHost(manifest, detectHost({ RDS_HOST_TEST_PLATFORM: "win32", RDS_HOST_TEST_ARCH: "arm64" }))).toBe(false);
  });

  it("expands canonical cache and core-extension tokens", () => {
    const context = { repo: "/repo", hostCache: "/cache", host: { platform: "linux" } };

    expect(expandTokens("${hostCache}/cores/core.${coreExt}", context)).toBe(path.normalize("/cache/cores/core.so"));
  });

  it("never accepts a Windows executable as a Linux command", () => {
    const directory = tempDir();
    executable(directory, "driver.exe");

    expect(resolveCommand(["driver.exe"], { platform: "linux" }, { RDS_HOST_TEST_PATH: directory, PATH: directory })).toBeNull();
  });

  it("finds native commands through the controlled PATH", () => {
    const directory = tempDir();
    const program = executable(directory, "native-tool");

    expect(resolveCommand(["native-tool"], { platform: "linux" }, { RDS_HOST_TEST_PATH: directory, PATH: directory })).toBe(program);
  });

  posixCommandFixtureIt("finds MSVC through vswhere when cl.exe is not on the ordinary PATH", () => {
    const directory = tempDir();
    const vswhere = executable(directory, "vswhere.exe", "#!/bin/sh\nprintf '%s\\n' \"$RDS_TEST_CL_PATH\"\n");
    const clPath = path.join(directory, "Visual Studio Build Tools", "VC", "Tools", "MSVC", "14.44", "bin", "Hostx64", "x64", "cl.exe");
    executable(path.dirname(clPath), "cl.exe", "#!/bin/sh\nprintf 'Microsoft (R) C/C++ Optimizing Compiler Version 19.44\\n'\n");

    const result = probeRequirement(
      { id: "msvc", label: "MSVC", probe: { kind: "command", names: ["cl.exe"], version_args: [] } },
      {
        repo: directory,
        hostCache: directory,
        host: { platform: "win32", arch: "x64" },
        pathEnv: directory,
        env: { PATH: directory, RDS_VSWHERE_PATH: vswhere, RDS_TEST_CL_PATH: clPath },
      },
    );

    expect(result).toMatchObject({ status: "ready", path: clPath, installed: true });
  });

  it("reports MSVC as missing when neither PATH nor Visual Studio discovery provides cl.exe", () => {
    const directory = tempDir();
    const result = probeRequirement(
      { id: "msvc", label: "MSVC", probe: { kind: "command", names: ["cl.exe"], version_args: [] } },
      {
        repo: directory,
        hostCache: directory,
        host: { platform: "win32", arch: "x64" },
        pathEnv: directory,
        env: { PATH: directory },
      },
    );

    expect(result).toMatchObject({ status: "missing", installed: false, compatible: false });
  });

  posixCommandFixtureIt("distinguishes WebView2 runtime registry presence from Edge browser presence", () => {
    const directory = tempDir();
    executable(directory, "reg.exe", "#!/bin/sh\nprintf '    pv    REG_SZ    %s\\n' \"$RDS_TEST_WEBVIEW2_VERSION\"\n");
    const requirement = {
      id: "webview2",
      label: "WebView2",
      probe: { kind: "webview2", registry_keys: ["HKCU\\Software\\RDS\\WebView2"], version_pattern: "^\\d+\\.\\d+\\.\\d+\\.\\d+$" },
    };
    const context = {
      repo: directory,
      hostCache: directory,
      host: { platform: "win32", arch: "x64" },
      pathEnv: directory,
      env: { PATH: directory, RDS_TEST_WEBVIEW2_VERSION: "140.0.1.2" },
    };

    expect(probeRequirement(requirement, context)).toMatchObject({ status: "ready", version: "140.0.1.2" });
    expect(probeRequirement(requirement, { ...context, env: { ...context.env, RDS_TEST_WEBVIEW2_VERSION: "not-a-runtime" } })).toMatchObject({ status: "incompatible" });
    expect(probeRequirement(requirement, { ...context, pathEnv: path.join(directory, "missing with spaces") })).toMatchObject({ status: "missing" });
  });

  posixCommandFixtureIt("installs the exact npm pin rather than accepting a compatible major", () => {
    const directory = tempDir();
    const npm = executable(directory, "npm.cmd", "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$RDS_NPM_ARGS\"\n");
    const result = installRequirement(
      { id: "npm", label: "npm", probe: { kind: "command" }, install_by_platform: { win32: { kind: "npm", version: "11.16.0" } } },
      { host: { platform: "win32", arch: "x64" }, hostCache: directory, pathEnv: directory, env: { PATH: directory, RDS_NPM_ARGS: path.join(directory, "args.txt") } },
      {},
    );
    expect(npm).toBeTruthy();
    expect(result.ok).toBe(true);
    expect(readFileSync(path.join(directory, "args.txt"), "utf8")).toContain("npm@11.16.0");
  });

  posixIt("prefers the pinned bootstrap Node and npm over incompatible host versions", () => {
    const directory = tempDir();
    const hostCache = path.join(directory, "cache");
    const bootstrapBin = path.join(hostCache, "bootstrap", "node-v24.18.0-linux-x64", "bin");
    executable(bootstrapBin, "node", "#!/bin/sh\nprintf 'v24.18.0\\n'\n");
    executable(bootstrapBin, "npm", "#!/bin/sh\nprintf '11.16.0\\n'\n");
    const incompatibleBin = path.join(directory, "system-bin");
    executable(incompatibleBin, "node", "#!/bin/sh\nprintf 'v99.0.0\\n'\n");
    executable(incompatibleBin, "npm", "#!/bin/sh\nprintf '99.0.0\\n'\n");
    const reportPath = path.join(directory, "report.json");

    const { report } = diagnose({
      reportPath,
      env: {
        ...process.env,
        PATH: `${incompatibleBin}${path.delimiter}${process.env.PATH}`,
        RDS_HOST_TEST_PLATFORM: "linux",
        RDS_HOST_TEST_ARCH: "x64",
        RDS_HOST_TEST_OS_ID: "manjaro",
        RDS_HOST_CACHE: hostCache,
      },
    });

    expect(report.checks.find((check) => check.id === "node")).toMatchObject({ status: "ready", version: "v24.18.0" });
    expect(report.checks.find((check) => check.id === "npm")).toMatchObject({ status: "ready", version: "11.16.0" });
  });

  it("marks a present core as incompatible when its individual hash drifts", () => {
    const directory = tempDir();
    const core = path.join(directory, "core.so");
    writeFileSync(core, "tampered", "utf8");
    const result = probeRequirement(
      {
        id: "core",
        label: "Core",
        probe: { kind: "file_any", candidates: [core], sha256_by_name: { "core.so": "0".repeat(64) } },
      },
      {
        repo: directory,
        hostCache: directory,
        host: { platform: "linux" },
        pathEnv: process.env.PATH,
        env: process.env,
      },
    );

    expect(result.status).toBe("incompatible");
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports unsupported hosts without probing or mutating them", () => {
    const directory = tempDir();
    const reportPath = path.join(directory, "report.json");
    const { report } = diagnose({
      reportPath,
      env: {
        ...process.env,
        RDS_HOST_TEST_PLATFORM: "linux",
        RDS_HOST_TEST_ARCH: "x64",
        RDS_HOST_TEST_OS_ID: "ubuntu",
        RDS_HOST_CACHE: path.join(directory, "cache"),
      },
    });

    expect(report.schema).toBe(HOST_READINESS_SCHEMA);
    expect(report.state).toBe("UNSUPPORTED");
    expect(report.checks).toEqual([]);
    expect(JSON.parse(readFileSync(reportPath, "utf8")).host_fingerprint).toBe(report.host_fingerprint);
  });

  posixIt("performs repeated READY ensures without repair actions", () => {
    const directory = tempDir();
    const bin = path.join(directory, "bin");
    executable(bin, "fixture", "#!/bin/sh\nprintf 'fixture 1.0.0\\n'\n");
    const manifestPath = path.join(directory, "requirements.json");
    const reportPath = path.join(directory, "report.json");
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        schema: "rds-host-requirements/v1",
        profile: "full",
        supported_hosts: [{ platform: "linux", arch: "x64", os_ids: ["manjaro"] }],
        pins: { node: "24.18.0" },
        sources: {},
        artifacts: [],
        requirements: [
          {
            id: "fixture",
            label: "Fixture",
            probe: { kind: "command", names: ["fixture"], version_args: ["--version"], version_pattern: "1\\.0\\.0" },
          },
        ],
      }, null, 2)}\n`,
    );
    const options = {
      manifestPath,
      reportPath,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        RDS_HOST_TEST_PLATFORM: "linux",
        RDS_HOST_TEST_ARCH: "x64",
        RDS_HOST_TEST_OS_ID: "manjaro",
        RDS_HOST_CACHE: path.join(directory, "cache"),
      },
    };

    const first = ensure(options);
    const second = ensure(options);
    expect(first.report).toMatchObject({ state: "READY", actions: [] });
    expect(second.report).toMatchObject({ state: "READY", actions: [] });
    expect(existsSync(path.join(directory, "cache", first.report.lock_digest, "operation-journal.json"))).toBe(false);
  });

  it("reports a live operation lock as a precise blocker", () => {
    const directory = tempDir();
    const manifestPath = path.join(directory, "requirements.json");
    const reportPath = path.join(directory, "report.json");
    const cache = path.join(directory, "cache");
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        schema: "rds-host-requirements/v1",
        profile: "full",
        supported_hosts: [{ platform: "linux", arch: "x64", os_ids: ["manjaro"] }],
        pins: { node: "24.18.0" },
        sources: {},
        artifacts: [],
        requirements: [{ id: "missing", label: "Missing", probe: { kind: "command", names: ["not-present-rds"] } }],
      }, null, 2)}\n`,
    );
    const liveLock = acquireOperationLock(cache);
    try {
      const result = ensure({
        manifestPath,
        reportPath,
        env: {
          ...process.env,
          RDS_HOST_TEST_PLATFORM: "linux",
          RDS_HOST_TEST_ARCH: "x64",
          RDS_HOST_TEST_OS_ID: "manjaro",
          RDS_HOST_CACHE: cache,
        },
      });
      expect(result.exitCode).toBe(21);
      expect(result.report).toMatchObject({ state: "BLOCKED" });
      expect(result.report.blockers).toContain("operation_lock:busy");
    } finally {
      liveLock.release();
    }
  });

  it("persists stale-lock recovery in both report and journal", () => {
    const directory = tempDir();
    const manifestPath = path.join(directory, "requirements.json");
    const reportPath = path.join(directory, "report.json");
    const cache = path.join(directory, "cache");
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        schema: "rds-host-requirements/v1",
        profile: "full",
        supported_hosts: [{ platform: "linux", arch: "x64", os_ids: ["manjaro"] }],
        pins: { node: "24.18.0" },
        sources: {},
        artifacts: [],
        requirements: [{ id: "missing", label: "Missing", probe: { kind: "command", names: ["not-present-rds"] } }],
      }, null, 2)}\n`,
    );
    const lockPath = path.join(cache, "operation.lock");
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(path.join(lockPath, "owner.json"), `${JSON.stringify({ pid: Number.MAX_SAFE_INTEGER })}\n`);
    const options = {
      manifestPath,
      reportPath,
      env: {
        ...process.env,
        RDS_HOST_TEST_PLATFORM: "linux",
        RDS_HOST_TEST_ARCH: "x64",
        RDS_HOST_TEST_OS_ID: "manjaro",
        RDS_HOST_CACHE: cache,
      },
    };

    const result = ensure(options);
    const journal = JSON.parse(readFileSync(path.join(cache, result.report.lock_digest, "operation-journal.json"), "utf8"));
    expect(result.report.actions).toContainEqual({ id: "operation_lock", ok: true, recovered_stale: true });
    expect(journal.actions).toContainEqual({ id: "operation_lock", ok: true, recovered_stale: true });
  });
});
