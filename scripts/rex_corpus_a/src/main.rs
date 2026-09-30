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

/// Etiquetas de esquema das saidas de sondeo (versionadas como o manifesto).
const SCHEMA_MAGIA: &str = "rex-corpus-magia/v1";
const SCHEMA_CONSUMIDOR: &str = "rex-corpus-consumer/v1";

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
  scan         --imaxe FICHEIRO [--desde N] [--ata N] [--stride N]
               [--min-saida N] [--max-saida N] [--orzamento N]
               [--max-candidatos N] [--max-bytes N]
               Barrido acoutado en busca de fluxos Kosinski decodificables.
               Un candidato non e un recurso: só proba que nese offset o
               decoder acepta os bytes. A confirmación exige evidencia de
               consumidor ou vínculo estrutural independente.
  roundtrip    --imaxe FICHEIRO --offset N [--offset N ...]
               Pecha o ciclo do codec nun offset: decode -> encode -> decode
               independente, e compara os dous resultados por SHA-256.
               Non reinserta na ROM nin escribe ROM modificada.
  magia        --imaxe FICHEIRO [--max-por-secuencia N]
               Conta os marcadores de fluxo (KosM, KosP, EniM, 'GSS ', Unic).
               Unha conta a cero e a medida que autoriza dicir que o corpus
               non emprega esses contedores; non e un fallo da ferramenta.
  consumidor   --imaxe FICHEIRO --endereco N [--endereco N ...]
               [--desde N] [--ata N] [--max-referencias N] [--min-entradas N]
               Quen chama ese enderezo, quen o cita e se unha táboa de
               punteiros o contén. `vinculo=non` e un resultado medido.
  verify       (non implementado) aceite dun recurso contra referencia fixada.

Códigos: 0 ok · 2 uso/non implementado · 3 entrada ilegible ·
4 arquivo ausente ou fora de límite · 5 diverxencias medidas.
";

fn opt(args: &[String], nome: &str) -> Option<String> {
    args.windows(2).find(|w| w[0] == nome).map(|w| w[1].clone())
}

/// Todos os valores dunha opción repetible (`--offset N --offset M`).
fn opt_todos(args: &[String], nome: &str) -> Vec<String> {
    args.windows(2)
        .filter(|w| w[0] == nome)
        .map(|w| w[1].clone())
        .collect()
}

