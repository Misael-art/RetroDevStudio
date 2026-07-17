#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HOST_REQUIREMENTS_SCHEMA = "rds-host-requirements/v1";
export const HOST_READINESS_SCHEMA = "rds-host-readiness/v1";
export const HOST_STATES = Object.freeze([
  "READY",
  "REPAIRED",
  "BLOCKED",
  "DRIFTED",
  "UNSUPPORTED",
]);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "..");
export const defaultManifestPath = path.join(repoRoot, "toolchains", "host-requirements.lock.json");
export const defaultReportPath = path.join(
  repoRoot,
  "src-tauri",
  "target-test",
  "validation",
  "host-readiness.json",
);

const EXIT = Object.freeze({ OK: 0, BLOCKED: 10, UNSUPPORTED: 11, INVALID: 12, BUSY: 21 });

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") return ["manifest_not_object"];
  if (manifest.schema !== HOST_REQUIREMENTS_SCHEMA) errors.push("schema_invalid");
  if (manifest.profile !== "full") errors.push("profile_invalid");
  if (!Array.isArray(manifest.supported_hosts) || manifest.supported_hosts.length === 0) {
    errors.push("supported_hosts_missing");
  }
  for (const host of manifest.supported_hosts ?? []) {
    if (!new Set(["linux", "win32"]).has(host.platform) || host.arch !== "x64") {
      errors.push(`supported_host_invalid:${host.platform ?? "unknown"}/${host.arch ?? "unknown"}`);
    }
  }
  if (!manifest.pins || typeof manifest.pins !== "object") errors.push("pins_missing");

  for (const [id, source] of Object.entries(manifest.sources ?? {})) {
    if (!/^https:\/\//.test(source.repository ?? "")) errors.push(`source_url_invalid:${id}`);
    if (!/^[0-9a-f]{40}$/.test(source.commit ?? "")) errors.push(`source_commit_invalid:${id}`);
    const immutableReference = source.tag ?? source.reference;
    if (!immutableReference || /latest/i.test(immutableReference)) errors.push(`source_reference_invalid:${id}`);
  }

  const artifactIds = new Set();
  for (const artifact of manifest.artifacts ?? []) {
    if (!artifact.id) errors.push("artifact_id_missing");
    else if (artifactIds.has(artifact.id)) errors.push(`artifact_duplicate:${artifact.id}`);
    else artifactIds.add(artifact.id);
    if (!/^https:\/\//.test(artifact.url ?? "") || /\/latest(?:\/|$)/i.test(artifact.url ?? "")) {
      errors.push(`artifact_url_invalid:${artifact.id ?? "unknown"}`);
    }
    if (!/^[0-9a-f]{64}$/.test(artifact.sha256 ?? "")) {
      errors.push(`artifact_sha256_invalid:${artifact.id ?? "unknown"}`);
    }
    if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
      errors.push(`artifact_size_invalid:${artifact.id ?? "unknown"}`);
    }
  }

  const ids = new Set();
  if (!Array.isArray(manifest.requirements) || manifest.requirements.length === 0) {
    errors.push("requirements_missing");
  }
  for (const requirement of manifest.requirements ?? []) {
    if (!requirement.id) errors.push("requirement_id_missing");
    else if (ids.has(requirement.id)) errors.push(`requirement_duplicate:${requirement.id}`);
    else ids.add(requirement.id);
    if (!requirement.label) errors.push(`requirement_label_missing:${requirement.id ?? "unknown"}`);
    if (!requirement.probe?.kind) errors.push(`requirement_probe_missing:${requirement.id ?? "unknown"}`);
    else if (!new Set(["command", "commands_all", "pkg_config_all", "path", "file_any"]).has(requirement.probe.kind)) {
      errors.push(`requirement_probe_unknown:${requirement.id}:${requirement.probe.kind}`);
    }
    const installs = [requirement.install, ...Object.values(requirement.install_by_platform ?? {})].filter(Boolean);
    for (const install of installs) {
      if (install.kind === "cargo" && !install.version) errors.push(`cargo_version_missing:${requirement.id}`);
      const referencedArtifacts = [
        install.artifact,
        ...Object.values(install.artifact_by_platform ?? {}),
        ...(install.artifacts ?? []),
        ...(install.overlays ?? []).map((overlay) => overlay.artifact),
      ].filter(Boolean);
      for (const artifactId of referencedArtifacts) {
        if (!artifactIds.has(artifactId)) errors.push(`install_artifact_unknown:${requirement.id}:${artifactId}`);
      }
    }
  }
  return errors;
}

export function readManifest(manifestPath = defaultManifestPath) {
  const raw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const errors = validateManifest(manifest);
  if (errors.length > 0) throw new Error(`host requirements lock invalido: ${errors.join(", ")}`);
  return { manifest, raw, lockDigest: sha256(stableJson(manifest)) };
}

function parseOsRelease(raw) {
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, "").toLowerCase();
  }
  return values;
}

function normalizeArch(arch) {
  if (arch === "x64" || arch === "amd64" || arch === "x86_64") return "x64";
  if (arch === "arm64" || arch === "aarch64") return "arm64";
  return arch;
}

export function detectHost(env = process.env) {
  const platform = env.RDS_HOST_TEST_PLATFORM || process.platform;
  const arch = normalizeArch(env.RDS_HOST_TEST_ARCH || process.arch);
  let osId = platform === "win32" ? "windows" : "unknown";
  let osVersion = os.release();
  if (platform === "linux") {
    if (env.RDS_HOST_TEST_OS_ID) {
      osId = env.RDS_HOST_TEST_OS_ID.toLowerCase();
      osVersion = env.RDS_HOST_TEST_OS_VERSION || osVersion;
    } else if (existsSync("/etc/os-release")) {
      const release = parseOsRelease(readFileSync("/etc/os-release", "utf8"));
      osId = release.ID || "unknown";
      osVersion = release.VERSION_ID || osVersion;
    }
  }
  const abi = platform === "linux" ? process.report?.getReport()?.header?.glibcVersionRuntime ?? "unknown" : "msvc";
  return { platform, arch, os_id: osId, os_version: osVersion, abi };
}

