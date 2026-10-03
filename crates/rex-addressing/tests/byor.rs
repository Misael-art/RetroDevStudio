//! Evidencia cunha imaxe **real** (BYOR), non cun fixture.
//!
//! Política do corpus (inventario `corpus-inventory-2026-09-25.json`, fase 3):
//! 256 ficheiros, **unha soa ROM crua** — `Sonic the Hedgehog (USA, Europe).bin`
//! — e o resto son arquivos comprimidos. A política é lectura dirixida: `roms_copied:
//! false`, `extraction_performed: false`. Polo tanto:
//!
//!  * só `md-linear` e `md-ssf2` poden confrontarse cunha imaxe real;
//!  * `snes-lorom`, `snes-hirom` e `snes-exhirom` seguen **só-fixture**: extraer
//!    un `.sfc` dun `.7z` sería crear inventario, e o contrato non o autoriza.
//!
//! Os tests van con `#[ignore]` porque BYOR **non é unha dependencia
//! provisionable**: `cargo test` non debe baixar nin buscar ROMs. Execútese con
//! `cargo test --release --offline --test byor -- --ignored --nocapture`. Se o
//! ficheiro falta ou non bate a súa identidade, os tests **fallan**: un test que
//! non executou non pode rexistrarse como PASS.
//!
//! As expectativas deste ficheiro veñen do caso real auditado da fase 3
//! (`data/rex_profiles/addressing/md-linear/evidence/real-case.json`, no
//! workspace irmán `RDS-REX-A-addressing@dbdc122`), non da implementación Rust.

mod support;

use rex_addressing::{md_linear, md_ssf2, MapperState, Region, Segment, Translate};
use support::sha256::sha256_hex;

const ROM_PATH: &str = "/home/misael/emulation/roms/genesis/Sonic the Hedgehog (USA, Europe).bin";
const ROM_SHA256: &str = "c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb";
const FILE_BYTES: u64 = 531_577;
/// Imaxe ROM medida: os primeiros 512KB. O resto do ficheiro é apéndice.
const IMAGE_BYTES: usize = 0x80_000;
/// Marca humana do apéndice de ferramenta que vai despois da imaxe.
const APPENDIX_MARK: &[u8] = b"ESE_S1_TC_V_2.00";
/// Banner real en `$100` (16 bytes) e a súa SHA-256, pinadas na fase 3.
const BANNER: &[u8] = b"SEGA MEGA DRIVE ";
const BANNER_SHA256: &str = "3894a7c19a857f4fcd9d04ed504326f35e2742f11fa89c0c36ee78cd3d22e4e8";

/// Ler a imaxe real **coa súa identidade comprobada**. A ausencia ou o desaxuste
/// fan `panic` con mensaxe explícita: aquí non existe o "skip silencioso".
fn read_file() -> Vec<u8> {
    let bytes = std::fs::read(ROM_PATH).unwrap_or_else(|e| {
        panic!(
            "BYOR non presente en {ROM_PATH} ({e}): este test NON executou e non pode \
             rexistrarse como PASS. O corpus BYOR non é provisionable; rexistre o bloqueio."
        )
    });
    assert_eq!(
        bytes.len() as u64,
        FILE_BYTES,
        "tamaño do ficheiro real distinto do inventariado"
    );
    assert_eq!(
        sha256_hex(&bytes),
        ROM_SHA256,
        "SHA-256 do ficheiro real non bate coa identidade pinada: a evidência \
         estaríase a sacar sobre outro arquivo"
    );
    bytes
}

fn image() -> Vec<u8> {
    read_file()[..IMAGE_BYTES].to_vec()
}

fn state() -> MapperState {
    MapperState::rom_size(u64::try_from(IMAGE_BYTES).expect("512KB"))
}

