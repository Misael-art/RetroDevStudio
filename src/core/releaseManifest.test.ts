// @vitest-environment node

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifestScript = path.join(repoRoot, "scripts", "release-manifest.mjs");

function createFixtureRepo() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "rds-release-manifest-"));
  const validationDir = path.join(fixtureRoot, "src-tauri", "target-test", "validation");
  const debugDir = path.join(fixtureRoot, "src-tauri", "target-test", "debug");
  const releaseDir = path.join(fixtureRoot, "src-tauri", "target-test", "release");
  const msiDir = path.join(releaseDir, "bundle", "msi");

  mkdirSync(validationDir, { recursive: true });
  mkdirSync(debugDir, { recursive: true });
  mkdirSync(msiDir, { recursive: true });

  writeFileSync(path.join(fixtureRoot, "package.json"), JSON.stringify({ version: "9.8.7" }));
  writeFileSync(path.join(debugDir, "retro-dev-studio.exe"), "debug executable");
  writeFileSync(path.join(releaseDir, "retro-dev-studio.exe"), "portable executable");
  writeFileSync(path.join(msiDir, "Retro Dev Studio_9.8.7_x64_en-US.msi"), "msi installer");
  writeFileSync(path.join(validationDir, "release-readiness.md"), "# Release Readiness\n");
  writeFileSync(
    path.join(validationDir, "release-readiness.json"),
    JSON.stringify({
      generatedAt: "2026-05-23T12:00:00.000Z",
      summary: {
        readyForPromotion: false,
        blockers: ["Promocao publica pendente de certificado real."],
      },
    })
  );
  writeFileSync(
    path.join(validationDir, "upstream-validation.json"),
    JSON.stringify({
      generatedAt: "2026-05-23T11:59:00.000Z",
      success: true,
      phases: {
        sgdk: { status: "passed", version: "2.11", path: "toolchains/sgdk" },
        pvsneslib: { status: "passed", version: "4.3.0", path: "toolchains/pvsneslib" },
        libretro: { status: "passed", core: "Genesis Plus GX" },
      },
    })
  );

  const gitEnv = {
    RDS_RELEASE_MANIFEST_BRANCH: "codex/release-manifest-packaging-z",
    RDS_RELEASE_MANIFEST_COMMIT:
      "0123456789abcdef0123456789abcdef01234567",
  };

  return { fixtureRoot, validationDir, gitEnv };
}

function runManifest(
  fixtureRoot: string,
  extraEnv: Record<string, string | undefined> = {}
) {
  const env: Record<string, string | undefined> = { ...process.env, ...extraEnv };
  if (!Object.prototype.hasOwnProperty.call(extraEnv, "GITHUB_ACTIONS")) {
    delete env.GITHUB_ACTIONS;
    delete env.GITHUB_RUN_ID;
    delete env.GITHUB_RUN_ATTEMPT;
    delete env.GITHUB_REF_NAME;
    delete env.GITHUB_REF;
    delete env.GITHUB_SHA;
  }

  return spawnSync("node", [manifestScript, "--repo-root", fixtureRoot], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    maxBuffer: 1024 * 1024 * 8,
    timeout: 30000,
  });
}

function readManifest(validationDir: string) {
  return JSON.parse(
    readFileSync(path.join(validationDir, "release-manifest.json"), "utf8")
  ) as {
    version: string;
    commit: string;
    branch: string;
    date: string;
    artifacts: Record<string, { path: string; sha256: string; sizeBytes: number }>;
    readinessReport: { path: string; exists: boolean };
    toolchainSummary: { status: string; components: Array<{ id: string; status: string }> };
    ciStatus: { status: string; provider?: string; runId?: string | null };
    signingStatus: { signed: boolean; status: string };
    updaterStatus: { status: string };
  };
}

describe("release-manifest.mjs", () => {
  it("writes the manifest schema with SHA256 hashes, sizes, readiness and production limits", () => {
    const { fixtureRoot, validationDir, gitEnv } = createFixtureRepo();

    const result = runManifest(fixtureRoot, gitEnv);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const manifest = readManifest(validationDir);
    expect(manifest.version).toBe("9.8.7");
    expect(manifest.branch).toBe("codex/release-manifest-packaging-z");
    expect(manifest.commit).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(Date.parse(manifest.date)).not.toBeNaN();
    expect(Object.keys(manifest.artifacts).sort()).toEqual([
      "debugExe",
      "msi",
      "portableExe",
    ]);

    for (const artifact of Object.values(manifest.artifacts)) {
      expect(artifact.path).toContain("src-tauri/target-test");
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.sizeBytes).toBe(statSync(path.resolve(fixtureRoot, artifact.path)).size);
    }

    expect(manifest.readinessReport.path).toBe(
      "src-tauri/target-test/validation/release-readiness.md"
    );
    expect(manifest.readinessReport.exists).toBe(true);
    expect(manifest.toolchainSummary.status).toBe("passed");
    expect(manifest.toolchainSummary.components).toContainEqual({
      id: "sgdk",
      status: "passed",
    });
    expect(manifest.ciStatus.status).toBe("unavailable");
    expect(manifest.signingStatus).toEqual({
      signed: false,
      status: "unsigned",
    });
    expect(manifest.updaterStatus.status).toBe("deferred");
  });

  it("fails with an actionable error when a required artifact is missing", () => {
    const { fixtureRoot, gitEnv } = createFixtureRepo();
    rmSync(path.join(fixtureRoot, "src-tauri", "target-test", "release", "retro-dev-studio.exe"));

    const result = runManifest(fixtureRoot, gitEnv);

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "Artefato obrigatorio ausente: portableExe"
    );
  });

  it("does not declare signed distribution without a real certificate", () => {
    const { fixtureRoot, validationDir, gitEnv } = createFixtureRepo();

    const result = runManifest(fixtureRoot, {
      ...gitEnv,
      RDS_RELEASE_SIGNING_CERTIFICATE: "",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readManifest(validationDir).signingStatus).toEqual({
      signed: false,
      status: "unsigned",
    });
  });

  it("marks CI metadata as available when GitHub Actions env is present", () => {
    const { fixtureRoot, validationDir, gitEnv } = createFixtureRepo();

    const result = runManifest(fixtureRoot, {
      ...gitEnv,
      GITHUB_ACTIONS: "true",
      GITHUB_RUN_ID: "26349808022",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readManifest(validationDir).ciStatus).toMatchObject({
      status: "available",
      provider: "github_actions",
      runId: "26349808022",
    });
  });

  it("summarizes upstream validation arrays using actionable phase names", () => {
    const { fixtureRoot, validationDir, gitEnv } = createFixtureRepo();
    writeFileSync(
      path.join(validationDir, "upstream-validation.json"),
      JSON.stringify({
        generatedAt: "2026-05-23T13:00:00.000Z",
        success: false,
        phases: [
          { phase: "process_sweep", status: "passed" },
          { phase: "upstream_smoke", status: "failed" },
        ],
      })
    );

    const result = runManifest(fixtureRoot, gitEnv);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readManifest(validationDir).toolchainSummary).toMatchObject({
      status: "failed",
      components: [
        { id: "process_sweep", status: "passed" },
        { id: "upstream_smoke", status: "failed" },
      ],
    });
  });
});
