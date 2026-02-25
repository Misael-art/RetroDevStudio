#!/usr/bin/env node
/**
 * check-tree.js - Valida a árvore de diretórios conforme docs/08_TREE_ARCHITECTURE.md
 * Uso: node scripts/check-tree.js (execute na raiz do projeto)
 * Cross-platform (Node.js).
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const allowedDirs = ["docs", "src", "src-tauri", "toolchains", "scripts"];
const ignoreDirs = [".git", "node_modules", "target", "dist", ".cursor", ".vscode", ".claude"];

if (!fs.existsSync(path.join(root, "docs", "08_TREE_ARCHITECTURE.md"))) {
  console.error("ERRO: Execute este script na raiz do repositório RetroDev Studio (onde está a pasta docs).");
  process.exit(1);
}

const entries = fs.readdirSync(root, { withFileTypes: true });
const invalid = entries
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((name) => !allowedDirs.includes(name) && !ignoreDirs.includes(name));

if (invalid.length > 0) {
  console.error("ERRO: Diretórios na raiz que não estão em docs/08_TREE_ARCHITECTURE.md:");
  invalid.forEach((d) => console.error("  -", d));
  console.error("Diretórios permitidos na raiz:", allowedDirs.join(", "));
  console.error("Consulte docs/08_TREE_ARCHITECTURE.md antes de criar pastas.");
  process.exit(1);
}

console.log("OK: Estrutura da raiz conforme docs/08_TREE_ARCHITECTURE.md.");
process.exit(0);
