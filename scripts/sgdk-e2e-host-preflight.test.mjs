import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preflightUrl = pathToFileURL(path.join(repoRoot, "scripts", "sgdk-e2e-host-preflight.mjs")).href;

const originalPath = process.env.PATH;
const tempRoots = [];

function makeTempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rds-preflight-"));
  tempRoots.push(dir);
  return dir;
}

function touch(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "");
}

function runPreflightProbe(expression, env = {}) {
  const source = `
    const preflight = await import(${JSON.stringify(preflightUrl)});
    const result = await (${expression})(preflight);
    console.log(JSON.stringify(result));
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return JSON.parse(stdout);
}

afterEach(() => {
  process.env.PATH = originalPath;
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

describe("sgdk-e2e-host-preflight", () => {
  it("does not accept explicit .exe paths as Linux executables", async () => {
    const dir = makeTempDir();
    const exePath = path.join(dir, "msedgedriver.exe");
    touch(exePath);

    expect(
      runPreflightProbe(
        `(preflight) => preflight.resolveExecutable(${JSON.stringify(exePath)}, ["msedgedriver.exe"], { hostPlatform: "linux" })`
      )
    ).toBe("");
  });

  it("prefers native Linux webdriver names over Windows PE names", async () => {
    const dir = makeTempDir();
    touch(path.join(dir, "msedgedriver.exe"));

    const expression =
      '(preflight) => preflight.resolveExecutable("", ["msedgedriver", "msedgedriver.exe", "chromedriver"], { hostPlatform: "linux" })';

    expect(runPreflightProbe(expression, { PATH: dir })).toBe("");

    const chromedriver = path.join(dir, "chromedriver");
    touch(chromedriver);

    expect(runPreflightProbe(expression, { PATH: dir })).toBe(chromedriver);
  });

  it("does not treat a Windows SGDK toolchain as ready on Linux", async () => {
    const root = makeTempDir();
    const sgdkRoot = path.join(root, "toolchains", "sgdk");
    touch(path.join(sgdkRoot, "bin", "gcc.exe"));
    touch(path.join(sgdkRoot, "makefile.gen"));

    // Controlled empty PATH so the probe stays hermetic: it must not pick up a
    // real m68k-elf-gcc that happens to be installed on the host. The intent is
    // that a Windows gcc.exe alone, with no native compiler, is not ready.
    const emptyBin = makeTempDir();
    const result = runPreflightProbe(
      `(preflight) => preflight.resolveSgdkRoot(${JSON.stringify(root)}, "linux")`,
      { PATH: emptyBin }
    );

    expect(result.exists).toBe(true);
    expect(result.makefileGen).toBe(true);
    expect(result.gcc).toBe(false);
    expect(result.compiler).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("accepts native SGDK compiler plus make and java on Linux", async () => {
    const root = makeTempDir();
    const hostBin = path.join(root, "host-bin");
    const sgdkRoot = path.join(root, "toolchains", "sgdk");
    touch(path.join(sgdkRoot, "bin", "m68k-elf-gcc"));
    touch(path.join(sgdkRoot, "makefile.gen"));
    touch(path.join(hostBin, "make"));
    touch(path.join(hostBin, "java"));

    const result = runPreflightProbe(
      `(preflight) => preflight.resolveSgdkRoot(${JSON.stringify(root)}, "linux")`,
      { PATH: hostBin }
    );

    expect(result.exists).toBe(true);
    expect(result.compiler).toBe(true);
    expect(result.make).toBe(true);
    expect(result.java).toBe(true);
    expect(result.ok).toBe(true);
  });
});
