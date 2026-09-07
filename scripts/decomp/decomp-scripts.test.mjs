import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Reproduction scripts for the Experimental decompilation spike
// (docs/12_DECOMPILACAO_PAREADA_PLANO.md). No scanner/ledger/LLM/UI here —
// these tests only exercise the fail-hard/JSON-validity properties of the
// versioned reproduction scripts themselves.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const decompDir = path.join(repoRoot, "scripts", "decomp");
const holdoutScript = path.join(decompDir, "holdout_v2.sh");
const fingerprintScript = path.join(decompDir, "fingerprint_v2.sh");
const ghidraScript = path.join(decompDir, "ghidra_boundary.sh");
const buildScript = path.join(decompDir, "build_reproducible.sh");

const linuxDescribe = process.platform === "linux" ? describe : describe.skip;

function hasCmd(cmd) {
  return spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" }).status === 0;
}

const HAS_M68K_TOOLS =
  hasCmd("m68k-elf-as") && hasCmd("m68k-elf-ld") && hasCmd("m68k-elf-objdump") &&
  hasCmd("m68k-elf-objcopy");

// build_reproducible.sh has fail-hard preconditions (GDK + gcc/as) that run
// before the per-project [BUILD-FAIL] loop; the missing-projects regression
// can only be exercised on hosts where those preconditions pass.
const GDK_ROOT = process.env.GDK ?? "/mnt/sdcard/Projects/MegaDrive_DEV/sdk/sgdk-2.11";
const HAS_SGDK_BUILD_TOOLCHAIN =
  hasCmd("m68k-elf-gcc") && hasCmd("m68k-elf-as") &&
  existsSync(path.join(GDK_ROOT, "makefile.gen"));

function runBash(scriptPath, env = {}, timeoutMs = 60_000) {
  return spawnSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: timeoutMs,
  });
}

