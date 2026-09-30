//! CLI da MISSAO A: inventario, verificación e (máis adiante) exploración de
//! recursos. Sen dependencias: parsing de argumentos a man.
//!
//! Códigos de saída — parte do contrato, probados en `tests/cli.rs`:
//! - 0: todo conforme.
//! - 2: uso incorrecto ou subcomando non implementado (nunca finge resultado).
//! - 3: entrada ilegible (folla de proveniancia malformada).
//! - 4: falta un arquivo que a entrada anuncia, ou excede o límite declarado.
//! - 5: traballo feito pero con diverxencias medidas (manifesto parcial).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use rex_corpus::inventory::{inspect, inventory_json, parse_provenance, Item, Provenance};
use rex_corpus::json::render;

const LIMITE_BYTES: u64 = 16 * 1024 * 1024;

const USO: &str = "\
rex-corpus — ferramentas de corpus para REX (Misión A)

Uso: rex-corpus <subcomando> [opcións]

Subcomandos:
  inventario   --proveniencia FICHEIRO [--out FICHEIRO] [--max-bytes N]
               Le os bytes xa normalizados descritos pola folla de
               proveniancia e escribe o manifesto JSON versionado.
               Sen --out imprímeo en stdout.
  verificar    --proveniencia FICHEIRO [--max-bytes N]
               Mesma lectura, saída en verbos por fonte, sen JSON.
  scan         (non implementado) candidatos Kosinski por barrido acoutado.
  verify       (non implementado) aceite dun recurso contra referencia fixada.
  roundtrip    (non implementado) decode -> encode -> decode independente.

Códigos: 0 ok · 2 uso/non implementado · 3 entrada ilegible ·
4 arquivo ausente ou fora de límite · 5 diverxencias medidas.
";

fn opt(args: &[String], nome: &str) -> Option<String> {
    args.windows(2).find(|w| w[0] == nome).map(|w| w[1].clone())
}

/// Unha fila de proveniancia máis os bytes que describe.
struct Fonte {
    prov: Provenance,
    bytes: Vec<u8>,
}

/// Le a folla de proveniancia e despois cada arquivo que anuncia.
/// Calquera fallo de entrada aborta: non se escribe un manifesto falseiro.
fn ler_fontes(prov_path: &Path, max_bytes: u64) -> Result<Vec<Fonte>, (i32, String)> {
    let texto = std::fs::read_to_string(prov_path).map_err(|e| {
        (
            3,
            format!("ERRO: non podo ler {}: {e}", prov_path.display()),
        )
    })?;
    let mut fontes = Vec::new();
    for (i, liña) in texto.lines().enumerate() {
        let n = i + 1;
        if liña.trim().is_empty() || liña.starts_with("staged_sha256\t") || liña.starts_with('#')
        {
            continue;
        }
        let prov = parse_provenance(liña)
            .ok_or_else(|| (3, format!("ERRO: proveniancia liña {n} non parseable")))?;
        if !prov_path_parent_aceptable(&prov.staged_path) {
            return Err((4, format!("ERRO: camiño rexeitado na liña {n}")));
        }
        let meta = std::fs::metadata(&prov.staged_path).map_err(|e| {
            (
                4,
                format!("ERRO: non podo abrir {} (liña {n}): {e}", prov.staged_path),
            )
        })?;
        if meta.len() > max_bytes {
            return Err((
                4,
                format!(
                    "ERRO: {} ten {} bytes, excede o limite {} (liña {n})",
                    prov.staged_path,
                    meta.len(),
                    max_bytes
                ),
            ));
        }
        let bytes = std::fs::read(&prov.staged_path)
            .map_err(|e| (4, format!("ERRO: non podo ler {}: {e}", prov.staged_path)))?;
        fontes.push(Fonte { prov, bytes });
    }
    Ok(fontes)
}