/// Carga a imaxe declarada por `--imaxe` dentro do límite de tamaño.
///
/// Calquera fallo de lectura imprime `non executado` e devolve o código 4: a
/// misión probe que unha imaxe BYOR ausente se declare como erro explícito,
/// nunca como teste aprobado.
fn ler_imaxe(args: &[String], camiño: &str) -> Result<Vec<u8>, i32> {
    let ruta = Path::new(camiño);
    let limite = max_bytes(args);
    let meta = match std::fs::metadata(ruta) {
        Err(e) => {
            eprintln!("ERRO: non executado :: non podo abrir {camiño}: {e}");
            return Err(4);
        }
        Ok(m) => m,
    };
    if meta.len() > limite {
        eprintln!(
            "ERRO: non executado :: {camiño} ten {} bytes, excede o límite {limite}",
            meta.len()
        );
        return Err(4);
    }
    match std::fs::read(ruta) {
        Ok(b) => Ok(b),
        Err(e) => {
            eprintln!("ERRO: non executado :: non podo ler {camiño}: {e}");
            Err(4)
        }
    }
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

/// Enteiro opcional cun defecto: un valor non parseable usa o defecto, nunca
/// aborta cunha cifra inventada.
fn num_opt(args: &[String], nome: &str, defecto: usize) -> usize {
    opt(args, nome)
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(defecto)
}

/// Barrido acoutado de candidatos Kosinski nunha imaxe.
///
/// Se a imaxe non está (BYOR ausente) declárase `non executado` con código 4:
/// a misión prohibe expresamente converter a ausencia nun pase.
fn cmd_scan(args: &[String]) -> i32 {
    let Some(camiño) = opt(args, "--imaxe") else {
        eprintln!("ERRO: scan precisa --imaxe FICHEIRO");
        return 2;
    };
    let bytes = match ler_imaxe(args, &camiño) {
        Ok(b) => b,
        Err(c) => return c,
    };

    let d = rex_corpus::scan::ScanLimits::DEFAULT;
    let limits = rex_corpus::scan::ScanLimits {
        from: num_opt(args, "--desde", d.from),
        to: opt(args, "--ata").and_then(|v| v.parse::<usize>().ok()),
        stride: num_opt(args, "--stride", d.stride),
        min_output: num_opt(args, "--min-saida", d.min_output),
        max_output: num_opt(args, "--max-saida", d.max_output),
        work_limit: num_opt(args, "--orzamento", d.work_limit),
        max_candidates: num_opt(args, "--max-candidatos", d.max_candidates),
    };
    let rep = rex_corpus::scan::scan(&bytes, &limits);
    let ata = limits.to.unwrap_or(bytes.len());

    println!(
        "SCAN esquema={} imaxe={camiño} bytes={} desde=0x{:05X} ata=0x{:05X} intentos={}",
        rex_corpus::scan::SCHEMA_SCAN,
        bytes.len(),
        limits.from,
        ata,
        rep.attempts
    );
    for c in &rep.candidates {
        println!(
            "CAND offset=0x{:05X} consumo={} saida={} sha256={}",
            c.offset, c.bytes_consumed, c.output_size, c.output_sha256
        );
    }
    println!(
        "negativas truncados={} referencias_imposibles={} saida_excesiva={} orzamento={} entrada_baleira={} abaixo_min={}",
        rep.refusals.truncated,
        rep.refusals.invalid_reference,
        rep.refusals.excessive_output,
        rep.refusals.work_limit,
        rep.refusals.empty_input,
        rep.refusals.below_min_output
    );
    println!(
        "RESUMO candidatos={} tope={}",
        rep.candidates.len(),
        if rep.truncated_by_limit {
            "acadado"
        } else {
            "non"
        }
    );
    let _ = std::io::stdout().flush();
    0
}

/// Unha pasada `decode -> encode -> decode` nun offset da imaxe.
struct Ciclo {
    /// Bytes producidos polo primeiro decode (0 se non decodifica).
    saida: usize,
    /// Bytes da imaxe consumidos polo primeiro decode.
    consumo: usize,
    /// Bytes do stream reescrito polo encoder.
    reescrito: usize,
    /// Bytes do segundo decode independente.
    recuperado: usize,
    /// SHA-256 da primeira saída; equalo á segunda é o que pecha o ciclo.
    saida_sha256: String,
    estado: &'static str,
    motivo: &'static str,
}

impl Ciclo {
    /// O tramo nese offset non é un fluxo: non hai nada que reescribir.
    fn non_decodifica(motivo: &'static str) -> Ciclo {
        Ciclo {
            saida: 0,
            consumo: 0,
            reescrito: 0,
            recuperado: 0,
            saida_sha256: "-".to_string(),
            estado: "non-decodifica",
            motivo,
        }
    }

    /// Pasada que si decodificou pero non devolve os mesmos bytes.
    fn aberta(
        primeiro: &rex_kosinski::KosDecoded,
        reescrito: Option<&[u8]>,
        saida_sha256: String,
        estado: &'static str,
        motivo: &'static str,
    ) -> Ciclo {
        Ciclo {
            saida: primeiro.output.len(),
            consumo: primeiro.bytes_consumed,
            reescrito: reescrito.map_or(0, <[u8]>::len),
            recuperado: 0,
            saida_sha256,
            estado,
            motivo,
        }
    }
}

/// Etiqueta curta do motivo: o relatório non debe depender do `Debug` interno.
fn motivo_decode(e: &rex_kosinski::KosError) -> &'static str {
    match e {
        rex_kosinski::KosError::Truncated => "fluxo-truncado",
        rex_kosinski::KosError::InvalidReference => "referencia-invalida",
        rex_kosinski::KosError::ExcessiveOutput => "saida-excesiva",
        rex_kosinski::KosError::WorkLimit => "orzamento-escosado",
        rex_kosinski::KosError::EmptyInput => "entrada-baleira",
    }
}

fn motivo_encode(e: &rex_kosinski::EncError) -> &'static str {
    match e {
        rex_kosinski::EncError::StreamLimit => "stream-limite",
        rex_kosinski::EncError::WorkLimit => "orzamento-escosado",
    }
}