export function isSupportedHost(manifest, host) {
  return manifest.supported_hosts.some(
    (entry) =>
      entry.platform === host.platform &&
      entry.arch === host.arch &&
      (!entry.os_ids || entry.os_ids.includes(host.os_id)),
  );
}

export function nativeCacheBase(host, env = process.env) {
  if (env.RDS_HOST_CACHE) return path.resolve(env.RDS_HOST_CACHE);
  if (host.platform === "win32") {
    return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "RetroDevStudio", "cache");
  }
  return path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "retrodevstudio");
}

function executableExtensions(platform) {
  return platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
}

export function resolveCommand(names, host, env = process.env) {
  const searchPath = env.RDS_HOST_TEST_PATH ?? env.PATH ?? "";
  const pathEntries = searchPath.split(path.delimiter).filter(Boolean);
  const cargoBin = path.join(os.homedir(), ".cargo", "bin");
  if (!pathEntries.includes(cargoBin)) pathEntries.unshift(cargoBin);
  for (const name of names ?? []) {
    if (host.platform !== "win32" && /\.(?:exe|cmd|bat)$/i.test(name)) continue;
    if (path.isAbsolute(name) && existsSync(name)) return name;
    for (const entry of pathEntries) {
      for (const extension of executableExtensions(host.platform)) {
        const candidate = path.join(entry, name.endsWith(extension) ? name : `${name}${extension}`);
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      }
    }
  }
  return null;
}

function tokenValues(context) {
  return {
    repo: context.repo,
    hostCache: context.hostCache,
    coreExt: context.host.platform === "win32" ? "dll" : context.host.platform === "darwin" ? "dylib" : "so",
    exeExt: context.host.platform === "win32" ? ".exe" : "",
    cmdExt: context.host.platform === "win32" ? ".bat" : "",
    programFiles: context.env?.ProgramFiles || "C:/Program Files",
    programFilesX86: context.env?.["ProgramFiles(x86)"] || "C:/Program Files (x86)",
    source: context.source ?? "",
    jobs: context.jobs ?? "1",
  };
}

export function expandTokens(value, context) {
  let expanded = value;
  for (const [key, replacement] of Object.entries(tokenValues(context))) {
    expanded = expanded.replaceAll(`\${${key}}`, replacement);
  }
  return path.normalize(expanded);
}

function commandNames(probe, platform) {
  return probe.names_by_platform?.[platform] ?? probe.names ?? [];
}

function versionArgs(probe, platform) {
  return probe.version_args_by_platform?.[platform] ?? probe.version_args;
}

function requirementInstall(requirement, platform) {
  return requirement.install_by_platform?.[platform] ?? requirement.install ?? null;
}

function envProbeCandidates(probe, context) {
  const candidates = [];
  for (const envName of probe.env_candidates ?? []) {
    const value = context.env?.[envName];
    if (!value) continue;
    candidates.push(probe.env_suffix ? path.join(value, probe.env_suffix) : value);
  }
  return candidates.map((candidate) => expandTokens(candidate, context));
}

function runVersion(program, args, env) {
  const result = spawnSync(program, args ?? ["--version"], { encoding: "utf8", env, windowsHide: true });
  return {
    ok: result.status === 0,
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().split(/\r?\n/)[0] ?? "",
  };
}

function cargoInstalledVersion(packageName, env) {
  const cargoHome = env.CARGO_HOME || path.join(os.homedir(), ".cargo");
  const metadataPath = path.join(cargoHome, ".crates2.json");
  if (!existsSync(metadataPath)) return null;
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    const key = Object.keys(metadata.installs ?? {}).find((entry) => entry.startsWith(`${packageName} `));
    return key?.slice(packageName.length + 1).split(" ")[0] ?? null;
  } catch {
    return null;
  }
}

export function probeRequirement(requirement, context) {
  if (requirement.platforms && !requirement.platforms.includes(context.host.platform)) {
    return { id: requirement.id, label: requirement.label, applicable: false, status: "not_applicable" };
  }
  const probe = requirement.probe;
  const env = { ...(context.env ?? process.env), PATH: context.pathEnv };
  let detectedPath = null;
  let version = null;
  let installed = false;
  let detectedSha256 = null;
  let integrityCompatible = true;

  if (probe.kind === "command") {
    detectedPath = envProbeCandidates(probe, context).find((candidate) => existsSync(candidate)) ?? null;
    detectedPath ||= (probe.candidates ?? [])
      .map((candidate) => expandTokens(candidate, context))
      .find((candidate) => existsSync(candidate)) ?? null;
    detectedPath ||= resolveCommand(commandNames(probe, context.host.platform), context.host, env);
    if (detectedPath) {
      const args = versionArgs(probe, context.host.platform);
      if (probe.cargo_package) {
        version = cargoInstalledVersion(probe.cargo_package, env);
        installed = Boolean(version);
      } else if (Array.isArray(args) && args.length === 0) {
        installed = true;
      } else {
        const result = runVersion(detectedPath, args, env);
        installed = result.ok;
        version = result.output || null;
      }
    }
  } else if (probe.kind === "commands_all") {
    const programs = (probe.names ?? []).map((name) => resolveCommand([name], context.host, env));
    installed = programs.every(Boolean);
    detectedPath = programs.filter(Boolean).join(path.delimiter) || null;
    version = installed ? probe.names.join(",") : null;
  } else if (probe.kind === "pkg_config_all") {
    const pkgConfig = resolveCommand(["pkg-config"], context.host, env);
    const libraries = probe.libraries ?? [];
    installed = Boolean(pkgConfig) && libraries.every((library) => runVersion(pkgConfig, ["--exists", library], env).ok);
    detectedPath = pkgConfig;
    version = installed ? libraries.map((library) => runVersion(pkgConfig, ["--modversion", library], env).output).join(",") : null;
  } else if (probe.kind === "path") {
    const candidates = [
      ...envProbeCandidates(probe, context),
      ...(probe.candidates ?? []).map((candidate) => expandTokens(candidate, context)),
    ];
    const required = probe.required_by_platform?.[context.host.platform] ?? probe.required ?? [];
    detectedPath = candidates.find(
      (candidate) => existsSync(candidate) && required.every((item) => existsSync(path.join(candidate, item))),
    ) ?? null;
    installed = Boolean(detectedPath);
  } else if (probe.kind === "file_any") {
    const candidates = [
      ...envProbeCandidates(probe, context),
      ...(probe.candidates ?? []).map((candidate) => expandTokens(candidate, context)),
    ];
    detectedPath = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
    installed = Boolean(detectedPath);
    if (detectedPath && probe.sha256_by_name) {
      detectedSha256 = sha256File(detectedPath);
      integrityCompatible = probe.sha256_by_name[path.basename(detectedPath)] === detectedSha256;
    }
  }

  const compatible = installed && integrityCompatible && (!probe.version_pattern || new RegExp(probe.version_pattern, "i").test(version ?? ""));
  return {
    id: requirement.id,
    label: requirement.label,
    applicable: true,
    status: !installed ? "missing" : compatible ? "ready" : "incompatible",
    installed,
    compatible,
    path: detectedPath,
    version,
    sha256: detectedSha256,
    install_supported: Boolean(requirementInstall(requirement, context.host.platform)),
  };
}

