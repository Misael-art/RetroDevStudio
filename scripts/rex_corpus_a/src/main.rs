//! CLI da MISSAO A: inventario, verificación e (máis adiante) exploración de
//! recursos. Sen dependencias: parsing de argumentos a man.
//!
//! Códigos de saída — parte do contrato, probados en `tests/cli.rs`:
//! - 0: todo conforme.
//! - 2: uso incorrecto ou subcomando non implementado (nunca finge resultado).
//! - 3: entrada ilegible (folla de proveniancia malformada).
//! - 4: falta un arquivo que a entrada anuncia, ou excede o límite declarado.
//! - 5: traballo feito pero con diverxencias medidas (manifesto parcial).
//! - 6: aceite incompleto — habería fluxo que non se puido executar (sen
//!   ficherio de agardo). Distinto de 5: aquí non hai medida, falta.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use rex_corpus::inventory::{inspect, inventory_json, parse_provenance, Item, Provenance};
use rex_corpus::json::render;
use rex_corpus::spec::{negativo_de, token_declarado};

const LIMITE_BYTES: u64 = 16 * 1024 * 1024;

/// Etiquetas de esquema das saidas de sondeo (versionadas como o manifesto).
const SCHEMA_MAGIA: &str = "rex-corpus-magia/v1";
/// v2: `ENDERESO` leva `cargas=` e aparecen as liñas `CARGA` (Fase 4).
const SCHEMA_CONSUMIDOR: &str = "rex-corpus-consumer/v2";

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
               [--ventanxa-chamada N]
               Quen chama ese enderezo, quen o cita, se unha táboa de punteiros
               o contén e se é o operando dun `lea abs.l,An` (así chega un fluxo
               á súa rutina; a chamada vai á rutina, non ao fluxo). `vinculo=non`
               e un resultado medido.
  verify       --referencia DIR [--max-saida N] [--orzamento N]
               [--limite-negativos N] [--max-bytes N]
               Aceite do noso camiño de consumo contra fixtures autorais
               (golden/ plain/ negative/). Non le ROMs nin escribe bytes.
               Se un negative ten a súa declaración lateral
               (<nome>.expected.json), compróbase a razón de rexeito, o seu
               max_out e a lonxitude de entrada declarada; sen declaración
               só se rexistra o rexeito (`declarado=ningún`).
               Un fluxo sen ficherio de agardo declárase `non executado`
               (código 6): a misión prohibe que a ausencia sexa un pase.

Códigos: 0 ok · 2 uso/non implementado · 3 entrada ilegible ·
4 arquivo ausente ou fora de límite · 5 diverxencias medidas ·
6 aceite incompleto (hai fluxo sen executar).
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

