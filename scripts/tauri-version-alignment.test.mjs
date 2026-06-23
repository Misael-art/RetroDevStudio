import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function npmMinor(versionRange) {
  const match = String(versionRange).match(/(\d+\.\d+)/);
  if (!match) {
    throw new Error(`Faixa npm sem major/minor reconhecivel: ${versionRange}`);
  }
  return match[1];
}

function cargoMinor(cargoToml, dependencyName) {
  const escapedName = dependencyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cargoToml.match(
    new RegExp(
      `^${escapedName}\\s*=\\s*(?:"([^"]+)"|\\{[^\\n}]*version\\s*=\\s*"([^"]+)")`,
      "m",
    ),
  );
  if (!match) {
    throw new Error(`Dependencia Rust sem versao explicita: ${dependencyName}`);
  }
  return npmMinor(match[1] ?? match[2]);
}

describe("Tauri package alignment", () => {
  it("keeps Rust Tauri minors aligned with the installed JavaScript packages", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    );
    const cargoToml = fs.readFileSync(
      path.join(repoRoot, "src-tauri", "Cargo.toml"),
      "utf8",
    );

    expect(cargoMinor(cargoToml, "tauri")).toBe(
      npmMinor(packageJson.dependencies["@tauri-apps/api"]),
    );
    expect(cargoMinor(cargoToml, "tauri-plugin-dialog")).toBe(
      npmMinor(packageJson.dependencies["@tauri-apps/plugin-dialog"]),
    );
  });
});