/// Identidade e normalización: o ficheiro non é a imaxe.
#[test]
#[ignore = "BYOR non provisionable: executar con --ignored"]
fn a_imaxe_real_mide_512kb_e_o_resto_e_apendice_non_direccionable() {
    let bytes = read_file();
    let tail = &bytes[IMAGE_BYTES..];
    assert_eq!(
        tail.len(),
        7289,
        "apendice medido na fase 3: 531577 - 0x80000"
    );
    assert!(
        tail.windows(APPENDIX_MARK.len())
            .any(|w| w == APPENDIX_MARK),
        "o apendice de ferramenta debe conter a marca humana `{}`; se non aparece, \
         o ficheiro cambiou",
        String::from_utf8_lossy(APPENDIX_MARK)
    );
    // O hash do ficheiro completo e o da imaxe son distintos: son dous obxectos.
    assert_ne!(sha256_hex(&bytes), sha256_hex(&bytes[..IMAGE_BYTES]));
    println!(
        "identidade OK: ficheiro {FILE_BYTES} B sha={}… , imaxe {IMAGE_BYTES:#x} B sha={}…",
        &ROM_SHA256[..8],
        &sha256_hex(&bytes[..IMAGE_BYTES])[..8]
    );
}

/// `tamaño do ficheiro != mapa`. Unha ferramenta que usase `531577` como
/// `rom_size` obtería un estado rexeitado, non un espello implícito.
#[test]
#[ignore = "BYOR non provisionable: executar con --ignored"]
fn o_tamanho_do_ficheiro_non_e_un_estado_valido() {
    let bruto = MapperState::rom_size(FILE_BYTES);
    for perfil in ["md-linear", "md-ssf2"] {
        let erro = match perfil {
            "md-linear" => md_linear::validate_state(&bruto).unwrap_err(),
            _ => md_ssf2::validate_state(&bruto).unwrap_err(),
        };
        assert_eq!(
            erro.code,
            rex_addressing::ErrorCode::Unsupported,
            "{perfil}: 531577 non é potencia de 2"
        );
        // E `translate` non inventa un offset: devolve Invalid.
        let got = match perfil {
            "md-linear" => md_linear::translate(0x100, &bruto),
            _ => md_ssf2::translate(0x100, &bruto),
        };
        assert!(
            matches!(got, Translate::Invalid(_)),
            "{perfil}: {got:?} — un tamaño irregular non pode dar Rom"
        );
    }
    // Co tamaño normalizado, o mesmo enderezo si e ROM.
    assert_eq!(
        md_linear::translate(0x100, &state()),
        Translate::Rom { offset: 0x100 }
    );
}

/// As sete mostras do caso real auditado na fase 3 (`sample_vectors`).
#[test]
#[ignore = "BYOR non provisionable: executar con --ignored"]
fn as_mostras_pinadas_do_caso_real_retraducen_igual() {
    // 0x3ffff0 % 0x80000 = 0x7fff0 = 524272; 0x23456 = 144470 (comprobado a man).
    const MOSTRAS: [(u32, u32); 7] = [
        (0x000000, 0),
        (0x000100, 256),
        (0x008000, 32768),
        (0x023456, 144470),
        (0x07ffd8, 524248),
        (0x080000, 0),
        (0x3ffff0, 524272),
    ];
    let st = state();
    for (addr, offset) in MOSTRAS {
        assert_eq!(
            md_linear::translate(addr, &st),
            Translate::Rom { offset },
            "mostra do caso real {addr:#x}"
        );
    }
}

/// Bytes reais: o perfil debe alcanzar o banner ASCII onde o case real di que
/// está, e o hash de 16 bytes pinado na fase 3 debe reproducirse.
#[test]
#[ignore = "BYOR non provisionable: executar con --ignored"]
fn o_banner_real_alcanzase_na_posicion_declarada() {
    let rom = image();
    let segs = md_linear::read(0x000100, 16, &state(), &rom).expect("lectura do banner");
    assert_eq!(
        segs.len(),
        1,
        "banner dentro dun corredor continuo: un só segmento, atopado {segs:?}"
    );
    let Segment::Bytes {
        region,
        offset,
        bytes,
    } = &segs[0]
    else {
        panic!("esperábase Bytes, atopado {:?}", segs[0]);
    };
    assert_eq!((*region, *offset), (Region::Rom, 0x100));
    assert_eq!(
        bytes.as_slice(),
        BANNER,
        "banner real lido a traves do perfil"
    );
    assert_eq!(
        sha256_hex(bytes),
        BANNER_SHA256,
        "o excerpt de $100 non reproduce a SHA pinada na fase 3"
    );
    println!("banner real verificado por contido e por SHA-256");
}

