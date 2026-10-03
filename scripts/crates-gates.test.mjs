import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { runCrateGates } from "./crates-gates.mjs";

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "crates-gates.mjs",
);
const raizesTemporarias = [];

function raizTemporaria(nome) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `rds-crates-gates-${nome}-`));
  raizesTemporarias.push(root);
  fs.mkdirSync(path.join(root, "crates"), { recursive: true });
  return root;
}

function escreverRegistro(root, pacotes, schema = "rex-crate-registry/v1") {
  fs.writeFileSync(
    path.join(root, "crates", "registry.json"),
    `${JSON.stringify({ schema, pacotes }, null, 2)}\n`,
  );
}

function escreverPacote(root, nome) {
  const diretorio = path.join(root, "crates", nome);
  fs.mkdirSync(diretorio, { recursive: true });
  fs.writeFileSync(
    path.join(diretorio, "Cargo.toml"),
    `[package]\nname = "${nome}"\nversion = "0.0.0"\n`,
  );
  return `crates/${nome}/Cargo.toml`;
}

function registroCompletado(root, pacotes) {
  for (const pacote of pacotes) escreverPacote(root, pacote);
  escreverRegistro(
    root,
    pacotes.map((nome) => ({ nome, manifesto: `crates/${nome}/Cargo.toml` })),
  );
}

afterEach(() => {
  while (raizesTemporarias.length > 0) {
    fs.rmSync(raizesTemporarias.pop(), { recursive: true, force: true });
  }
});

describe("crates:gates - lista explicita de pacotes registrados", () => {
  it("reprova pacote declarado cujo manifesto nao existe, sem o ignorar", async () => {
    const root = raizTemporaria("ausente");
    escreverPacote(root, "presente");
    escreverRegistro(root, [
      { nome: "presente", manifesto: "crates/presente/Cargo.toml" },
      { nome: "fantasma", manifesto: "crates/fantasma/Cargo.toml" },
    ]);

    const chamadas = [];
    const resultado = await runCrateGates({
      root,
      dryRun: true,
      runCommand: async (binario, argumentos) => {
        chamadas.push([binario, ...argumentos].join(" "));
        return { rc: 0, output: "" };
      },
    });

    expect(resultado.rc).not.toBe(0);
    expect(resultado.saidas.join("\n")).toMatch(/fantasma/);
    expect(resultado.saidas.join("\n")).toMatch(/crates\/fantasma\/Cargo\.toml/);
    // O pacote valido nao e silenciado pelo erro do pacote ausente.
    expect(chamadas.some((linha) => linha.includes("crates/presente/Cargo.toml"))).toBe(
      true,
    );
  });

  it("emite exatamente os tres gates por pacote registrado, na ordem", async () => {
    const root = raizTemporaria("comando");
    registroCompletado(root, ["um", "dois"]);

    const chamadas = [];
    const resultado = await runCrateGates({
      root,
      dryRun: true,
      runCommand: async (binario, argumentos) => {
        chamadas.push([binario, ...argumentos].join(" "));
        return { rc: 0, output: "" };
      },
    });

    expect(resultado.rc).toBe(0);
    expect(chamadas).toEqual([
      "cargo fmt --manifest-path crates/um/Cargo.toml -- --check",
      "cargo clippy --manifest-path crates/um/Cargo.toml --all-targets -- -D warnings",
      "cargo test --manifest-path crates/um/Cargo.toml --locked",
      "cargo fmt --manifest-path crates/dois/Cargo.toml -- --check",
      "cargo clippy --manifest-path crates/dois/Cargo.toml --all-targets -- -D warnings",
      "cargo test --manifest-path crates/dois/Cargo.toml --locked",
    ]);
  });

  it("reprova quando um gate falha, sem interromper os gates restantes", async () => {
    const root = raizTemporaria("falha");
    registroCompletado(root, ["solo"]);

    const chamadas = [];
    const resultado = await runCrateGates({
      root,
      runCommand: async (binario, argumentos) => {
        const linha = [binario, ...argumentos].join(" ");
        chamadas.push(linha);
        return { rc: linha.includes("clippy") ? 1 : 0, output: "erro simulado" };
      },
    });

    expect(resultado.rc).not.toBe(0);
    expect(chamadas).toHaveLength(3);
    const texto = resultado.saidas.join("\n");
    expect(texto).toMatch(/REPROVADO/);
    expect(texto).toMatch(/solo clippy/);
  });

  it("falha quando o registro nao existe ou tem schema inesperado", async () => {
    const semRegistro = raizTemporaria("sem-registro");
    const ausente = await runCrateGates({
      root: semRegistro,
      dryRun: true,
      runCommand: async () => ({ rc: 0, output: "" }),
    });
    expect(ausente.rc).not.toBe(0);
    expect(ausente.saidas.join("\n")).toMatch(/crates\/registry\.json/);

    const root = raizTemporaria("schema");
    escreverRegistro(root, [], "outra-coisa/v2");
    const drift = await runCrateGates({
      root,
      dryRun: true,
      runCommand: async () => ({ rc: 0, output: "" }),
    });
    expect(drift.rc).not.toBe(0);
    expect(drift.saidas.join("\n")).toMatch(/rex-crate-registry\/v1/);
  });

  it("lista vazia nao inventa gates e passa", async () => {
    const root = raizTemporaria("vazio");
    escreverRegistro(root, []);

    const chamadas = [];
    const resultado = await runCrateGates({
      root,
      dryRun: true,
      runCommand: async (binario, argumentos) => {
        chamadas.push([binario, ...argumentos].join(" "));
        return { rc: 0, output: "" };
      },
    });

    expect(chamadas).toEqual([]);
    expect(resultado.rc).toBe(0);
    expect(resultado.saidas.join("\n")).toMatch(/nenhum pacote/);
  });

  it("a CLI propaga o codigo de saida quando um pacote esperado falta", () => {
    const root = raizTemporaria("cli");
    escreverRegistro(root, [{ nome: "fantasma", manifesto: "crates/fantasma/Cargo.toml" }]);

    const exec = spawnSync(process.execPath, [scriptPath, "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, RDS_CRATES_ROOT: root },
    });

    expect(exec.status).not.toBe(0);
    expect(`${exec.stdout}${exec.stderr}`).toMatch(/fantasma/);
  });
});