function gitSnapshot(cwd) {
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  const branch = spawnSync("git", ["branch", "--show-current"], { cwd, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
  return {
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    branch: branch.status === 0 ? branch.stdout.trim() || null : null,
    dirty: status.status === 0 ? Boolean(status.stdout.trim()) : null,
  };
}

function determineState(checks, supported) {
  if (!supported) return "UNSUPPORTED";
  const applicable = checks.filter((check) => check.applicable);
  if (applicable.some((check) => check.status === "incompatible")) return "DRIFTED";
  if (applicable.some((check) => check.status === "missing")) return "BLOCKED";
  return "READY";
}

function browserIdentity(host, env) {
  const names = host.platform === "win32" ? ["msedge.exe", "chrome.exe"] : ["microsoft-edge", "microsoft-edge-stable", "google-chrome", "chromium"];
  const program = resolveCommand(names, host, env);
  if (!program) return null;
  const result = runVersion(program, ["--version"], env);
  if (!result.ok) return null;
  return { path: program, version: result.output || null };
}

function atomicWriteJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

export function diagnose(options = {}) {
  const { manifest, lockDigest } = readManifest(options.manifestPath);
  const host = detectHost(options.env);
  const hostCache = path.join(nativeCacheBase(host, options.env), lockDigest);
  const cargoBin = path.join(os.homedir(), ".cargo", "bin");
  const bootstrapNodeRoot = path.join(
    nativeCacheBase(host, options.env),
    "bootstrap",
    `node-v${manifest.pins.node}-${host.platform === "win32" ? "win" : "linux"}-x64`,
  );
  const bootstrapNodeBin = host.platform === "win32" ? bootstrapNodeRoot : path.join(bootstrapNodeRoot, "bin");
  const managedBins = [
    bootstrapNodeBin,
    path.join(hostCache, "toolchains", "m68k-elf", "bin"),
    path.join(hostCache, "toolchains", "sgdk", "bin"),
    path.join(hostCache, "toolchains", "pvsneslib", "devkitsnes", "bin"),
    path.join(hostCache, "toolchains", "jdk", "bin"),
    path.join(hostCache, "toolchains", "ghidra", "support"),
  ];
  const pathEnv = [...managedBins, cargoBin, options.env?.PATH ?? process.env.PATH ?? ""].filter(Boolean).join(path.delimiter);
  const context = { repo: repoRoot, host, hostCache, pathEnv, env: options.env ?? process.env, manifest };
  const supported = isSupportedHost(manifest, host);
  const checks = supported ? manifest.requirements.map((requirement) => probeRequirement(requirement, context)) : [];
  const browser = browserIdentity(host, { ...(options.env ?? process.env), PATH: pathEnv });
  const fingerprintPayload = { host, lock_digest: lockDigest, browser: browser?.version ?? null };
  const report = {
    schema: HOST_READINESS_SCHEMA,
    generated_at: new Date().toISOString(),
    mode: options.mode ?? "diagnose",
    profile: manifest.profile,
    state: determineState(checks, supported),
    host,
    host_fingerprint: sha256(stableJson(fingerprintPayload)),
    lock_digest: lockDigest,
    repository: gitSnapshot(repoRoot),
    paths: {
      repo: repoRoot,
      native_cache: hostCache,
      active_pointer: path.join(nativeCacheBase(host, options.env), "active-host.json"),
      portable_cache: path.join(repoRoot, "toolchains", ".cache", "artifacts"),
      report: options.reportPath ?? defaultReportPath,
    },
    browser,
    checks,
    actions: options.actions ?? [],
    gates: options.gates ?? [],
    blockers: supported
      ? checks.filter((check) => check.applicable && check.status !== "ready").map((check) => `${check.id}:${check.status}`)
      : [`unsupported_host:${host.platform}/${host.arch}/${host.os_id}`],
    restart_required: false,
  };
  if (supported) {
    atomicWriteJson(report.paths.active_pointer, {
      schema: "rds-active-host/v1",
      lock_digest: lockDigest,
      host_fingerprint: report.host_fingerprint,
      native_cache: hostCache,
      updated_at: report.generated_at,
    });
  }
  atomicWriteJson(options.reportPath ?? defaultReportPath, report);
  return { report, manifest, context };
}

function commandResult(label, program, args, options = {}) {
  const startedAt = new Date().toISOString();
  let logDescriptor = null;
  if (options.logPath) {
    mkdirSync(path.dirname(options.logPath), { recursive: true });
    writeFileSync(
      options.logPath,
      `\n[${startedAt}] ${label}: ${program} ${args.join(" ")}\n`,
      { encoding: "utf8", flag: "a" },
    );
    logDescriptor = openSync(options.logPath, "a");
  }
  const result = spawnSync(program, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: logDescriptor === null ? (options.inherit ? "inherit" : "pipe") : ["ignore", logDescriptor, logDescriptor],
    windowsHide: true,
  });
  if (logDescriptor !== null) closeSync(logDescriptor);
  return {
    label,
    program,
    args,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    exit_code: result.status,
    ok: result.status === 0,
    error: result.error?.message ?? null,
    log: options.logPath ?? null,
  };
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = openSync(filePath, "r");
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function artifactForInstall(install, context) {
  const artifactId = install.artifact_by_platform?.[context.host.platform] ?? install.artifact;
  return context.manifest.artifacts.find(
    (artifact) =>
      artifact.id === artifactId &&
      artifact.arch === context.host.arch &&
      (artifact.platform === context.host.platform || artifact.platform === "all"),
  );
}

export function ensurePortableArtifact(artifact, options) {
  const portableCache = path.join(repoRoot, "toolchains", ".cache", "artifacts");
  const archivePath = path.join(portableCache, artifact.sha256);
  mkdirSync(portableCache, { recursive: true });
  if (!existsSync(archivePath)) {
    if (options.offline) return { ok: false, reason: "offline_missing" };
    const filesystem = (options.statfs ?? statfsSync)(portableCache);
    const freeBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
    if (freeBytes < Math.ceil(artifact.size * 1.1)) {
      return {
        ok: false,
        reason: "insufficient_portable_cache_space",
        required_bytes: Math.ceil(artifact.size * 1.1),
        free_bytes: freeBytes,
      };
    }
    const staged = `${archivePath}.part`;
    const download = commandResult(
      `download:${artifact.id}`,
      "curl",
      ["--fail", "--location", "--connect-timeout", "20", "--max-time", "1800", "--retry", "3", "--retry-all-errors", "--continue-at", "-", "--output", staged, artifact.url],
      { inherit: true },
    );
    if (!download.ok) return download;
    if (sha256File(staged) !== artifact.sha256) {
      rmSync(staged, { force: true });
      return { ok: false, reason: "artifact_checksum_mismatch" };
    }
    renameSync(staged, archivePath);
  }
  if (sha256File(archivePath) !== artifact.sha256) return { ok: false, reason: "portable_cache_checksum_mismatch" };
  return { ok: true, archivePath };
}

function artifactInstallMarker(target) {
  const markerPath = path.join(target, ".rds-install.json");
  if (!existsSync(markerPath)) return null;
  try {
    return JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    return null;
  }
}

function artifactInstallMatches(target, artifact) {
  const marker = artifactInstallMarker(target);
  return marker?.schema === "rds-host-install/v1" && marker.artifact === artifact.id && marker.sha256 === artifact.sha256;
}

function createDirectoryAlias(target, source, context) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  if (context.host.platform === "win32") {
    const result = commandResult(`link:${path.basename(target)}`, "cmd.exe", ["/d", "/s", "/c", "mklink", "/J", target, source]);
    return result.ok ? { ok: true } : result;
  }
  symlinkSync(source, target, "dir");
  return { ok: true };
}

function findReusableArtifactInstall(target, artifact, context) {
  const cacheBase = nativeCacheBase(context.host, context.env);
  const relativeTarget = path.relative(context.hostCache, target);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget) || !existsSync(cacheBase)) return null;
  for (const entry of readdirSync(cacheBase, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === path.basename(context.hostCache) || entry.name === "objects") continue;
    const candidate = path.join(cacheBase, entry.name, relativeTarget);
    if (existsSync(candidate) && artifactInstallMatches(candidate, artifact)) return candidate;
  }
  return null;
}

