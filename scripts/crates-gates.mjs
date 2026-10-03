#!/usr/bin/env node
/**
 * crates-gates.mjs - Gates proprios de cada pacote Rust registrado em
 * crates/registry.json: fmt --check, clippy --all-targets -D warnings e
 * test --locked, invocados por manifesto (--manifest-path), sem workspace na
 * raiz. A lista do registro e explicita: um pacote declarado cujo manifesto nao
 * existe reprova a corrida, em vez de ser ignorado silenciosamente.
 *
 * Uso: npm run crates:gates [-- --dry-run]
 *   --dry-run   imprime os comandos sem executar nada (usado pelo teste e
 *               pela checagem de lista antes de ter toolchain no host)
 * Entorno:  RDS_CRATES_ROOT  raiz alternativa (somente para testes do gate)
 *           CARGO_TARGET_DIR alvo de build; sem ele, <raiz>/target/crates-gates
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SCHEMA_REGISTRO = "rex-crate-registry/v1";

const GATES = [
  {
    nome: "fmt",
    argumentos: (manifesto) => ["fmt", "--manifest-path", manifesto, "--", "--check"],
  },
  {
    nome: "clippy",
    argumentos: (manifesto) => [
      "clippy",
      "--manifest-path",
      manifesto,
      "--all-targets",
      "--",
      "-D",
      "warnings",
    ],
  },
  {
    nome: "test",
    argumentos: (manifesto) => ["test", "--manifest-path", manifesto, "--locked"],
  },
];

function comandoSeco(binario, argumentos) {
  return [binario, ...argumentos].join(" ");
}

async function executarSeco(binario, argumentos, contexto) {
  const exec = spawnSync(binario, argumentos, {
    cwd: contexto.cwd,
    encoding: "utf8",
    env: contexto.env,
  });
  if (exec.error) {
    return { rc: 127, output: String(exec.error.message ?? exec.error) };
  }
  return {
    rc: exec.status ?? 1,
    output: `${exec.stdout ?? ""}${exec.stderr ?? ""}`.trimEnd(),
  };
}

async function imprimirSeco(binario, argumentos) {
  return { rc: 0, output: `$ ${comandoSeco(binario, argumentos)}` };
}

export async function runCrateGates(opcoes = {}) {
  const root = path.resolve(opcoes.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const dryRun = opcoes.dryRun ?? false;
  const binario = opcoes.binario ?? process.env.RDS_CARGO_BIN ?? "cargo";
  const executar =
    opcoes.runCommand ?? (dryRun ? imprimirSeco : executarSeco);

  const saidas = [];
  const falhas = [];
  const dizer = (linha) => saidas.push(linha);

  const caminhoRegistro = path.join(root, "crates", "registry.json");
  let registro;
  try {
    registro = JSON.parse(fs.readFileSync(caminhoRegistro, "utf8"));
  } catch {
    dizer(
      `REPROVADO: registro de pacotes ausente ou ilegivel em crates/registry.json (${caminhoRegistro})`,
    );
    return { rc: 1, saidas, falhas };
  }

  if (registro.schema !== SCHEMA_REGISTRO) {
    dizer(
      `REPROVADO: schema do registro inesperado (${String(registro.schema)}); esperado ${SCHEMA_REGISTRO}`,
    );
    return { rc: 1, saidas, falhas };
  }
  if (!Array.isArray(registro.pacotes)) {
    dizer("REPROVADO: registro sem campo `pacotes` como lista explícita");
    return { rc: 1, saidas, falhas };
  }
  if (registro.pacotes.length === 0) {
    dizer("OK: nenhum pacote registrado em crates/registry.json; nada a gate-ar.");
    return { rc: 0, saidas, falhas };
  }

  const env = { ...process.env };
  const cwd = root;
  if (!dryRun && !env.CARGO_TARGET_DIR) {
    env.CARGO_TARGET_DIR = path.join(root, "target", "crates-gates");
  }

  for (const pacote of registro.pacotes) {
    const nome = pacote && typeof pacote.nome === "string" ? pacote.nome : "";
    if (!nome) {
      falhas.push("pacote sem nome");
      dizer("REPROVADO: entrada de registro sem `nome`");
      continue;
    }
    const manifesto =
      pacote && typeof pacote.manifesto === "string" && pacote.manifesto.length > 0
        ? pacote.manifesto
        : `crates/${nome}/Cargo.toml`;
    const caminhoManifesto = path.join(root, ...manifesto.split("/"));
    if (!fs.existsSync(caminhoManifesto)) {
      falhas.push(`${nome} (manifesto ausente)`);
      dizer(
        `REPROVADO: ${nome}: pacote declarado no registro sem manifesto em ${manifesto} (um pacote esperado ausente reprova, nao e ignorado)`,
      );
      continue;
    }

    dizer(`--- ${nome} (${manifesto}) ---`);
    for (const gate of GATES) {
      const argumentos = gate.argumentos(manifesto);
      dizer(`$ ${comandoSeco(binario, argumentos)}`);
      const resultado = await executar(binario, argumentos, { cwd, env });
      if (resultado.output) {
        dizer(resultado.output);
      }
      if (resultado.rc !== 0) {
        falhas.push(`${nome} ${gate.nome}`);
        dizer(`REPROVADO: ${nome} ${gate.nome} (rc=${resultado.rc})`);
      } else {
        dizer(`OK: ${nome} ${gate.nome}`);
      }
    }
  }

  if (falhas.length > 0) {
    dizer("");
    dizer(`REPROVADO: ${falhas.length} gate(s) falharam: ${falhas.join(", ")}`);
    return { rc: 1, saidas, falhas };
  }
  dizer("");
  dizer(`OK: ${registro.pacotes.length} pacote(s) registrado(s), gates proprios aprovados.`);
  return { rc: 0, saidas, falhas };
}

async function main(argv) {
  const resultado = await runCrateGates({
    root: process.env.RDS_CRATES_ROOT ? path.resolve(process.env.RDS_CRATES_ROOT) : undefined,
    dryRun: argv.includes("--dry-run"),
  });
  for (const linha of resultado.saidas) {
    console.log(linha);
  }
  process.exitCode = resultado.rc;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