/// Evidencia estrutural dun enderezo: quen o chama, quen o cita, se hai unha
/// táboa de punteiros que o conteña e se é o operando dunha carga absoluta
/// longa.
///
/// Distinguimos `vinculo=si` de `vinculo=non` porque unha referencia de bytes
/// crú non abonda: `references_to` topa calquera patrón, dentro dunha táboa ou
/// dentro de datos. Contan como vínculo unha chamada real (`jsr`/`jmp`), unha
/// entrada de táboa ligada ao enderezo, ou que o enderezo sexa o operando dun
/// `lea abs.l,An` — a forma pola que case todos os xogos entregan o fluxo á
/// rutina de descompresión, e que `call_sites` non ve porque a chamada apunta á
/// rutina. É o que a misión exige antes de chamar recurso a un fluxo.
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
    let ventanxa = num_opt(args, "--ventanxa-chamada", 16);

    println!(
        "CONSUMIDOR esquema={} imaxe={camiño} bytes={} xanela=0x{desde:05X}..0x{ata:05X}",
        SCHEMA_CONSUMIDOR,
        imaxe.len()
    );
    let todas_cargas = rex_corpus::consumer::cargas_abs_l(&imaxe, desde, ata, usize::MAX);
    let todas_chamadas = rex_corpus::consumer::call_sites(&imaxe, desde, ata, usize::MAX);
    let mut vinculados = 0usize;
    let mut sen_vinculo = 0usize;
    let mut cargas_totais = 0usize;
    for addr in enderezos {
        let chamadas = todas_chamadas
            .iter()
            .filter(|s| s.target == addr)
            .take(max_ref)
            .cloned()
            .collect::<Vec<_>>();
        let referencias = rex_corpus::consumer::references_to(&imaxe, addr, max_ref);
        let taboas = rex_corpus::consumer::tables_for(&imaxe, &[addr], min_entradas, 16);
        let cargas = todas_cargas
            .iter()
            .filter(|c| c.operando == addr)
            .take(max_ref)
            .cloned()
            .collect::<Vec<_>>();
        let vincula = !chamadas.is_empty() || !taboas.is_empty() || !cargas.is_empty();
        if vincula {
            vinculados += 1;
        } else {
            sen_vinculo += 1;
        }
        cargas_totais += cargas.len();
        println!(
            "ENDERESO 0x{addr:05X} referencias={} chamadas={} taboas={} cargas={} vinculo={}",
            referencias.len(),
            chamadas.len(),
            taboas.len(),
            cargas.len(),
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
        for c in &cargas {
            // A chamada relevante é a primeira que segue á carga dentro da
            // ventanxa: é o que pasa o fluxo á rutina. Mídese, non se supone.
            let desde_chamada = c.offset + 6;
            let ate_chamada = desde_chamada + ventanxa;
            let chamada = todas_chamadas
                .iter()
                .find(|s| s.offset >= desde_chamada && s.offset <= ate_chamada);
            match chamada {
                Some(s) => println!(
                    "CARGA offset=0x{:05X} rexistro=A{} operando=0x{:05X} chamada=0x{:05X} destino=0x{:05X}",
                    c.offset, c.registro, c.operando, s.offset, s.target
                ),
                None => println!(
                    "CARGA offset=0x{:05X} rexistro=A{} operando=0x{:05X} chamada=ningunha destino=ningunha",
                    c.offset, c.registro, c.operando
                ),
            }
        }
    }
    println!(
        "RESUMO enderezos={} vinculados={} sen_vinculo={} cargas={}",
        vinculados + sen_vinculo,
        vinculados,
        sen_vinculo,
        cargas_totais
    );
    let _ = std::io::stdout().flush();
    0
}

/// Etiqueta de esquema do sondeo de aceptacion (Fase 3).
const SCHEMA_VERIFICACION: &str = "rex-corpus-verify/v1";

/// Lista ordenada e determinista dos `*.kos` dun subdirectorio de referencia.
fn fluxos_de_referencia(raiz: &Path, sub: &str) -> Vec<(String, PathBuf)> {
    let directorio = raiz.join(sub);
    let Ok(lectura) = std::fs::read_dir(&directorio) else {
        return Vec::new();
    };
    let mut nomes: Vec<(String, PathBuf)> = lectura
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "kos").unwrap_or(false))
        .filter_map(|p| {
            let nome = p.file_stem()?.to_string_lossy().into_owned();
            Some((nome, p))
        })
        .collect();
    nomes.sort();
    nomes
}

/// Lee un ficheiro de referencia dentro do límite declarado.
fn ler_referencia(ruta: &Path, max_bytes: u64) -> Result<Vec<u8>, i32> {
    let meta = match std::fs::metadata(ruta) {
        Ok(m) => m,
        Err(e) => {
            eprintln!(
                "ERRO: non executado :: non podo abrir {}: {e}",
                ruta.display()
            );
            return Err(4);
        }
    };
    if meta.len() > max_bytes {
        eprintln!(
            "ERRO: non executado :: {} ten {} bytes, excede o límite {max_bytes}",
            ruta.display(),
            meta.len()
        );
        return Err(4);
    }
    match std::fs::read(ruta) {
        Ok(b) => Ok(b),
        Err(e) => {
            eprintln!(
                "ERRO: non executado :: non podo ler {}: {e}",
                ruta.display()
            );
            Err(4)
        }
    }
}