/// Propiedade de inversión sobre contido real: **tódolos** aliases dun offset
/// devolven os mesmos bytes que a imaxe nese offset. A comparación é contra o
/// ficheiro, non contra a fórmula do perfil.
#[test]
#[ignore = "BYOR non provisionable: executar con --ignored"]
fn cada_alias_da_imaxe_real_devolve_os_mesmos_bytes() {
    let rom = image();
    let st = state();
    let mut offsets = 0usize;
    let mut alias_reads = 0usize;
    let mut offset = 0u32;
    while offset < IMAGE_BYTES as u32 {
        let aliases = md_linear::invert(offset, &st).expect("invert nun offset real");
        assert_eq!(
            aliases.len(),
            8,
            "xanela do cartucho 4MB / espello 512KB = 8 aliases en {offset:#x}"
        );
        for addr in aliases {
            let segs = md_linear::read(addr, 8, &st, &rom).expect("lectura do alias");
            let Segment::Bytes { bytes, .. } = &segs[0] else {
                panic!("alias {addr:#x} de {offset:#x}: esperado Bytes, {segs:?}");
            };
            let want = &rom[offset as usize..offset as usize + 8];
            assert_eq!(
                bytes.as_slice(),
                want,
                "alias {addr:#x} do offset {offset:#x} non devolve os bytes reais"
            );
            alias_reads += 1;
        }
        offsets += 1;
        offset += 0x155;
    }
    assert!(
        offsets >= 900 && alias_reads >= 7200,
        "mostragem demasiado pequena para ser evidencia: {offsets}/{alias_reads}"
    );
    println!("inversión real: {offsets} offsets, {alias_reads} lecturas de alias, 0 desaxustes");
}

/// O apéndice do ficheiro **non é direccionable**: cargando o ficheiro cru
/// completo como `rom`, o espello polo tamaño normalizado nunca saca bytes da
/// cola. Esta é a diferenza entre "imaxe" e "arquivo".
#[test]
#[ignore = "BYOR non provisionable: executar con --ignored"]
fn cargando_o_ficheiro_cru_o_apendice_sigue_inalcanzable() {
    let bruto = read_file();
    let st = state();
    let mut addr = 0u32;
    let mut lecturas = 0usize;
    while addr <= md_linear::CART_WINDOW_END {
        for seg in md_linear::read(addr, 16, &st, &bruto).expect("lectura") {
            if let Segment::Bytes { offset, bytes, .. } = &seg {
                assert!(
                    u64::from(*offset) + bytes.len() as u64 <= IMAGE_BYTES as u64,
                    "offset {offset:#x} + {} bytes sae da imaxe de 512KB",
                    bytes.len()
                );
                assert!(
                    !bytes
                        .windows(APPENDIX_MARK.len())
                        .any(|w| w == APPENDIX_MARK),
                    "apareceu a marca do apendice en {offset:#x}: o perfil leu a cola do arquivo"
                );
                lecturas += 1;
            }
        }
        addr += 0x1041;
    }
    assert!(
        lecturas >= 1000,
        "barrido demasiado curto para ser evidencia: {lecturas}"
    );
    println!("ficheiro cru: {lecturas} segmentos, ningún toca os 7289 bytes de apendice");
}

