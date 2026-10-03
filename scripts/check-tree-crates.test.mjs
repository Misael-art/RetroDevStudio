import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const checkTreeScript = path.join(scriptsDir, "check-tree.cjs");

const tempRoots = [];

/** Raiz minima que satisfaz a precondicao do script (docs/08 existe). */
function novaRaiz() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rds-check-tree-"));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "08_TREE_ARCHITECTURE.md"),
    "# arvore\n",
    "utf8",
  );
  return root;
}

function escrever(root, relativo, conteudo) {
  const destino = path.join(root, relativo);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, conteudo, "utf8");
}

function registro(pacotes) {
  return `${JSON.stringify({ schema: "rex-crate-registry/v1", pacotes }, null, 2)}\n`;
}

function executarCheckTree(root) {
  try {
    const stdout = execFileSync(process.execPath, [checkTreeScript], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, RDS_CHECK_TREE_ROOT: root },
    });
    return { rc: 0, saida: stdout };
  } catch (error) {
    return { rc: error.status, saida: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

afterEach(() => {
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

describe("check:tree e o diretorio crates/", () => {
  it("aceita crates/ quando cada pacote do registro existe com Cargo.toml", () => {
    const root = novaRaiz();
    escrever(root, "crates/registry.json", registro([{ nome: "rex-exemplo" }]));
    escrever(root, "crates/rex-exemplo/Cargo.toml", "[package]\nname = \"rex-exemplo\"\n");
    escrever(root, "crates/rex-exemplo/src/lib.rs", "// lib\n");

    const resultado = executarCheckTree(root);
    expect(resultado.saida).toContain("OK:");
    expect(resultado.rc).toBe(0);
  });

  it("reprova diretorio em crates/ que nao esta no registro", () => {
    const root = novaRaiz();
    escrever(root, "crates/registry.json", registro([{ nome: "rex-exemplo" }]));
    escrever(root, "crates/rex-exemplo/Cargo.toml", "[package]\n");
    escrever(root, "crates/nao-registrado/Cargo.toml", "[package]\n");

    const resultado = executarCheckTree(root);
    expect(resultado.rc).not.toBe(0);
    expect(resultado.saida).toContain("nao-registrado");
    expect(resultado.saida).toContain("crates/registry.json");
  });

  it("reprova pacote registrado cujo manifesto nao existe — ausencia nao e ignorada", () => {
    const root = novaRaiz();
    escrever(root, "crates/registry.json", registro([{ nome: "rex-fantasma" }]));
    escrever(root, "crates/rex-exemplo/Cargo.toml", "[package]\n");

    const resultado = executarCheckTree(root);
    expect(resultado.rc).not.toBe(0);
    expect(resultado.saida).toContain("rex-fantasma");
  });

  it("reprova crates/ sem registro, em vez de tratar o diretorio como caixa livre", () => {
    const root = novaRaiz();
    fs.mkdirSync(path.join(root, "crates"), { recursive: true });

    const resultado = executarCheckTree(root);
    expect(resultado.rc).not.toBe(0);
    expect(resultado.saida).toContain("crates/registry.json");
  });

  it("reprova arquivo solto dentro de crates/ que nao seja o registro nem o README", () => {
    const root = novaRaiz();
    escrever(root, "crates/registry.json", registro([]));
    escrever(root, "crates/solto.txt", "dado que nao e modulo\n");

    const resultado = executarCheckTree(root);
    expect(resultado.rc).not.toBe(0);
    expect(resultado.saida).toContain("solto.txt");
  });

  it("reprova manifesto declarado com separadores de Windows, em qualquer plataforma", () => {
    const root = novaRaiz();
    escrever(
      root,
      "crates/registry.json",
      registro([{ nome: "rex-exemplo", manifesto: "crates\\rex-exemplo\\Cargo.toml" }]),
    );
    escrever(root, "crates/rex-exemplo/Cargo.toml", "[package]\n");

    // No Linux este teste ja reprova antes da correcao; no Windows o `path.normalize`
    // das duas margens convergia para barra invertida e a declaracao torta era
    // aceita em silencio, o que calava a checagem so no SO onde ela importa.
    const resultado = executarCheckTree(root);
    expect(resultado.rc).not.toBe(0);
    expect(resultado.saida).toContain("esperado crates/rex-exemplo/Cargo.toml");
  });

  it("mantem as verificacoes anteriores: raiz estranha reprova, .github e data seguem aceitos", () => {
    const root = novaRaiz();
    escrever(root, ".github/workflows/ci.yml", "name: CI\n");
    escrever(root, "data/template_registry.json", "{}\n");
    expect(executarCheckTree(root).rc).toBe(0);

    escrever(root, "src-tauri/Cargo.toml", "[package]\n");
    escrever(root, "nao-declarado/qualquer.txt", "x\n");
    const resultado = executarCheckTree(root);
    expect(resultado.rc).not.toBe(0);
    expect(resultado.saida).toContain("nao-declarado");
  });

  it("as duas implementacoes da mesma gate aceitam o mesmo conjunto de diretorios", () => {
    const cjs = fs.readFileSync(checkTreeScript, "utf8");
    const ps1 = fs.readFileSync(path.join(scriptsDir, "check-tree.ps1"), "utf8");

    // A mesma lista e escrita como array JS multilinha no .cjs e como `@(...)`
    // de PowerShell no .ps1; a extracao aceita as duas formas.
    const lista = (conteudo, variavel) => {
      const nomeEscapado = variavel.replace("$", "\\$");
      const inicio = conteudo.search(new RegExp(`${nomeEscapado}\\s*=`));
      if (inicio < 0) throw new Error(`lista ${variavel} nao encontrada`);
      const cauda = conteudo.slice(inicio);
      const fechamentos = [cauda.indexOf("]"), cauda.indexOf(")")].filter((i) => i >= 0);
      const fatia = cauda.slice(0, Math.min(...fechamentos));
      return (fatia.match(/"([^"]+)"/g) ?? []).map((s) => s.replace(/"/g, "")).sort();
    };

    expect(lista(ps1, "$allowedDirs")).toEqual(lista(cjs, "allowedDirs"));
    expect(lista(ps1, "$ignoreDirs")).toEqual(lista(cjs, "ignoreDirs"));
    expect(lista(ps1, "$cratesFiles")).toEqual(lista(cjs, "cratesFilesPermitidos"));
  });

  it("os caminhos que a gate imprime sao literais POSIX nas duas implementacoes", () => {
    const cjs = fs.readFileSync(checkTreeScript, "utf8");
    const ps1 = fs.readFileSync(path.join(scriptsDir, "check-tree.ps1"), "utf8");

    // evidencia da CI de 2026-09-28 (run 36373219732, job validate, SHA a556e86):
    // o .cjs renderizou "crates\registry.json" no Windows enquanto o .ps1 sempre
    // emite "crates/registry.json" — duas implementacoes da mesma gate, duas
    // saidas. path.join serve para tocar o disco, nao para compor mensagem.
    expect(cjs).not.toMatch(/const (REGISTRO_CRATES|manifestoEsperado)\s*=\s*path\.join/);
    expect(cjs).toContain('const REGISTRO_CRATES = "crates/registry.json";');
    expect(cjs).toContain("const manifestoEsperado = `crates/${nome}/Cargo.toml`;");
    expect(ps1).toContain('$esperado = "crates/$nome/Cargo.toml"');

    // O mesmo veredicto em qualquer SO exige comparacao literal nas duas fontes:
    // normalizar o manifesto declarado fazia a checagem morder so em um platform.
    expect(cjs).not.toMatch(/path\.normalize\(\s*pacote\.manifesto\s*\)/);
    expect(ps1).not.toMatch(/\$pacote\.manifesto\s+-replace/);
  });
});