/// Pecha o ciclo nun offset sen tocar a imaxe: o stream reescrito vive só en
/// memoria e tírase ao rematar a pasada.
///
/// Os tres estados significan cousas distintas e non se funden:
/// `non-decodifica` = nese offset non hai un fluxo Kosinski;
/// `non-reescribe` = si o hai, pero o encoder recúsao;
/// `non-pecha` = reescríbese e ao decodificalo obtemos outros bytes.
/// Fundilos convertería un defecto do códec nunha negativa do formato.
fn fechar_ciclo(imaxe: &[u8], offset: usize, max_output: usize, work_limit: usize) -> Ciclo {
    if offset >= imaxe.len() {
        return Ciclo::non_decodifica("offset-fora-da-imaxe");
    }
    let primeiro = match rex_kosinski::decode(&imaxe[offset..], max_output, work_limit) {
        Ok(d) => d,
        Err(e) => return Ciclo::non_decodifica(motivo_decode(&e)),
    };
    let saida_sha256 = rex_kosinski::edit::sha256_hex(&primeiro.output);

    let reescrito = match rex_kosinski::encode(&primeiro.output, max_output, work_limit) {
        Ok(enc) => enc.stream,
        Err(e) => {
            return Ciclo::aberta(
                &primeiro,
                None,
                saida_sha256,
                "non-reescribe",
                motivo_encode(&e),
            )
        }
    };

    let recuperado = match rex_kosinski::decode(&reescrito, max_output, work_limit) {
        Ok(d) => d.output,
        Err(e) => {
            return Ciclo::aberta(
                &primeiro,
                Some(&reescrito),
                saida_sha256,
                "non-pecha",
                motivo_decode(&e),
            )
        }
    };

    let recuperado_sha256 = rex_kosinski::edit::sha256_hex(&recuperado);
    let estado = if recuperado_sha256 == saida_sha256 {
        "ok"
    } else {
        "non-pecha"
    };
    Ciclo {
        saida: primeiro.output.len(),
        consumo: primeiro.bytes_consumed,
        reescrito: reescrito.len(),
        recuperado: recuperado.len(),
        saida_sha256,
        estado,
        motivo: if estado == "ok" {
            ""
        } else {
            "saida-diferente"
        },
    }
}

/// Ciclo do códec nos offsets pedidos.
///
/// Comproba o ciclo decode/encode/decode — non a reinserción segura: ningún
/// byte se escribe na imaxe e non se produce ROM modificada.
fn cmd_roundtrip(args: &[String]) -> i32 {
    let Some(camiño) = opt(args, "--imaxe") else {
        eprintln!("ERRO: roundtrip precisa --imaxe FICHEIRO");
        return 2;
    };
    let offsets: Vec<usize> = opt_todos(args, "--offset")
        .iter()
        .filter_map(|v| v.parse::<usize>().ok())
        .collect();
    if offsets.is_empty() {
        eprintln!("ERRO: roundtrip precisa polo menos un --offset N");
        return 2;
    }
    let imaxe = match ler_imaxe(args, &camiño) {
        Ok(b) => b,
        Err(c) => return c,
    };
    let defecto = rex_corpus::scan::ScanLimits::DEFAULT;
    let max_output = num_opt(args, "--max-saida", defecto.max_output);
    let work_limit = num_opt(args, "--orzamento", defecto.work_limit);

    println!(
        "ROUNDTRIP imaxe={camiño} bytes={} offsets={}",
        imaxe.len(),
        offsets.len()
    );
    let mut ciclos = 0usize;
    let mut diverxentes = 0usize;
    for offset in offsets {
        let c = fechar_ciclo(&imaxe, offset, max_output, work_limit);
        if c.estado == "ok" {
            ciclos += 1;
        } else {
            diverxentes += 1;
        }
        let motivo = if c.motivo.is_empty() {
            String::new()
        } else {
            format!(" motivo={}", c.motivo)
        };
        println!(
            "RT offset=0x{offset:05X} saida={} consumo={} reescrito={} recuperado={} saida_sha256={} ciclo={}{}",
            c.saida, c.consumo, c.reescrito, c.recuperado, c.saida_sha256, c.estado, motivo
        );
    }
    println!("RESUMO ciclos={ciclos} diverxentes={diverxentes}");
    let _ = std::io::stdout().flush();
    if diverxentes == 0 {
        0
    } else {
        5
    }
}

/// Sondeo de marcadores de fluxo nunha imaxe (BYOR).
///
/// O veredito di `sen-maxia-familiar` cando a conta é cero: é a medida que
/// autoriza a afirmar que este corpus non emprega os contedores marcados, e
/// non un fallo da ferramenta.
fn cmd_magia(args: &[String]) -> i32 {
    let Some(camiño) = opt(args, "--imaxe") else {
        eprintln!("ERRO: magia precisa --imaxe FICHEIRO");
        return 2;
    };
    let imaxe = match ler_imaxe(args, &camiño) {
        Ok(b) => b,
        Err(c) => return c,
    };
    let limits = rex_corpus::magia::MagiaLimits {
        max_por_secuencia: num_opt(
            args,
            "--max-por-secuencia",
            rex_corpus::magia::MagiaLimits::DEFAULT.max_por_secuencia,
        ),
    };
    let sondeo = rex_corpus::magia::contar(&imaxe, limits);
    println!(
        "MAXIA esquema={} imaxe={camiño} bytes={}",
        SCHEMA_MAGIA,
        imaxe.len()
    );
    for c in &sondeo.por_secuencia {
        let desprazamentos = if c.desprazamentos.is_empty() {
            "-".to_string()
        } else {
            c.desprazamentos
                .iter()
                .map(|o| format!("0x{o:05X}"))
                .collect::<Vec<_>>()
                .join(",")
        };
        println!(
            "SEQ {:<4} ocorrencias={} desprazamentos={} tope={}",
            c.secuencia,
            c.ocorrencias,
            desprazamentos,
            if c.tope_acadado { "acadado" } else { "non" }
        );
    }
    println!(
        "RESUMO maxias={} veredito={}",
        sondeo.total,
        if sondeo.total == 0 {
            "sen-maxia-familiar"
        } else {
            "maxia-familiar"
        }
    );
    let _ = std::io::stdout().flush();
    0
}

