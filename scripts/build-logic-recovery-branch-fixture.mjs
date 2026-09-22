#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "src-tauri", "tests", "fixtures", "logic_recovery_branch_sgdk");
const routinePrefix = Buffer.from([0x06, 0x40, 0x00, 0x01, 0x0c, 0x40, 0x00, 0x05, 0x6c]);
const routineSize = 30;

function fail(message) {
  throw new Error(`fixture:logic-recovery-branch: ${message}`);
}

function parseArgs(argv) {
  const options = { output: "", replace: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--replace") options.replace = true;
    else if (argument === "--output") options.output = argv[++index] ?? "";
    else if (argument.startsWith("--output=")) options.output = argument.slice(9);
    else fail(`argumento desconhecido: ${argument}`);
  }
  return options;
}

async function spawnChecked(command, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} terminou com ${signal ?? `status ${code}`}`)));
  });
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function findRoutine(rom) {
  const offsets = [];
  for (let offset = 0; offset <= rom.length - routineSize; offset += 1) {
    if (rom.subarray(offset, offset + routinePrefix.length).equals(routinePrefix)) offsets.push(offset);
  }
  if (offsets.length !== 1) fail(`assinatura da rotina não ficou única: ${JSON.stringify(offsets)}`);
  return { offset: offsets[0], bytes: rom.subarray(offsets[0], offsets[0] + routineSize) };
}

async function buildMode(mode, outputRoot, sgdkRoot) {
  const modeDir = path.join(outputRoot, mode);
  await cp(fixtureRoot, modeDir, { recursive: true });
  const selectedSource = mode === "node" ? "main_node.c" : "main_routine.c";
  await cp(path.join(modeDir, "src", selectedSource), path.join(modeDir, "src", "main.c"));
  await rm(path.join(modeDir, "src", "main_node.c"), { force: true });
  await rm(path.join(modeDir, "src", "main_routine.c"), { force: true });
  const m68kRoot = path.resolve(process.env.M68K_GCC_ROOT || path.join(path.dirname(sgdkRoot), "m68k-elf"));
  const env = {
    ...process.env,
    GDK: sgdkRoot,
    SGDK: sgdkRoot,
    PATH: `${path.join(m68kRoot, "bin")}${path.delimiter}${path.join(sgdkRoot, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
  };
  await spawnChecked("make", ["debug", "CONVSYM=true"], { cwd: modeDir, env });
  const romPath = path.join(modeDir, "out", "rom.bin");
  const rom = await readFile(romPath).catch(() => null);
  if (!rom || rom.subarray(0x100, 0x104).toString("ascii") !== "SEGA") fail(`ROM final ausente ou sem header SEGA: ${romPath}`);
  const routine = mode === "routine" ? findRoutine(rom) : { offset: null, bytes: null };
  const sourcePath = path.join(modeDir, "src", "main.c");
  const report = {
    schema: "rds-logic-recovery-branch-fixture-build/v1",
    mode,
    rom_path: romPath,
    rom_size_bytes: rom.length,
    rom_sha256: sha256(rom),
    routine_bytes_hex: routine.bytes ? routine.bytes.toString("hex").toUpperCase() : null,
    routine_rom_offset: routine.offset,
    source_path: sourcePath,
    source_sha256: sha256(await readFile(sourcePath)),
    sgdk_root: sgdkRoot,
    m68k_toolchain_root: m68kRoot,
  };
  await writeFile(path.join(modeDir, "fixture-build-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.output) fail("use --output <diretório-regenerável> (e --replace para sobrescrever)");
  const outputRoot = path.resolve(options.output);
  const sgdkRoot = path.resolve(process.env.SGDK_ROOT || process.env.GDK || "");
  if (!sgdkRoot || sgdkRoot === path.parse(sgdkRoot).root) fail("SGDK_ROOT ou GDK não está configurado");
  if (!(await readFile(path.join(sgdkRoot, "makefile.gen")).catch(() => null))) fail(`makefile.gen ausente em ${sgdkRoot}`);
  if (!options.replace && await readFile(path.join(outputRoot, "fixture-build-report.json")).catch(() => null)) fail(`saída já existe; use --replace explicitamente: ${outputRoot}`);
  if (options.replace) await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const node = await buildMode("node", outputRoot, sgdkRoot);
  const routine = await buildMode("routine", outputRoot, sgdkRoot);
  const report = { schema: "rds-logic-recovery-branch-fixture-build-set/v1", generated_at: new Date().toISOString(), output_root: outputRoot, fixture_root: fixtureRoot, sgdk_root: sgdkRoot, modes: { node, routine } };
  await writeFile(path.join(outputRoot, "fixture-build-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { process.exitCode = 1; console.error(error instanceof Error ? error.stack ?? error.message : String(error)); });