/// A folla é a única fonte de camiños: rexeitamos `..` para non ler fóra da
/// área de traballo declarada.
fn prov_path_parent_aceptable(camiño: &str) -> bool {
    !camiño.is_empty() && !camiño.contains("/../") && !camiño.starts_with("../")
}

fn inspeccionar(fontes: &[Fonte]) -> Vec<Item> {
    fontes.iter().map(|f| inspect(&f.prov, &f.bytes)).collect()
}

fn max_bytes(args: &[String]) -> u64 {
    match opt(args, "--max-bytes") {
        Some(v) => v.parse::<u64>().unwrap_or(LIMITE_BYTES),
        None => LIMITE_BYTES,
    }
}

fn cmd_inventario(args: &[String]) -> i32 {
    let Some(prov_path) = opt(args, "--proveniencia") else {
        eprintln!("ERRO: inventario precisa --proveniencia FICHEIRO");
        return 2;
    };
    let fontes = match ler_fontes(Path::new(&prov_path), max_bytes(args)) {
        Ok(f) => f,
        Err((codigo, msg)) => {
            eprintln!("{msg}");
            return codigo;
        }
    };
    let items = inspeccionar(&fontes);
    let json = render(&inventory_json(&items, &prov_path));

    if let Some(out) = opt(args, "--out") {
        let destino = PathBuf::from(&out);
        if let Err(e) = std::fs::write(&destino, json.as_bytes()) {
            eprintln!("ERRO: non podo escribir {out}: {e}");
            return 4;
        }
    }
    let diverxentes = items.iter().filter(|i| i.diverxe()).count();
    eprintln!(
        "INVENTARIO esquema={} fontes={} divercentes={} ficheiro={}",
        rex_corpus::inventory::SCHEMA_INVENTARIO,
        items.len(),
        diverxentes,
        opt(args, "--out").unwrap_or_else(|| "-".to_string())
    );
    print!("{json}");
    let _ = std::io::stdout().flush();
    if diverxentes == 0 {
        0
    } else {
        5
    }
}

fn cmd_verificar(args: &[String]) -> i32 {
    let Some(prov_path) = opt(args, "--proveniencia") else {
        eprintln!("ERRO: verificar precisa --proveniencia FICHEIRO");
        return 2;
    };
    let fontes = match ler_fontes(Path::new(&prov_path), max_bytes(args)) {
        Ok(f) => f,
        Err((codigo, msg)) => {
            eprintln!("{msg}");
            return codigo;
        }
    };
    let items = inspeccionar(&fontes);
    let mut recusadas = 0usize;
    for item in &items {
        let nome = if item.prov.member == "-" {
            item.prov.container_rel.clone()
        } else {
            format!("{}::{}", item.prov.container_rel, item.prov.member)
        };
        if item.diverxe() {
            recusadas += 1;
            let motivo = item.refusada.clone().unwrap_or_else(|| {
                item.checks
                    .iter()
                    .filter(|c| !c.ok)
                    .map(|c| format!("{}:{}", c.nombre, c.detalle))
                    .collect::<Vec<_>>()
                    .join(" ")
            });
            println!("VERIFICO {nome} diverxencia {motivo}");
        } else {
            println!(
                "VERIFICO {nome} ok bytes={} sha256={} layout={}",
                item.bytes, item.sha256_medido, item.formato_normalizado
            );
        }
    }
    println!("RESUMO fontes={} recusadas={}", items.len(), recusadas);
    let _ = std::io::stdout().flush();
    if recusadas == 0 {
        0
    } else {
        5
    }
}

fn executar(args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        None => {
            eprintln!("{USO}");
            2
        }
        Some("--help") | Some("-h") => {
            print!("{USO}");
            0
        }
        Some("inventario") => cmd_inventario(&args[1..]),
        Some("verificar") => cmd_verificar(&args[1..]),
        Some(outro) => {
            eprintln!("ERRO: subcomando '{outro}' non implementado");
            2
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    ExitCode::from(executar(&args) as u8)
}