function extractArtifact(artifact, archivePath, target, context) {
  const staging = `${target}.tmp-${process.pid}`;
  const extractRoot = path.join(staging, "extract");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(extractRoot, { recursive: true });
  let result;
  if (artifact.format === "tar.gz") {
    result = commandResult(`extract:${artifact.id}`, "tar", ["-xzf", archivePath, "-C", extractRoot]);
  } else if (artifact.format === "tar.xz") {
    result = commandResult(`extract:${artifact.id}`, "tar", ["-xJf", archivePath, "-C", extractRoot]);
  } else if (artifact.format === "zip" && context.host.platform === "win32") {
    result = commandResult(
      `extract:${artifact.id}`,
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:RDS_ARCHIVE -DestinationPath $env:RDS_EXTRACT_ROOT -Force",
      ],
      { env: { ...process.env, RDS_ARCHIVE: archivePath, RDS_EXTRACT_ROOT: extractRoot } },
    );
  } else if (artifact.format === "zip") {
    result = commandResult(`extract:${artifact.id}`, "unzip", ["-q", archivePath, "-d", extractRoot]);
  } else {
    return { ok: false, reason: `artifact_format_unsupported:${artifact.format}` };
  }
  if (!result.ok) {
    rmSync(staging, { recursive: true, force: true });
    return result;
  }
  const entries = readdirSync(extractRoot, { withFileTypes: true }).filter((entry) => entry.name !== "__MACOSX");
  const source = entries.length === 1 && entries[0].isDirectory() ? path.join(extractRoot, entries[0].name) : extractRoot;
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  renameSync(source, target);
  rmSync(staging, { recursive: true, force: true });
  return { ok: true };
}

