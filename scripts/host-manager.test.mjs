import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  HOST_READINESS_SCHEMA,
  acquireOperationLock,
  defaultManifestPath,
  detectHost,
  diagnose,
  ensurePortableArtifact,
  expandTokens,
  installSourceBuild,
  isSupportedHost,
  probeRequirement,
  readManifest,
  resolveCommand,
  repoRoot,
  stableJson,
  validateManifest,
} from "./host-manager.mjs";

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

  it("serializes concurrent host mutations with an operation lock", () => {
    const directory = tempDir();
    const first = acquireOperationLock(directory);

    expect(first).not.toBeNull();
    expect(acquireOperationLock(directory)).toBeNull();
    first.release();
    expect(acquireOperationLock(directory)).not.toBeNull();
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
});