/// O header declara SRAM en `$FF0000-$FFFFFF`. Unha biblioteca de patches non
/// pode tratar esa declaración como ROM: a rexión clasificase, sen bytes.
///
/// **Etiqueta fixada, non idealidade.** A referencia auditada xera `work-ram`
/// para todo `$E00000-$FFFFFF` (comprobado executándoa:
/// `0xff0000 -> {"region":"work-ram","offset":0}`), así que o perfil Rust fai o
/// mesmo. `Region::Sram` existe e emítese nos perfís SNES (`$6000-$7FFF` dos
/// bancos do sistema); nos perfís de Mega Drive a xanela de backup RAM vai
/// etiquetada como `WorkRam`. Cambialo sería diverxir dos vectores pinados —
/// iso require re-exportalos, e queda rexistrado como pendente en vez de
/// facerse a medias. O que si se proba aquí é o esencial: **non é ROM e non se
/// inventan bytes**.
#[test]
#[ignore = "BYOR non provisionable: executar con --ignored"]
fn a_sram_declarada_polo_header_non_e_rom() {
    let rom = image();
    let st = state();
    for addr in [0xff0000u32, 0xff1234, 0xffffff] {
        let got = md_linear::translate(addr, &st);
        match got {
            Translate::Device { region, offset } => {
                assert_ne!(region, Region::Rom, "{addr:#x} non pode ser ROM");
                assert_eq!(
                    (region, offset),
                    (Region::WorkRam, addr & 0xffff),
                    "{addr:#x}: etiqueta e offset interno fixados na referencia"
                );
            }
            other => panic!("{addr:#x}: esperado Device, atopado {other:?}"),
        }
        let segs = md_linear::read(addr, 4, &st, &rom).expect("lectura SRAM");
        assert!(
            matches!(
                segs[0],
                Segment::DeviceNoBacking {
                    region: Region::WorkRam,
                    ..
                }
            ),
            "{addr:#x}: esa rexión non pode devolver bytes da imaxe: {:?}",
            segs[0]
        );
    }
    println!("$FF0000-$FFFFFF: Device/WorkRam sen bytes, como na referencia auditada");
}

/// Imaxe sen mapper: o perfil lineal e o SSF2 en estado identidade deben ler o
/// mesmo. A concordancia mídese en bytes reais da imaxe, non en offsets.
#[test]
#[ignore = "BYOR non provisionable: executar con --ignored"]
fn sen_mapper_linear_e_ssf2_identidade_leeen_igual() {
    let rom = image();
    let linear = MapperState::rom_size(u64::try_from(IMAGE_BYTES).unwrap());
    let ssf2 = MapperState::ssf2(u64::try_from(IMAGE_BYTES).unwrap(), &[]);
    let mut comparadas = 0usize;
    let mut addr = 0u32;
    while addr <= 0x3f_fff0 {
        let a = md_linear::read(addr, 16, &linear, &rom).expect("linear");
        let b = md_ssf2::read(addr, 16, &ssf2, &rom).expect("ssf2");
        assert_eq!(
            formato_segmentos(&a),
            formato_segmentos(&b),
            "desaxuste entre perfís en {addr:#x}"
        );
        comparadas += 1;
        addr += 0x1041;
    }
    assert!(comparadas >= 1000, "mostragem curta: {comparadas}");
    println!("linear vs ssf2-identidade: {comparadas} lecturas reais idénticas");
}

/// Resumo comparable dos segmentos dunha lectura (rexión, offset, contido).
fn formato_segmentos(segs: &[Segment]) -> Vec<(String, u32, String)> {
    segs.iter()
        .map(|s| match s {
            Segment::Bytes {
                region,
                offset,
                bytes,
            } => (format!("{region:?}"), *offset, sha256_hex(bytes)),
            Segment::DeviceNoBacking {
                region,
                offset,
                error_code,
            } => (
                format!("{region:?} @{error_code:?}"),
                *offset,
                String::new(),
            ),
            Segment::Invalid(e) => (format!("Invalid @{e:?}"), 0, String::new()),
        })
        .collect()
}