/// Aceite do noso camiño de consumo contra a referencia fixada.
///
/// A referencia son fixtures **autorais** (as `golden/`, `plain/` e `negative/`
/// do paquete `rex-kosinski`): non se leen ROMs nin bytes comerciais, e non se
/// duplica o códec — consómese `decode`/`encode` fixados. Tres resultados
/// distínguense e non se funden:
/// - `ok`: a saída medida coincide hash con hash coa expectativa;
/// - `diverxencia`: non coincide, ou un negativo si decodifica;
/// - `sen-expectativa`: a referencia non ten arquivo de agardo para ese fluxo
///   (é o caso contractual do `m02`, `Truncated`). Non se conta como pase:
///   un campo non medido queda explícito no resumo.
///
/// Os negativos execútanse co límite apertado (`limite_negativos`, defecto 16)
/// porque a propia referencia documenta que `k05` é un fluxo **ben formado**
/// cuxa recusa é obrigación do produto: sen ese contexto, «decodificou» sería
/// un falso defecto.
fn cmd_verify(args: &[String]) -> i32 {
    let Some(dir) = opt(args, "--referencia") else {
        eprintln!("ERRO: verify precisa --referencia DIR");
        return 2;
    };
    let raiz = Path::new(&dir);
    if !raiz.is_dir() {
        eprintln!("ERRO: non executado :: non podo abrir o directorio de referencia {dir}");
        return 4;
    }
    let tope_bytes = max_bytes(args);
    let defecto = rex_corpus::scan::ScanLimits::DEFAULT;
    let max_output = num_opt(args, "--max-saida", defecto.max_output);
    let work_limit = num_opt(args, "--orzamento", defecto.work_limit);
    let limite_negativos = num_opt(args, "--limite-negativos", 16);

    println!(
        "VERIFICO esquema={SCHEMA_VERIFICACION} referencia={dir} max_saida={max_output} orzamento={work_limit} limite_negativos={limite_negativos}"
    );

    let mut golden = 0usize;
    let mut plain = 0usize;
    let mut negative = 0usize;
    let mut ok = 0usize;
    let mut ok_rexeitado = 0usize;
    let mut sen_expectativa = 0usize;
    let mut diverxentes = 0usize;

    for (nome, ruta) in fluxos_de_referencia(raiz, "golden") {
        golden += 1;
        let bytes = match ler_referencia(&ruta, tope_bytes) {
            Ok(b) => b,
            Err(c) => return c,
        };
        let esperado_ruta = raiz.join("golden").join(format!("{nome}.expected.bin"));
        let esperado = match std::fs::read(&esperado_ruta) {
            Ok(e) => e,
            Err(_) => {
                sen_expectativa += 1;
                println!(
                    "GOLDEN {nome} bytes_in={} resultado=sen-expectativa motivo=sen-ficheiro-de-agardo",
                    bytes.len()
                );
                continue;
            }
        };
        let sha_esperado = rex_kosinski::edit::sha256_hex(&esperado);
        match rex_kosinski::decode(&bytes, max_output, work_limit) {
            Err(e) => {
                diverxentes += 1;
                println!(
                    "GOLDEN {nome} bytes_in={} medido=- esperado={sha_esperado} resultado=diverxencia motivo={}",
                    bytes.len(),
                    motivo_decode(&e)
                );
            }
            Ok(d) => {
                let medido = rex_kosinski::edit::sha256_hex(&d.output);
                if medido == sha_esperado {
                    ok += 1;
                    println!(
                        "GOLDEN {nome} bytes_in={} consumo={} saida={} sha256={medido} esperado={sha_esperado} resultado=ok",
                        bytes.len(),
                        d.bytes_consumed,
                        d.output.len()
                    );
                } else {
                    diverxentes += 1;
                    println!(
                        "GOLDEN {nome} bytes_in={} consumo={} saida={} medido={medido} esperado={sha_esperado} resultado=diverxencia motivo=saida-diferente",
                        bytes.len(),
                        d.bytes_consumed,
                        d.output.len()
                    );
                }
            }
        }
    }

    for (nome, ruta) in fluxos_de_referencia(raiz, "plain") {
        plain += 1;
        let bytes = match ler_referencia(&ruta, tope_bytes) {
            Ok(b) => b,
            Err(c) => return c,
        };
        let esperado_ruta = raiz.join("plain").join(format!("{nome}.bin"));
        let esperado = match std::fs::read(&esperado_ruta) {
            Ok(e) => e,
            Err(_) => {
                sen_expectativa += 1;
                println!(
                    "PLAIN {nome} bytes_in={} resultado=sen-expectativa motivo=sen-ficheiro-de-agardo",
                    bytes.len()
                );
                continue;
            }
        };
        let sha_esperado = rex_kosinski::edit::sha256_hex(&esperado);
        let decodificado = match rex_kosinski::decode(&bytes, max_output, work_limit) {
            Ok(d) => d,
            Err(e) => {
                diverxentes += 1;
                println!(
                    "PLAIN {nome} bytes_in={} medido=- esperado={sha_esperado} resultado=diverxencia motivo={}",
                    bytes.len(),
                    motivo_decode(&e)
                );
                continue;
            }
        };
        let medido = rex_kosinski::edit::sha256_hex(&decodificado.output);
        let ciclo = fechar_ciclo(&bytes, 0, max_output, work_limit);
        let coincide = medido == sha_esperado;
        let resultado = if coincide && ciclo.estado == "ok" {
            ok += 1;
            "ok"
        } else {
            diverxentes += 1;
            "diverxencia"
        };
        println!(
            "PLAIN {nome} bytes_in={} consumo={} saida={} sha256={medido} esperado={sha_esperado} ciclo={} resultado={resultado}",
            bytes.len(),
            decodificado.bytes_consumed,
            decodificado.output.len(),
            ciclo.estado
        );
    }

    for (nome, ruta) in fluxos_de_referencia(raiz, "negative") {
        negative += 1;
        let bytes = match ler_referencia(&ruta, tope_bytes) {
            Ok(b) => b,
            Err(c) => return c,
        };
        // A referencia declara tamén *por que* debe ser rexeitado o vector e
        // cal é o seu límite de saída. Comprobar só «deu erro» aceptaría un
        // decoder que falla polo motivo equivocado.
        let lateral = raiz.join("negative").join(format!("{nome}.expected.json"));
        let declarado = std::fs::read_to_string(&lateral)
            .ok()
            .map(|t| negativo_de(&t));
        let tope = declarado
            .as_ref()
            .and_then(|d| d.max_out)
            .unwrap_or(limite_negativos);
        let etiqueta = declarado.as_ref().and_then(|d| d.expected_error.clone());
        let lonxitude_declarada = declarado.as_ref().and_then(|d| d.stream_len);
        let mut campos = vec![
            format!("bytes_in={}", bytes.len()),
            format!("max_out={tope}"),
            format!(
                "declarado={}",
                etiqueta.clone().unwrap_or_else(|| "ningún".into())
            ),
        ];
        if let Some(m) = declarado.as_ref().and_then(|d| d.mirror_condition.clone()) {
            campos.push(format!("espello={m}"));
        }

        let resultado: &'static str;
        let motivo: &'static str;
        let lonxitude_trocada = lonxitude_declarada.filter(|n| *n != bytes.len());
        if let Some(n) = lonxitude_trocada {
            // Non son os bytes que a referencia describe: discutir a razón de
            // rexeito sobre outro fluxo sería encher un campo cunha estimación.
            campos.push(format!("declarado_len={n} medido={}", bytes.len()));
            resultado = "diverxencia";
            motivo = "lonxitude-declarada-diferente";
        } else {
            match rex_kosinski::decode(&bytes, tope, work_limit) {
                Ok(d) => {
                    campos.push(format!("medido=- saida={}", d.output.len()));
                    resultado = "diverxencia";
                    motivo = "decodificou";
                }
                Err(e) => {
                    let medido = motivo_decode(&e);
                    campos.push(format!("medido={medido}"));
                    let esperado = etiqueta.as_deref().and_then(token_declarado);
                    match esperado {
                        Some(agardado) if agardado == medido => {
                            resultado = "rexeitado";
                            motivo = medido;
                        }
                        Some(agardado) => {
                            campos.push(format!("esperado={agardado}"));
                            resultado = "diverxencia";
                            motivo = "motivo-diferente";
                        }
                        None if etiqueta.is_some() => {
                            resultado = "diverxencia";
                            motivo = "etiqueta-declarada-descoecida";
                        }
                        None => {
                            resultado = "rexeitado";
                            motivo = "sen-declaracion";
                        }
                    }
                }
            }
        }
        if resultado == "rexeitado" {
            ok_rexeitado += 1;
        } else {
            diverxentes += 1;
        }
        campos.push(format!("resultado={resultado} motivo={motivo}"));
        println!("NEGATIVE {nome} {}", campos.join(" "));
    }

    println!(
        "RESUMO golden={golden} plain={plain} negative={negative} ok={ok} rexeitado={ok_rexeitado} sen_expectativa={sen_expectativa} diverxentes={diverxentes}"
    );
    let _ = std::io::stdout().flush();
    if diverxentes > 0 {
        5
    } else if sen_expectativa > 0 {
        // Un fluxo sen agardo non executouse: non pode herdar o verde dos que si.
        eprintln!(
            "ERRO: non executado :: {sen_expectativa} fluxo(s) de referencia sen ficherio de agardo; aceite incompleto, non un pase"
        );
        6
    } else {
        0
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
        Some("scan") => cmd_scan(&args[1..]),
        Some("roundtrip") => cmd_roundtrip(&args[1..]),
        Some("magia") => cmd_magia(&args[1..]),
        Some("consumidor") => cmd_consumidor(&args[1..]),
        Some("verify") => cmd_verify(&args[1..]),
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