/// Evidencia estrutural dun enderezo: quen o chama, quen o cita e se hai unha
/// táboa de punteiros que o conteña.
///
/// Distinguimos `vinculo=si` de `vinculo=non` porque unha referencia de bytes
/// crú non abonda: `references_to` topa calquera patrón, dentro dunha táboa ou
/// dentro de datos. Só unha chamada real (`jsr`/`jmp`) ou unha entrada de
/// táboa ligada ao enderezo conta como vínculo, que é o que a misión exige
/// antes de chamar recurso a un fluxo.
fn cmd_consumidor(args: &[String]) -> i32 {
    let Some(camiño) = opt(args, "--imaxe") else {
        eprintln!("ERRO: consumidor precisa --imaxe FICHEIRO");
        return 2;
    };
    let enderezos: Vec<u32> = opt_todos(args, "--endereco")
        .iter()
        .filter_map(|v| v.parse::<u32>().ok())
        .collect();
    if enderezos.is_empty() {
        eprintln!("ERRO: consumidor precisa polo menos un --endereco N");
        return 2;
    }
    let imaxe = match ler_imaxe(args, &camiño) {
        Ok(b) => b,
        Err(c) => return c,
    };
    let desde = num_opt(args, "--desde", 0);
    let ata = opt(args, "--ata")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(imaxe.len());
    let max_ref = num_opt(args, "--max-referencias", 64);
    let min_entradas = num_opt(args, "--min-entradas", 3);

    println!(
        "CONSUMIDOR esquema={} imaxe={camiño} bytes={} xanela=0x{desde:05X}..0x{ata:05X}",
        SCHEMA_CONSUMIDOR,
        imaxe.len()
    );
    let mut vinculados = 0usize;
    let mut sen_vinculo = 0usize;
    for addr in enderezos {
        let chamadas = rex_corpus::consumer::call_sites(&imaxe, desde, ata, usize::MAX)
            .into_iter()
            .filter(|s| s.target == addr)
            .take(max_ref)
            .collect::<Vec<_>>();
        let referencias = rex_corpus::consumer::references_to(&imaxe, addr, max_ref);
        let taboas = rex_corpus::consumer::tables_for(&imaxe, &[addr], min_entradas, 16);
        let vincula = !chamadas.is_empty() || !taboas.is_empty();
        if vincula {
            vinculados += 1;
        } else {
            sen_vinculo += 1;
        }
        println!(
            "ENDERESO 0x{addr:05X} referencias={} chamadas={} taboas={} vinculo={}",
            referencias.len(),
            chamadas.len(),
            taboas.len(),
            if vincula { "si" } else { "non" }
        );
        for r in &referencias[..referencias.len().min(8)] {
            println!("REF offset=0x{:05X} operando=0x{:05X}", r.offset, r.operand);
        }
        for s in &chamadas {
            let opcode = &imaxe[s.offset..s.offset + 2];
            println!(
                "CHAMADA offset=0x{:05X} destino=0x{:05X} opcode={:02X}{:02X}",
                s.offset, s.target, opcode[0], opcode[1]
            );
        }
        for t in &taboas {
            println!(
                "TABOA base=0x{:05X} entradas={} primeiro=0x{:05X} crecente={}",
                t.base_offset,
                t.entries,
                t.values.first().copied().unwrap_or(0),
                if t.ascending { "si" } else { "non" }
            );
        }
    }
    println!(
        "RESUMO enderezos={} vinculados={} sen_vinculo={}",
        vinculados + sen_vinculo,
        vinculados,
        sen_vinculo
    );
    let _ = std::io::stdout().flush();
    0
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
        Some("scan") => cmd_scan(&args[1..]),
        Some("roundtrip") => cmd_roundtrip(&args[1..]),
        Some("magia") => cmd_magia(&args[1..]),
        Some("consumidor") => cmd_consumidor(&args[1..]),
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