function installArtifact(requirement, context, options) {
  const install = requirementInstall(requirement, context.host.platform);
  const artifact = artifactForInstall(install, context);
  if (!artifact) return { id: requirement.id, ok: false, reason: "artifact_not_locked_for_host" };
  const portable = ensurePortableArtifact(artifact, options);
  if (!portable.ok) return { id: requirement.id, ...portable };
  const target = expandTokens(install.target, context);
  const objectTarget = path.join(nativeCacheBase(context.host, context.env), "objects", artifact.sha256);
  if (!artifactInstallMatches(objectTarget, artifact)) {
    rmSync(objectTarget, { recursive: true, force: true });
    const reusable = findReusableArtifactInstall(target, artifact, context);
    if (reusable && !lstatSync(reusable).isSymbolicLink()) {
      mkdirSync(path.dirname(objectTarget), { recursive: true });
      renameSync(reusable, objectTarget);
      const restoredAlias = createDirectoryAlias(reusable, objectTarget, context);
      if (!restoredAlias.ok) return { id: requirement.id, ...restoredAlias };
    } else {
      const extracted = extractArtifact(artifact, portable.archivePath, objectTarget, context);
      if (!extracted.ok) return { id: requirement.id, ...extracted };
    }
  }
  if (context.host.platform !== "win32") {
    for (const executable of install.executables ?? []) {
      const executablePath = path.join(objectTarget, executable);
      if (existsSync(executablePath)) chmodSync(executablePath, 0o755);
    }
  }
  writeFileSync(
    path.join(objectTarget, ".rds-install.json"),
    `${JSON.stringify({ schema: "rds-host-install/v1", id: requirement.id, artifact: artifact.id, version: artifact.version, sha256: artifact.sha256 }, null, 2)}\n`,
  );
  if (path.resolve(target) !== path.resolve(objectTarget)) {
    const linked = createDirectoryAlias(target, objectTarget, context);
    if (!linked.ok) return { id: requirement.id, ...linked };
  }
  return { id: requirement.id, ok: true, artifact: artifact.id, version: artifact.version, target };
}

