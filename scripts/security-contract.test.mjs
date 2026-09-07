import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TOOLCHAIN_LICENSES, collectToolchainArtifacts } from "./license-inventory.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("desktop security contract", () => {
  it("enforces a non-null CSP and rejects broad home/temp asset scopes", () => {
    const config = JSON.parse(readFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"));
    const security = config.app.security;
    expect(security.csp).toContain("default-src 'self'");
    expect(security.csp).toContain("connect-src 'self' ipc: http://ipc.localhost");
    expect(security.csp).toContain("img-src 'self' asset: http://asset.localhost");
    expect(security.csp).toContain("object-src 'none'");
    expect(security.assetProtocol.scope).not.toContain("$HOME/**");
    expect(security.assetProtocol.scope).not.toContain("$TEMP/**");
  });

  it("authorizes only validated project directories at runtime", () => {
    const rust = readFileSync(path.join(repoRoot, "src-tauri", "src", "lib.rs"), "utf8");
    const policy = readFileSync(
      path.join(repoRoot, "src-tauri", "src", "core", "project_asset_scope.rs"),
      "utf8"
    );
    expect(rust).toContain("fn authorize_project_asset_scope");
    expect(policy).toContain("discover_project_rds(Path::new(requested))");
    expect(policy).toContain("asset_protocol_scope()");
    expect(policy).toContain("allow_directory(&canonical, true)");
    expect(policy).toContain("forbid_directory(previous, true)");
  });

  it("keeps the updater disabled until signing is real", () => {
    const config = JSON.parse(readFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"));
    const cargo = readFileSync(path.join(repoRoot, "src-tauri", "Cargo.toml"), "utf8");
    const rust = readFileSync(path.join(repoRoot, "src-tauri", "src", "lib.rs"), "utf8");
    expect(config.bundle.createUpdaterArtifacts).toBe(false);
    expect(config.plugins?.updater).toBeUndefined();
    expect(cargo).not.toContain("tauri-plugin-updater");
    expect(rust).not.toContain("tauri_plugin_updater");
  });

  it("denies unreviewed npm install scripts", () => {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const npmrc = readFileSync(path.join(repoRoot, ".npmrc"), "utf8");
    expect(npmrc).toContain("strict-allow-scripts=true");
    expect(manifest.allowScripts).toEqual({
      "esbuild@0.25.12": true,
      fsevents: false,
    });
  });

  it("delegates Runtime Setup to the immutable host contract", () => {
    const source = readFileSync(
      path.join(repoRoot, "src-tauri", "src", "tools", "dependency_manager.rs"),
      "utf8"
    );
    expect(source).toContain("host-manager.mjs");
    expect(source).toContain("host-readiness.json");
    expect(source).not.toContain("/releases/latest");
    expect(source).not.toContain("api.adoptium.net");
    expect(source).not.toContain("download_to_file");
  });

  it("has a non-redistribution license policy for every locked toolchain artifact", () => {
    const entries = collectToolchainArtifacts(repoRoot);
    expect(entries).toHaveLength(Object.keys(TOOLCHAIN_LICENSES).length);
    expect(entries.every((entry) => entry.license.length > 0)).toBe(true);
    expect(entries.every((entry) => entry.redistributed === false)).toBe(true);
  });
});