function parseJsonFile(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

linuxDescribe("scripts/decomp fail-hard behaviour (empty corpus)", () => {
  let tmp;
  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "rds-decomp-empty-"));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("holdout_v2.sh fails (non-zero exit) with a nonexistent corpus dir", () => {
    const corpus = path.join(tmp, "does-not-exist");
    const work = path.join(tmp, "holdout-work");
    const result = runBash(holdoutScript, {
      RDS_SGDK_CORPUS: corpus,
      RDS_DECOMP_WORK: work,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/FATAL/);
    expect(result.stdout + result.stderr).not.toMatch(/GATE PASSED/);
  });

  it("holdout_v2.sh fails (non-zero exit) with a corpus dir that exists but has no rom.out", () => {
    const corpus = path.join(tmp, "empty-but-exists-holdout");
    mkdirSync(corpus, { recursive: true });
    const work = path.join(tmp, "holdout-work-2");
    const result = runBash(holdoutScript, {
      RDS_SGDK_CORPUS: corpus,
      RDS_DECOMP_WORK: work,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toMatch(/GATE PASSED/);
  });

  it("fingerprint_v2.sh fails (non-zero exit) with a nonexistent corpus dir", () => {
    const corpus = path.join(tmp, "does-not-exist-2");
    const work = path.join(tmp, "fp-work");
    const result = runBash(fingerprintScript, {
      RDS_SGDK_CORPUS: corpus,
      RDS_DECOMP_WORK: work,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/FATAL/);
    expect(result.stdout + result.stderr).not.toMatch(/GATE PASSED/);
    // No manifest should be written to a location a caller might mistake for
    // a valid (if empty) result.
    expect(existsSync(path.join(work, "fingerprint-v2-manifest.json"))).toBe(false);
  });

  it("fingerprint_v2.sh fails (non-zero exit) with a corpus dir that exists but has no rom.out", () => {
    const corpus = path.join(tmp, "empty-but-exists-fp");
    mkdirSync(corpus, { recursive: true });
    const work = path.join(tmp, "fp-work-2");
    const result = runBash(fingerprintScript, {
      RDS_SGDK_CORPUS: corpus,
      RDS_DECOMP_WORK: work,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toMatch(/GATE PASSED/);
  });

  it("build_reproducible.sh fails (non-zero exit) with a nonexistent corpus dir", () => {
    const corpus = path.join(tmp, "does-not-exist-3");
    const work = path.join(tmp, "build-work");
    const result = runBash(buildScript, {
      RDS_SGDK_CORPUS: corpus,
      RDS_DECOMP_WORK: work,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/FATAL/);
    expect(result.stdout + result.stderr).not.toMatch(/GATE PASSED/);
  });

  (HAS_SGDK_BUILD_TOOLCHAIN ? it : it.skip)(
    "build_reproducible.sh fails (non-zero exit) when named projects are absent from an existing corpus dir",
    () => {
    // Regression for the false-positive found in this audit: previously
    // `cp ... || true` silently produced an empty project dir, and SGDK still
    // built an identical trivial bootstrap-only ROM every time, reporting
    // "5/5 REPRODUCIBLE" on a corpus that had none of the named projects.
    const corpus = path.join(tmp, "exists-but-no-named-projects");
    mkdirSync(corpus, { recursive: true });
    const work = path.join(tmp, "build-work-2");
    const result = runBash(buildScript, {
      RDS_SGDK_CORPUS: corpus,
      RDS_DECOMP_WORK: work,
    }, 30_000);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/\[BUILD-FAIL\]/);
    expect(result.stderr).toMatch(/MISSING SOURCE PROJECT/);
    expect(result.stdout + result.stderr).not.toMatch(/GATE PASSED/);
  });
});

linuxDescribe("ghidra_boundary.sh BLOCKED path (no install attempted)", () => {
  it("exits 3 and writes a blocked JSON report when Ghidra is not resolvable, without installing anything", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "rds-ghidra-blocked-"));
    try {
      // `RETRODEV_GHIDRA_HOME` sozinho nao garante a pre-condicao: o script cai
      // para `command -v analyzeHeadless` quando o home aponta para lugar
      // nenhum. Num host provisionado (`host:diagnose` READY) o PATH injetado
      // traz o Ghidra do cache, o caminho BLOCKED fica inalcancavel e o script
      // dispara uma analise headless real que estoura o timeout do runBash.
      // Isso tornava `npm run host:certify` impossivel de passar exatamente
      // quando o host estava correto. Sanitizar o PATH torna a pre-condicao
      // real, sem afrouxar nenhuma asercao.
      const pathWithoutGhidra = (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter((entry) => entry && !existsSync(path.join(entry, "analyzeHeadless")))
        .join(path.delimiter);
      const result = runBash(ghidraScript, {
        RETRODEV_GHIDRA_HOME: path.join(tmp, "nonexistent-ghidra"),
        RDS_DECOMP_WORK: tmp,
        PATH: pathWithoutGhidra,
      });
      expect(result.status).toBe(3);
      expect(result.stdout).toMatch(/BLOCKED/);
      expect(result.stdout).not.toMatch(/sudo pacman -S jdk21-openjdk\n.*\n.*sudo pacman -S ghidra\n.*\n.*executando/i);
      // The script must print the authorization request but never execute an
      // install itself.
      expect(result.stdout).toMatch(/Autorizacao humana necessaria/);
      const reportPath = path.join(tmp, "ghidra_boundary", "ghidra-boundary-report.json");
      expect(existsSync(reportPath)).toBe(true);
      const report = parseJsonFile(reportPath);
      expect(report.ok).toBe(false);
      expect(report.blocked).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not contain any package-install invocation reachable without Ghidra/JDK21 present", () => {
    const source = readFileSync(ghidraScript, "utf8");
    // The authorization block only ever appears inside a heredoc printed to
    // stdout; assert there is no `pacman -S`/`paru -S` call OUTSIDE that
    // documented, non-executed block.
    const withoutHeredoc = source.replace(/cat <<'EOF'[\s\S]*?^EOF$/m, "");
    expect(withoutHeredoc).not.toMatch(/pacman -S|paru -S/);
  });
});

describe("ghidra_boundary.sh fails when required Ghidra/JDK21 tooling is genuinely present but samples are missing", () => {
  const GHIDRA_AVAILABLE =
    process.platform === "linux" &&
    existsSync("/opt/ghidra/support/analyzeHeadless") &&
    existsSync("/usr/lib/jvm/java-21-openjdk/bin/java");
  const maybeIt = GHIDRA_AVAILABLE ? it : it.skip;

  maybeIt(
    "fails (non-zero exit) when the corpus has none of the required named projects (all MISSING_ELF)",
    () => {
      const tmp = mkdtempSync(path.join(os.tmpdir(), "rds-ghidra-missing-"));
      try {
        const corpus = path.join(tmp, "corpus-without-named-projects");
        mkdirSync(corpus, { recursive: true });
        const result = runBash(
          ghidraScript,
          { RDS_SGDK_CORPUS: corpus, RDS_DECOMP_WORK: tmp },
          120_000
        );
        expect(result.status).not.toBe(0);
        expect(result.status).not.toBe(3); // must fail on samples, not re-hit BLOCKED
        expect(result.stdout).toMatch(/MISSING_ELF/);
        expect(result.stdout).toMatch(/GATE FAILED/);
        const reportPath = path.join(tmp, "ghidra_boundary", "ghidra-boundary-report.json");
        const report = parseJsonFile(reportPath);
        expect(report.ok).toBe(false);
        expect(report.failed_samples).toBeGreaterThan(0);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    150_000
  );
});

// --- Synthetic BYOR-safe M68K fixture: no ROM, no SGDK corpus needed. Two
// tiny hand-assembled ELF functions with real F .text symbol boundaries,
// enough to exercise fingerprint_v2.sh/holdout_v2.sh end-to-end without any
// dependency on the external corpus. Family name "SynthProj" is chosen so its
// deterministic sha256(family)%100 bucket (90) falls in the holdout split
// (>=85), so this is not a flaky test.
const maybeSynthDescribe = HAS_M68K_TOOLS ? describe : describe.skip;

maybeSynthDescribe("scripts/decomp nominal path on a synthetic minimal fixture", () => {
  let tmp;
  let corpus;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "rds-decomp-synth-"));
    corpus = path.join(tmp, "corpus");
    const projectDir = path.join(
      corpus,
      "SynthProj [VER.001] [SGDK 211] [GEN] [TEST] [FIXTURE]",
      "out"
    );
    mkdirSync(projectDir, { recursive: true });

    const asmSource = [
      "\t.text",
      "\t.globl synth_function_one",
      "\t.type synth_function_one, @function",
      "synth_function_one:",
      "\tmove.l #1,%d0",
      "\trts",
      "\t.size synth_function_one, . - synth_function_one",
      "\t.globl synth_function_two",
      "\t.type synth_function_two, @function",
      "synth_function_two:",
      "\tmove.l #2,%d0",
      "\trts",
      "\t.size synth_function_two, . - synth_function_two",
      "",
    ].join("\n");
    const asmPath = path.join(tmp, "synth.s");
    const objPath = path.join(tmp, "synth.o");
    const elfPath = path.join(projectDir, "rom.out");
    writeFileSync(asmPath, asmSource, "utf8");

    const asResult = spawnSync("m68k-elf-as", ["-o", objPath, asmPath], { encoding: "utf8" });
    if (asResult.status !== 0) {
      throw new Error(`m68k-elf-as failed: ${asResult.stderr}`);
    }
    const ldResult = spawnSync(
      "m68k-elf-ld",
      ["-o", elfPath, objPath, "-e", "synth_function_one"],
      { encoding: "utf8" }
    );
    if (ldResult.status !== 0) {
      throw new Error(`m68k-elf-ld failed: ${ldResult.stderr}`);
    }
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("fingerprint_v2.sh succeeds and emits a valid, parseable JSON manifest with real numeric fields", () => {
    const work = path.join(tmp, "fp-work");
    const result = runBash(fingerprintScript, {
      RDS_SGDK_CORPUS: corpus,
      RDS_DECOMP_WORK: work,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/GATE PASSED/);

    const manifestPath = path.join(work, "m68k_fp_v2", "fingerprint-v2-manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = parseJsonFile(manifestPath); // throws if invalid JSON
    expect(manifest.ok).toBe(true);
    expect(manifest.elfs_processed).toBe(1);
    expect(manifest.function_instances).toBeGreaterThanOrEqual(2);
    expect(typeof manifest.unique_resolution_rate).toBe("number");
    expect(typeof manifest.ambiguous_hashes).toBe("number");
  });

  it("holdout_v2.sh succeeds, emits valid JSON, and never declares GATE PASSED with holdout_functions=0", () => {
    const work = path.join(tmp, "holdout-work");
    const result = runBash(holdoutScript, {
      RDS_SGDK_CORPUS: corpus,
      RDS_DECOMP_WORK: work,
    });
    const manifestPath = path.join(work, "holdout_v2", "holdout-v2-manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = parseJsonFile(manifestPath);

    if (manifest.ok) {
      // "SynthProj" is deterministically bucketed into holdout (sha256 % 100
      // = 90 >= 85); if the split ever changes this assumption, ok=false is
      // an acceptable (and still auditable) outcome, but ok=true must never
      // coexist with holdout_functions=0.
      expect(result.status).toBe(0);
      expect(manifest.holdout_functions).toBeGreaterThan(0);
      expect(result.stdout).toMatch(/GATE PASSED/);
    } else {
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toMatch(/GATE PASSED/);
    }
  });
});