function installArtifactFiles(requirement, context, options) {
  const install = requirementInstall(requirement, context.host.platform);
  const artifact = artifactForInstall(install, context);
  if (!artifact) return { id: requirement.id, ok: false, reason: "artifact_not_locked_for_host" };
  const portable = ensurePortableArtifact(artifact, options);
  if (!portable.ok) return { id: requirement.id, ...portable };
  const archivePath = portable.archivePath;
  const files = install.files_by_platform?.[context.host.platform] ?? [];
  if (files.length === 0) return { id: requirement.id, ok: false, reason: "artifact_files_missing" };
  const target = expandTokens(install.target, context);
  const markerPath = path.join(target, `.rds-install-${requirement.id}.json`);
  const expectedHashes = install.file_sha256_by_platform?.[context.host.platform] ?? {};
  if (existsSync(markerPath)) {
    try {
      const marker = JSON.parse(readFileSync(markerPath, "utf8"));
      const expectedFiles = files.map((item) => path.basename(item));
      if (
        marker.schema === "rds-host-install/v1" &&
        marker.artifact === artifact.id &&
        marker.sha256 === artifact.sha256 &&
        expectedFiles.every((file) =>
          marker.files?.includes(file) &&
          existsSync(path.join(target, file)) &&
          expectedHashes[file] &&
          sha256File(path.join(target, file)) === expectedHashes[file],
        )
      ) {
        return { id: requirement.id, ok: true, reused: true, artifact: artifact.id, version: artifact.version, target };
      }
    } catch {
      // Invalid markers are replaced only after a verified extraction succeeds.
    }
  }
  const relativeTarget = path.relative(context.hostCache, target);
  const cacheBase = nativeCacheBase(context.host, context.env);
  if (!relativeTarget.startsWith("..") && !path.isAbsolute(relativeTarget) && existsSync(cacheBase)) {
    for (const entry of readdirSync(cacheBase, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === path.basename(context.hostCache) || entry.name === "objects") continue;
      const candidateRoot = path.join(cacheBase, entry.name, relativeTarget);
      const reusable = files.every((item) => {
        const name = path.basename(item);
        const candidate = path.join(candidateRoot, name);
        return existsSync(candidate) && expectedHashes[name] && sha256File(candidate) === expectedHashes[name];
      });
      if (!reusable) continue;
      mkdirSync(target, { recursive: true });
      for (const item of files) copyFileSync(path.join(candidateRoot, path.basename(item)), path.join(target, path.basename(item)));
      atomicWriteJson(markerPath, {
        schema: "rds-host-install/v1",
        id: requirement.id,
        artifact: artifact.id,
        version: artifact.version,
        sha256: artifact.sha256,
        files: files.map((item) => path.basename(item)),
      });
      return { id: requirement.id, ok: true, reused: true, artifact: artifact.id, version: artifact.version, target };
    }
  }
  const staging = path.join(context.hostCache, `extract-${requirement.id}-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const sevenZip =
    resolveCommand(["7z", "7z.exe"], context.host, context.env) ??
    (context.host.platform === "win32" ? "C:\\Program Files\\7-Zip\\7z.exe" : "7z");
  const extracted = commandResult(
    `extract:${artifact.id}`,
    sevenZip,
    ["e", "-y", `-o${staging}`, archivePath, ...files],
    { inherit: true },
  );
  if (!extracted.ok) {
    rmSync(staging, { recursive: true, force: true });
    return { id: requirement.id, ...extracted };
  }
  mkdirSync(target, { recursive: true });
  for (const sourcePath of files) {
    const name = path.basename(sourcePath);
    const source = path.join(staging, name);
    if (!existsSync(source)) {
      rmSync(staging, { recursive: true, force: true });
      return { id: requirement.id, ok: false, reason: `artifact_member_missing:${name}` };
    }
    if (!expectedHashes[name] || sha256File(source) !== expectedHashes[name]) {
      rmSync(staging, { recursive: true, force: true });
      return { id: requirement.id, ok: false, reason: `artifact_member_checksum_mismatch:${name}` };
    }
    const stagedTarget = path.join(target, `${name}.tmp-${process.pid}`);
    copyFileSync(source, stagedTarget);
    renameSync(stagedTarget, path.join(target, name));
  }
  rmSync(staging, { recursive: true, force: true });
  writeFileSync(
    markerPath,
    `${JSON.stringify({ schema: "rds-host-install/v1", id: requirement.id, artifact: artifact.id, version: artifact.version, sha256: artifact.sha256, files: files.map((item) => path.basename(item)) }, null, 2)}\n`,
  );
  return { id: requirement.id, ok: true, artifact: artifact.id, version: artifact.version, target };
}

export function installSourceBuild(requirement, context, options) {
  const install = requirementInstall(requirement, context.host.platform);
  const artifactsById = new Map(context.manifest.artifacts.map((artifact) => [artifact.id, artifact]));
  const primary = artifactsById.get(install.artifacts?.[0]);
  if (!primary) return { id: requirement.id, ok: false, reason: "source_primary_artifact_missing" };
  const allArtifacts = [primary, ...(install.overlays ?? []).map((overlay) => artifactsById.get(overlay.artifact))];
  for (const artifact of allArtifacts) {
    if (!artifact || artifact.platform !== "all") return { id: requirement.id, ok: false, reason: "source_artifact_invalid" };
  }
  if (install.minimum_free_bytes) {
    mkdirSync(context.hostCache, { recursive: true });
    const filesystem = (options.statfs ?? statfsSync)(context.hostCache);
    const freeBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
    if (freeBytes < install.minimum_free_bytes) {
      return {
        id: requirement.id,
        ok: false,
        reason: "insufficient_native_cache_space",
        required_bytes: install.minimum_free_bytes,
        free_bytes: freeBytes,
      };
    }
  }
  const portableArtifacts = new Map();
  for (const artifact of allArtifacts) {
    const portable = ensurePortableArtifact(artifact, options);
    if (!portable.ok) return { id: requirement.id, artifact: artifact.id, ...portable };
    portableArtifacts.set(artifact.id, portable.archivePath);
  }

  const staging = path.join(context.hostCache, `source-build-${requirement.id}`);
  const source = path.join(staging, "source");
  const stagingMarkerPath = path.join(staging, ".rds-source-staging.json");
  const artifactIdentity = allArtifacts.map((artifact) => ({ id: artifact.id, sha256: artifact.sha256 }));
  let resumed = false;
  if (existsSync(stagingMarkerPath) && existsSync(source)) {
    try {
      const marker = JSON.parse(readFileSync(stagingMarkerPath, "utf8"));
      resumed =
        marker.schema === "rds-host-source-staging/v1" &&
        marker.id === requirement.id &&
        stableJson(marker.artifacts) === stableJson(artifactIdentity);
    } catch {
      resumed = false;
    }
  }
  if (!resumed) {
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    const primaryExtract = extractArtifact(primary, portableArtifacts.get(primary.id), source, context);
    if (!primaryExtract.ok) return { id: requirement.id, ...primaryExtract };
    for (const overlay of install.overlays ?? []) {
      const overlayArtifact = artifactsById.get(overlay.artifact);
      const destination = path.join(source, overlay.target);
      const overlayExtract = extractArtifact(overlayArtifact, portableArtifacts.get(overlay.artifact), destination, context);
      if (!overlayExtract.ok) {
        rmSync(staging, { recursive: true, force: true });
        return { id: requirement.id, ...overlayExtract };
      }
    }
    atomicWriteJson(stagingMarkerPath, {
      schema: "rds-host-source-staging/v1",
      id: requirement.id,
      artifacts: artifactIdentity,
      prepared_at: new Date().toISOString(),
    });
  }

  const buildContext = { ...context, source, jobs: String(Math.max(1, Math.min(os.cpus().length, 8))) };
  const env = { ...process.env, PATH: context.pathEnv };
  const logsDirectory = path.join(staging, "logs");
  for (const [name, value] of Object.entries(install.env ?? {})) env[name] = expandTokens(value, buildContext);
  const prependedPath = (install.path_prepend ?? []).map((value) => expandTokens(value, buildContext));
  if (prependedPath.length > 0) env.PATH = [...prependedPath, env.PATH].join(path.delimiter);
  for (const step of install.steps ?? []) {
    const program = expandTokens(step.program, buildContext);
    const args = (step.args ?? []).map((arg) => expandTokens(arg, buildContext));
    const cwd = expandTokens(step.cwd ?? "${source}", buildContext);
    const safeStepLabel = step.label.replace(/[^a-zA-Z0-9._-]/g, "_");
    const logPath = path.join(logsDirectory, `${safeStepLabel}.log`);
    const result = commandResult(`build:${requirement.id}:${step.label}`, program, args, { cwd, env, logPath });
    if (!result.ok) {
      return {
        id: requirement.id,
        ...result,
        reason: `source_step_failed:${step.label}`,
        resumable: true,
        resumed,
        staging,
      };
    }
  }
  const target = expandTokens(install.target, context);
  mkdirSync(path.dirname(target), { recursive: true });
  const promotedTarget = `${target}.tmp-${process.pid}`;
  const previousTarget = `${target}.previous`;
  rmSync(promotedTarget, { recursive: true, force: true });
  rmSync(previousTarget, { recursive: true, force: true });
  renameSync(install.output ? path.join(source, install.output) : source, promotedTarget);
  if (existsSync(target)) renameSync(target, previousTarget);
  try {
    renameSync(promotedTarget, target);
  } catch (error) {
    if (existsSync(previousTarget) && !existsSync(target)) renameSync(previousTarget, target);
    throw error;
  }
  rmSync(previousTarget, { recursive: true, force: true });
  const installedLogsDirectory = path.join(target, ".rds-build-logs");
  rmSync(installedLogsDirectory, { recursive: true, force: true });
  if (existsSync(logsDirectory)) renameSync(logsDirectory, installedLogsDirectory);
  rmSync(staging, { recursive: true, force: true });
  atomicWriteJson(path.join(target, ".rds-source-build.json"), {
    schema: "rds-host-source-build/v1",
    id: requirement.id,
    artifacts: artifactIdentity,
  });
  return {
    id: requirement.id,
    ok: true,
    source_build: true,
    resumed,
    target,
    logs: path.join(target, ".rds-build-logs"),
  };
}

function installRequirement(requirement, context, options) {
  const install = requirementInstall(requirement, context.host.platform);
  if (!install) return { id: requirement.id, ok: false, skipped: true, reason: "installer_not_defined" };
  if (options.dryRun) return { id: requirement.id, ok: true, dry_run: true, install };
  if (install.kind === "artifact") return installArtifact(requirement, context, options);
  if (install.kind === "artifact_files") return installArtifactFiles(requirement, context, options);
  if (install.kind === "source_build") return installSourceBuild(requirement, context, options);
  if (options.offline) return { id: requirement.id, ok: false, skipped: true, reason: "offline_missing" };
  const env = { ...process.env, PATH: context.pathEnv, CARGO_TARGET_DIR: path.join(context.hostCache, "cargo-install-target") };
  if (install.kind === "pacman") {
    return {
      id: requirement.id,
      ...commandResult(
        `install:${requirement.id}`,
        "sudo",
        ["pacman", "-S", "--needed", "--noconfirm", ...install.packages],
        { env, inherit: true },
      ),
    };
  }
  if (install.kind === "cargo") {
    const cargo = resolveCommand(["cargo"], context.host, env) ?? "cargo";
    return {
      id: requirement.id,
      ...commandResult(
        `install:${requirement.id}`,
        cargo,
        ["install", install.crate, "--version", install.version, "--locked"],
        { env, inherit: true },
      ),
    };
  }
  if (install.kind === "winget") {
    const args = [
      "install",
      "--id",
      install.id,
      "--exact",
      "--accept-source-agreements",
      "--accept-package-agreements",
      "--silent",
    ];
    if (install.override) args.push("--override", install.override);
    return {
      id: requirement.id,
      ...commandResult(`install:${requirement.id}`, "winget", args, { env, inherit: true }),
    };
  }
  return { id: requirement.id, ok: false, skipped: true, reason: `installer_unknown:${install.kind}` };
}

export function pacmanBatchPlan(requirements, context) {
  const selected = requirements.filter((requirement) => {
    const install = requirementInstall(requirement, context.host.platform);
    return install?.kind === "pacman";
  });
  return {
    requirements: selected,
    packages: [...new Set(selected.flatMap((requirement) => requirementInstall(requirement, context.host.platform).packages ?? []))],
  };
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function operationLockIsStale(lockPath) {
  const ownerPath = path.join(lockPath, "owner.json");
  try {
    const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    return !processIsAlive(owner.pid);
  } catch {
    try {
      return Date.now() - statSync(lockPath).mtimeMs > 5 * 60 * 1000;
    } catch {
      return true;
    }
  }
}

export function acquireOperationLock(hostCache) {
  mkdirSync(hostCache, { recursive: true });
  const lockPath = path.join(hostCache, "operation.lock");
  let recoveredStale = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(lockPath);
      writeFileSync(
        path.join(lockPath, "owner.json"),
        `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`,
      );
      return {
        lockPath,
        recovered_stale: recoveredStale,
        release: () => rmSync(lockPath, { recursive: true, force: true }),
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (attempt === 0 && operationLockIsStale(lockPath)) {
        rmSync(lockPath, { recursive: true, force: true });
        recoveredStale = true;
        continue;
      }
      return null;
    }
  }
  return null;
}

export function ensure(options = {}) {
  const initial = diagnose({ ...options, mode: "ensure" });
  if (initial.report.state === "UNSUPPORTED") return { report: initial.report, exitCode: EXIT.UNSUPPORTED };
  if (initial.report.state === "READY") return { report: initial.report, exitCode: EXIT.OK };
  const operation = acquireOperationLock(nativeCacheBase(initial.context.host, initial.context.env));
  if (!operation) {
    initial.report.state = "BLOCKED";
    initial.report.blockers.push("operation_lock:busy");
    atomicWriteJson(options.reportPath ?? defaultReportPath, initial.report);
    return { report: initial.report, exitCode: EXIT.BUSY };
  }
  const actions = [];
  try {
    const checksById = new Map(initial.report.checks.map((check) => [check.id, check]));
    const pending = initial.manifest.requirements.filter((requirement) => {
      const check = checksById.get(requirement.id);
      return check?.applicable && check.status !== "ready" && requirementInstall(requirement, initial.context.host.platform);
    });
    const pacmanBatch = pacmanBatchPlan(pending, initial.context);
    if (pacmanBatch.requirements.length > 0) {
      let batchResult;
      if (options.offline) {
        batchResult = { ok: false, skipped: true, reason: "offline_system_package_missing" };
      } else {
        const result = commandResult(
          "install:pacman-substrate",
          "sudo",
          ["pacman", "-S", "--needed", "--noconfirm", ...pacmanBatch.packages],
          { env: { ...initial.context.env, PATH: initial.context.pathEnv }, inherit: true },
        );
        batchResult = {
          ...result,
          reason: result.ok ? null : "sudo_denied_or_system_package_install_failed",
        };
      }
      for (const requirement of pacmanBatch.requirements) {
        actions.push({ id: requirement.id, batched: true, packages: pacmanBatch.packages, ...batchResult });
      }
      atomicWriteJson(path.join(initial.context.hostCache, "operation-journal.json"), {
        schema: "rds-host-operation-journal/v1",
        lock_digest: initial.report.lock_digest,
        updated_at: new Date().toISOString(),
        actions,
      });
    }
    for (const requirement of pending) {
      if (requirementInstall(requirement, initial.context.host.platform)?.kind === "pacman") continue;
      let action;
      try {
        action = installRequirement(requirement, initial.context, options);
      } catch (error) {
        action = { id: requirement.id, ok: false, reason: "installer_exception", error: error.message };
      }
      actions.push(action);
      atomicWriteJson(path.join(initial.context.hostCache, "operation-journal.json"), {
        schema: "rds-host-operation-journal/v1",
        lock_digest: initial.report.lock_digest,
        updated_at: new Date().toISOString(),
        actions,
      });
    }
    if (operation.recovered_stale) {
      actions.unshift({ id: "operation_lock", ok: true, recovered_stale: true });
    }
    atomicWriteJson(path.join(initial.context.hostCache, "operation-journal.json"), {
      schema: "rds-host-operation-journal/v1",
      lock_digest: initial.report.lock_digest,
      updated_at: new Date().toISOString(),
      actions,
    });
  } finally {
    operation.release();
  }
  const final = diagnose({ ...options, mode: "ensure", actions });
  if (final.report.state === "READY" && actions.some((action) => action.ok && !action.dry_run)) {
    final.report.state = "REPAIRED";
    atomicWriteJson(options.reportPath ?? defaultReportPath, final.report);
  }
  return {
    report: final.report,
    exitCode: final.report.state === "READY" || final.report.state === "REPAIRED" ? EXIT.OK : EXIT.BLOCKED,
  };
}

function certificationCommands(platform) {
  const baseline = [
    ["check:tree", "npm", ["run", "check:tree"]],
    ["lint", "npm", ["run", "lint"]],
    ["typescript", "npx", ["tsc", "--noEmit"]],
    ["frontend-tests", "npm", ["test"]],
  ];
  if (platform === "win32") {
    baseline.push(
      ["rust-clippy", path.join(repoRoot, "scripts", "run-cargo-msvc.cmd"), ["clippy", "--manifest-path", ".\\src-tauri\\Cargo.toml", "--", "-D", "warnings"]],
      ["rust-tests", path.join(repoRoot, "scripts", "run-cargo-msvc.cmd"), ["test", "--manifest-path", ".\\src-tauri\\Cargo.toml", "--lib", "--", "--nocapture", "--test-threads=1"]],
      ["upstream", "powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\\validate-upstream-windows.ps1", "-SkipRustTests"]],
    );
  } else {
    baseline.push(
      ["rust-clippy", "cargo", ["clippy", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "--", "-D", "warnings"]],
      ["rust-tests", "cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "--", "--nocapture", "--test-threads=1"]],
      ["upstream", "bash", ["scripts/validate-upstream-linux.sh", "--skip-rust-tests", "--require-decomp-tools"]],
    );
  }
  return baseline;
}

export function certify(options = {}) {
  const initial = diagnose({ ...options, mode: "certify" });
  if (initial.report.state !== "READY") {
    return { report: initial.report, exitCode: initial.report.state === "UNSUPPORTED" ? EXIT.UNSUPPORTED : EXIT.BLOCKED };
  }
  const env = {
    ...process.env,
    PATH: initial.context.pathEnv,
    CARGO_TARGET_DIR: path.join(initial.context.hostCache, "cargo-target"),
  };
  const gates = [];
  for (const [label, program, args] of certificationCommands(initial.context.host.platform)) {
    const gate = commandResult(label, program, args, { env, inherit: true });
    gates.push(gate);
    if (!gate.ok) break;
  }
  const report = diagnose({ ...options, mode: "certify", gates }).report;
  if (gates.some((gate) => !gate.ok)) {
    report.state = "BLOCKED";
    report.blockers.push(`gate_failed:${gates.find((gate) => !gate.ok).label}`);
    atomicWriteJson(options.reportPath ?? defaultReportPath, report);
  }
  return { report, exitCode: report.state === "READY" ? EXIT.OK : EXIT.BLOCKED };
}

function parseCli(argv) {
  const mode = argv[0] ?? "diagnose";
  const options = { mode, env: process.env };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--offline") options.offline = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.printJson = true;
    else if (arg === "--profile") {
      options.profile = argv[index + 1];
      index += 1;
    } else if (arg === "--manifest") {
      options.manifestPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === "--report") {
      options.reportPath = path.resolve(argv[index + 1]);
      index += 1;
    } else throw new Error(`argumento desconhecido: ${arg}`);
  }
  if ((options.profile ?? "full") !== "full") throw new Error("somente o profile full e suportado na v1");
  return options;
}

function printSummary(report, printJson) {
  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`RetroDev Studio host: ${report.state}\n`);
  process.stdout.write(`Host: ${report.host.platform}/${report.host.arch}/${report.host.os_id}\n`);
  process.stdout.write(`Fingerprint: ${report.host_fingerprint}\n`);
  process.stdout.write(`Lock: ${report.lock_digest}\n`);
  process.stdout.write(`Report: ${report.paths.report}\n`);
  if (report.blockers.length > 0) process.stdout.write(`Blockers: ${report.blockers.join(", ")}\n`);
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseCli(argv);
    const result = options.mode === "ensure" ? ensure(options) : options.mode === "certify" ? certify(options) : { report: diagnose(options).report, exitCode: undefined };
    printSummary(result.report, options.printJson);
    if (result.exitCode !== undefined) return result.exitCode;
    if (result.report.state === "READY") return EXIT.OK;
    if (result.report.state === "UNSUPPORTED") return EXIT.UNSUPPORTED;
    return EXIT.BLOCKED;
  } catch (error) {
    process.stderr.write(`[HOST] ${error.message}\n`);
    return EXIT.INVALID;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main();
}
