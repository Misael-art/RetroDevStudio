//! Varredura adversaria **determinística** (non aleatoria) que prova o invariante
//! tras os 15 `.expect()` de produción dos cinco perfis.
//!
//! O invariante, na palabra exacta do `achado_de_revisao` que o integrador me
//! devolveu en `crates/registry.json`: cada `.expect()` de `src/` está
//! xustificado por unha validación previa, pero **non hai varredura adversaria
//! que o prove no gate**. Este ficheiro é esa varredura.
//!
//! Como se le a evidencia:
//!
//! 1. `o_detector_ve_un_panico_inxectado` — sen esta proba todo o demais é
//!    ruído: demostra que o mecanismo captura o pánico **coa súa mensaxe e coa
//!    etiqueta da chamada** (`chigar` rexistra `etiqueta → payload`). Se o
//!    detector falla, as varreduras non poden afirmar nada. O payload dos
//!    `.expect()` de produción é a frase que xustifica o invariante, así que un
//!    FAIL sitúa o defecto no `src/` correspondente (ver MUTATION-CONTROLS.md,
//!    R1: `«validate_state xa aceptou o tamaño»` → `md_linear.rs:71/95/140/172`).
//! 2. Unha varredura por perfil: miles de estados hostis (`rom_size` ausente,
//!    negativo, fraccionario, texto, booleano, nulo, obxecto; tamaños 0..=1024,
//!    `2^k-1`, `2^k`, `2^k+1`, `3·2^k`, `u32::MAX`, `u32::MAX+1`, `u64::MAX`) e,
//!    para cada estado que `validate_state` **acepta**, os enderezos límite do
//!    perfil (bordos de xanela, de espello, de área, de páxina de rexistradores
//!    e de banco) con lonxitudes adversarias, a través de `translate`, `invert`,
//!    `read` e —en SSF2— `write_mapper_register`, varrendo despois **cada estado
//!    derivado de cada escrita**, que é onde vive o `.expect` de `md_ssf2.rs`.
//! 3. `a_validacion_md_caracteriza_o_dominio_dos_expect` — a varredura é un
//!    consenso sobre un dominio enumerado; esta proba é a caracterización: para
//!    todo tamaño do dominio, `validate_state` acepta se e só se o valor é
//!    `Uint`, está no intervalo e é potencia de 2. Ese predicado (derivado aqui,
//!    non copiado de `src/`) é o que fai imposibles os panics de `size - 1`,
//!    `offset % size` e `checked_rom_size(...).expect(...)`.
//! 4. `a_capa_de_recursos_non_panic_ante_atestacion_e_limites_hostis` — identidade
//!    malformada, `byte_len` mentireiro, `Limits` absurdos e `length`
//!    desbordante: recusa estruturada, nunca pánico nin esgotamento.
//!
//! Non hai corpus BYOR nin dependencias externas: os buffers son bytes de
//! recheo, porque aqui se proba a **ausencia de pánico**, non o contido (o
//! contido vai en `tests/resource_fixtures.rs`, con oráculo independente).

use std::any::Any;
use std::collections::BTreeSet;
use std::panic;

use rex_addressing::resource::{
    read_resource, read_sequence, ImageIdentity, Limits, Profile, ResourceErrorCode,
    ResourceRequest, SequenceRequest, Step,
};
use rex_addressing::{
    md_linear, md_ssf2, snes_exhirom, snes_hirom, snes_lorom, AddressingError, MapperState,
    Segment, Translate, Value,
};

struct Varredura {
    chamadas: u64,
    /// Chan de chamadas **derivado do dominio** (non do resultado): se a
    /// varredura executa menos, é que deixou de cubrir o planeado.
    piso: u64,
    panicos: Vec<String>,
    codigos: BTreeSet<String>,
}

/// Mensaxe coa que panicou a chamada: `catch_unwind` devolvea no payload, e para
/// os `.expect()` de produción esa mensaxe é a propia xustificación do invariante
/// («validate_state xa aceptou o tamaño», «un corredor non pode superar a xanela
/// de 4MB»…), o que sitúa o defecto no ficheiro e liña de `src/` correspondentes.
///
/// Non se pide `ficheiro:liña` cun gancho de pánico: `set_hook` é global ao
/// proceso e libtest instala e restaura o seu por fío, así que os dous mecanismos
/// interferiron (observado nunha execución de `cargo test --offline` completo). A
/// detección con `catch_unwind` non depende dese estado global, que é o que vale
/// para probar o invariante.
fn mensaxe(p: &Box<dyn Any + Send>) -> String {
    if let Some(s) = p.downcast_ref::<&'static str>() {
        (*s).to_string()
    } else if let Some(s) = p.downcast_ref::<String>() {
        s.clone()
    } else {
        "<pánico sen mensaxe imprimible>".to_string()
    }
}

impl Varredura {
    fn nova() -> Varredura {
        Varredura {
            chamadas: 0,
            piso: 0,
            panicos: Vec::new(),
            codigos: BTreeSet::new(),
        }
    }

    /// executa `f` baixo captura. `etiqueta` ten que permitir reconstruír a
    /// chamada (perfil, enderezo, lonxitude, estado): sen iso un FAIL non é
    /// auditable. Devolve o valor cando non houbo pánico, para que quen varre
    /// poida seguir usando o estado derivado.
    fn chigar<T>(
        &mut self,
        etiqueta: &str,
        f: impl FnOnce() -> T,
        recusa: impl FnOnce(&T) -> Option<String>,
    ) -> Option<T> {
        self.chamadas += 1;
        match panic::catch_unwind(panic::AssertUnwindSafe(f)) {
            Err(panico) => {
                self.panicos
                    .push(format!("{etiqueta} → {}", mensaxe(&panico)));
                None
            }
            Ok(valor) => {
                if let Some(codigo) = recusa(&valor) {
                    self.codigos.insert(codigo);
                }
                Some(valor)
            }
        }
    }

    fn resumo(panicos: &[String], chamadas: u64) -> String {
        format!(
            "{chamadas} chamadas varridas; {} pánico(s); primeiros: {:?}",
            panicos.len(),
            &panicos[..panicos.len().min(5)]
        )
    }

    fn acabar(self) -> (u64, BTreeSet<String>, Vec<String>) {
        (self.chamadas, self.codigos, self.panicos)
    }
}

// ---------------------------------------------------------------------------
// Dominio adversarial
// ---------------------------------------------------------------------------

fn tamaños_adversarios() -> Vec<u64> {
    let mut v: Vec<u64> = (0u64..=1_024).collect();
    for k in 0..63u32 {
        let p = 1u64 << k;
        v.extend([p, p.wrapping_add(1), p.wrapping_sub(1)]);
        if let Some(triplo) = p.checked_mul(3) {
            v.push(triplo);
        }
    }
    v.extend([
        u64::from(u32::MAX),
        u64::from(u32::MAX) + 1,
        u64::from(u32::MAX) + 0x1_0000,
        0xFFFF_FFFF_FFFF_FF00,
        u64::MAX - 1,
        u64::MAX,
    ]);
    v.sort_unstable();
    v.dedup();
    v
}

fn formas_adversarias(tamaño: u64) -> Vec<(String, MapperState)> {
    let clave = |value: Value| MapperState::from_entries(vec![("rom_size".to_string(), value)]);
    let mut out = vec![(format!("rom_size={tamaño}"), MapperState::rom_size(tamaño))];
    if tamaño <= i64::MAX as u64 {
        out.push((
            format!("rom_size=-{tamaño}"),
            clave(Value::Int(-(tamaño as i64))),
        ));
    }
    out.extend([
        (
            "rom_size=1.5".to_string(),
            clave(Value::NonInteger("1.5".to_string())),
        ),
        (
            "rom_size=\"24MB\"".to_string(),
            clave(Value::Text("24MB".to_string())),
        ),
        ("rom_size=true".to_string(), clave(Value::Bool(true))),
        ("rom_size=null".to_string(), clave(Value::Null)),
        ("rom_size={}".to_string(), clave(Value::Object(Vec::new()))),
        (
            "sen rom_size".to_string(),
            MapperState::from_entries(vec![("banco".to_string(), Value::Uint(3))]),
        ),
        (
            "con clave allea".to_string(),
            MapperState::from_entries(vec![
                ("rom_size".to_string(), Value::Uint(tamaño)),
                ("mapper".to_string(), Value::Text("KONAMI".to_string())),
                ("banks".to_string(), Value::Uint(9)),
            ]),
        ),
    ]);
    out
}

/// Bordos do barramento, da xanela do cartucho, da área sen dispositivo e da
/// páxina de rexistradores, máis unha grade de 64 KB.
fn enderezos_md() -> Vec<u32> {
    let mut v: Vec<u32> = [
        0x0000_0000,
        0x0000_0001,
        0x0000_00ff,
        0x0000_0100,
        0x0000_7fff,
        0x0000_8000,
        0x0000_fffe,
        0x0000_ffff,
        0x0001_0000,
        0x003d_ffff,
        0x003e_0000,
        0x003e_ffff,
        0x003f_fffe,
        0x003f_ffff,
        0x0040_0000,
        0x0080_0000,
        0x00a1_2fff,
        0x00a1_3000,
        0x00a1_3002,
        0x00a1_3004,
        0x00a1_30ff,
        0x00a1_3100,
        0x00b0_0000,
        0x00e0_0000,
        0x00ff_fffe,
        0x00ff_ffff,
        0x0100_0000,
        0x0fff_ffff,
        0x7fff_ffff,
        u32::MAX,
    ]
    .to_vec();
    v.extend((0..=0x40u32).map(|i| i * 0x0001_0000));
    v.sort_unstable();
    v.dedup();
    v
}

/// Cada banco nas esquinas da súa páxina; en ExHiROM, ademais, a fronteira de
/// área (`3F→40`) onde o offset físico **decrease**.
fn enderezos_snes(exhirom: bool) -> Vec<u32> {
    let mut v: Vec<u32> = Vec::new();
    for banco in 0..=0xffu32 {
        for o in [0x0000u32, 0x1fff, 0x2000, 0x7fff, 0x8000, 0xfffe, 0xffff] {
            v.push((banco << 16) | o);
        }
    }
    if exhirom {
        for banco in [
            0x3eu32, 0x3f, 0x40, 0x41, 0x7d, 0x7e, 0x7f, 0xc0, 0xfd, 0xfe, 0xff,
        ] {
            for o in [0x0000u32, 0x8000, 0xffff] {
                v.push((banco << 16) | o);
            }
        }
    }
    v.extend([
        0x0000_0000,
        0x003f_ffff,
        0x0040_0000,
        0x00ff_ffff,
        0x0100_0000,
    ]);
    v.sort_unstable();
    v.dedup();
    v
}

fn lonxitudes_curadas() -> Vec<u32> {
    vec![0, 1, 2, 8, 0x100, 0x1fff, 0x2000, 0x8000]
}

fn imaxes_adversarias() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("baleira", Vec::new()),
        ("curta-256", vec![0xA5u8; 0x100]),
        ("1MB", vec![0xA5u8; 0x10_0000]),
    ]
}

// ---------------------------------------------------------------------------
// Extractores de código: toda recusa ten que ser estruturada, nunca muda
// ---------------------------------------------------------------------------

fn codigo_translate(t: &Translate) -> Option<String> {
    match t {
        Translate::Invalid(e) => Some(format!("translate/{:?}", e.code)),
        Translate::Rom { .. } => Some("translate/rom".to_string()),
        Translate::Device { region, .. } => Some(format!("translate/device/{region:?}")),
    }
}

fn codigo_segmentos(segs: &Result<Vec<Segment>, AddressingError>) -> Option<String> {
    match segs {
        Err(e) => Some(format!("read/err/{:?}", e.code)),
        Ok(v) => v.iter().find_map(|s| match s {
            Segment::Invalid(e) => Some(format!("read/segment-invalid/{:?}", e.code)),
            Segment::DeviceNoBacking {
                error_code, region, ..
            } => Some(format!("read/device/{region:?}/{error_code:?}")),
            Segment::Bytes { .. } => None,
        }),
    }
}

fn codigo_err<T>(r: &Result<T, AddressingError>) -> Option<String> {
    r.as_ref().err().map(|e| format!("{:?}", e.code))
}

fn codigo_recusa(r: &Option<ResourceErrorCode>) -> Option<String> {
    r.map(|c| format!("recusa/{c:?}"))
}

// ---------------------------------------------------------------------------
// Un corpo de varredura, cinco perfís
// ---------------------------------------------------------------------------

/// Sinatura de `perfil::read`; escrivola aparte porque clippy rexeita a forma inline.
type LeituraPerfil = fn(u32, u32, &MapperState, &[u8]) -> Result<Vec<Segment>, AddressingError>;

struct PerfilVarrido {
    id: &'static str,
    validate: fn(&MapperState) -> Result<(), AddressingError>,
    translate: fn(u32, &MapperState) -> Translate,
    invert: fn(u32, &MapperState) -> Result<Vec<u32>, AddressingError>,
    read: LeituraPerfil,
    enderezos: Vec<u32>,
    /// `invert` cun `rom_size` pequeno produce millóns de aliases: a varredura
    /// llamao a partir deste tamaño para non esgotar o test, non por
    /// corrección. O `expect` de `invert` é o mesmo que xa cubren
    /// `translate`/`read`.
    invert_min: u64,
}

fn varrer(p: &PerfilVarrido) -> Varredura {
    let mut v = Varredura::nova();
    let imaxes = imaxes_adversarias();
    // Chan derivado do dominio: cada estado do dominio produce catro chamadas
    // de `translate` incondicionais. Se executa menos, a varredura está truncada.
    v.piso = 4 * tamaños_adversarios()
        .iter()
        .map(|t| formas_adversarias(*t).len() as u64)
        .sum::<u64>();

    for tamaño in tamaños_adversarios() {
        for (etiqueta_estado, estado) in formas_adversarias(tamaño) {
            let etiqueta = format!("{} :: {etiqueta_estado}", p.id);
            let aceptado = (p.validate)(&estado).is_ok();

            for addr in [0u32, 0x003f_ffff, 0x0100_0000, u32::MAX] {
                let e = format!("{etiqueta} translate {addr:#x}");
                v.chigar(&e, || (p.translate)(addr, &estado), codigo_translate);
            }
            if !aceptado {
                continue;
            }
            for &addr in &p.enderezos {
                let e = format!("{etiqueta} translate {addr:#x}");
                v.chigar(&e, || (p.translate)(addr, &estado), codigo_translate);
            }
            if tamaño >= p.invert_min {
                for offset in [0u32, 1, 0x1234, 0xfffe, u32::MAX] {
                    let e = format!("{etiqueta} invert {offset:#x}");
                    v.chigar(&e, || (p.invert)(offset, &estado), codigo_err);
                }
            }
            for (nome_imaxe, rom) in &imaxes {
                for &len in &lonxitudes_curadas() {
                    for addr in [0x0000u32, 0x003f_fff0, 0x0080_0000, 0x00a1_3000] {
                        let e = format!("{etiqueta} read {addr:#x}+{len:#x} imaxe={nome_imaxe}");
                        v.chigar(&e, || (p.read)(addr, len, &estado, rom), codigo_segmentos);
                    }
                }
            }
        }
    }
    v
}

fn afirmar(p: &str, v: Varredura) {
    let piso = v.piso;
    let (chamadas, codigos, panicos) = v.acabar();
    assert!(
        panicos.is_empty(),
        "[{p}] {} — os `.expect()` de produción son alcanzables.\n{}",
        Varredura::resumo(&panicos, chamadas),
        panicos.join("\n")
    );
    assert!(
        chamadas >= piso,
        "[{p}] a varredura está truncada: {chamadas} chamadas (< {piso} do dominio)"
    );
    assert!(
        codigos.len() >= 3,
        "[{p}] a varredura non exercitou resultados distintos: {codigos:?}"
    );
    println!(
        "[{p}] {chamadas} chamadas, 0 pánicos, {} clases: {:?}",
        codigos.len(),
        codigos
    );
}

#[test]
fn o_detector_ve_un_panico_inxectado() {
    let mut v = Varredura::nova();
    let resultado = v.chigar(
        "control",
        || panic!("panico de control: isto debe ser visible para a varredura"),
        |_: &()| None,
    );
    let (chamadas, _codigos, panicos) = v.acabar();
    assert_eq!(chamadas, 1);
    assert!(resultado.is_none(), "un pánico non produce valor");
    assert_eq!(
        panicos.len(),
        1,
        "un pánico inxectado debe detectarse: {panicos:?}"
    );
    let texto = &panicos[0];
    assert!(
        texto.contains("panico de control"),
        "o pánico capturado debe levar a súa mensaxe: {texto}"
    );
    assert!(
        texto.starts_with("control → "),
        "o pánico capturado debe empezar pola etiqueta da chamada, sen iso un FAIL non é auditable: {texto}"
    );
}

#[test]
fn md_linear_nin_un_panico_con_entradas_adversarias() {
    afirmar(
        "md-linear",
        varrer(&PerfilVarrido {
            id: "md-linear",
            validate: md_linear::validate_state,
            translate: md_linear::translate,
            invert: md_linear::invert,
            read: md_linear::read,
            enderezos: enderezos_md(),
            invert_min: 0x1_0000,
        }),
    );
}

#[test]
fn md_ssf2_nin_un_panico_con_entradas_adversarias() {
    let mut v = varrer(&PerfilVarrido {
        id: "md-ssf2",
        validate: md_ssf2::validate_state,
        translate: md_ssf2::translate,
        invert: md_ssf2::invert,
        read: md_ssf2::read,
        enderezos: enderezos_md(),
        invert_min: 0x1_0000,
    });

    // Toda a páxina de rexistradores, un byte por valor adversarial, e CADA
    // estado derivado volta a varrir: é ese estado o que consume o `.expect` de
    // md_ssf2.rs:139/168.
    let base = MapperState::ssf2(0x40_0000, &[]);
    let rom = vec![0xA5u8; 0x40_0000];
    for addr in 0x00a1_3000u32..=0x00a1_30ff {
        for data in [0u8, 1, 2, 3, 5, 7, 8, 0x40, 0x80, 0xf8, 0xff] {
            let e = format!("md-ssf2 :: escrita {addr:#x}={data:#x}");
            let derivado = v.chigar(
                &e,
                || (md_ssf2::write_mapper_register)(addr, data, &base),
                codigo_err,
            );
            let Some(novo) = derivado.and_then(|r| r.ok()) else {
                continue;
            };
            for addr2 in [0x0000u32, 0x0008_0000, 0x0010_0000, 0x003f_ffff] {
                let e2 = format!("{e} → translate {addr2:#x}");
                v.chigar(&e2, || (md_ssf2::translate)(addr2, &novo), codigo_translate);
            }
            let e2 = format!("{e} → read 0x08_0000+0x100");
            v.chigar(
                &e2,
                || (md_ssf2::read)(0x0008_0000, 0x100, &novo, &rom),
                codigo_segmentos,
            );
        }
    }
    for addr in [
        0x00a1_2fffu32,
        0x00a1_3100,
        0x0000_0000,
        0x00ff_ffff,
        0x0100_0000,
        u32::MAX,
    ] {
        let e = format!("md-ssf2 :: escrita fóra de páxina {addr:#x}");
        v.chigar(
            &e,
            || (md_ssf2::write_mapper_register)(addr, 5, &base),
            codigo_err,
        );
    }
    for (etiqueta, estado) in bancos_hostis() {
        let e = format!("md-ssf2 :: banks {etiqueta}");
        v.chigar(&e, || (md_ssf2::validate_state)(&estado), codigo_err);
        v.chigar(
            &format!("{e} → translate"),
            || (md_ssf2::translate)(0x0008_0000, &estado),
            codigo_translate,
        );
        v.chigar(
            &format!("{e} → read"),
            || (md_ssf2::read)(0x0008_0000, 0x100, &estado, &rom),
            codigo_segmentos,
        );
    }
    afirmar("md-ssf2", v);
}

/// Mapas `banks` que ningún manifiesto real produce pero que un adaptador
/// podería construír a partir dun JSON escrito a man.
fn bancos_hostis() -> Vec<(String, MapperState)> {
    let con_bancos = |entradas: Vec<(String, Value)>| {
        MapperState::from_entries(vec![
            ("rom_size".to_string(), Value::Uint(0x40_0000)),
            ("banks".to_string(), Value::Object(entradas)),
        ])
    };
    let mut out = Vec::new();
    for (chave, valor) in [
        ("0", 1u64),
        ("7", 1),
        ("8", 1),
        ("99", 1),
        ("1", 0xFFFF_FFFF_FFFF),
        ("1", 0x8_0000),
        ("1", 7),
        ("-1", 1),
        ("", 1),
        ("abc", 1),
    ] {
        out.push((
            format!("{chave}→{valor}"),
            con_bancos(vec![(chave.to_string(), Value::Uint(valor))]),
        ));
    }
    out.push((
        "1→2 e 1→3 duplicado".to_string(),
        con_bancos(vec![
            ("1".to_string(), Value::Uint(2)),
            ("1".to_string(), Value::Uint(3)),
        ]),
    ));
    out.push((
        "1 obxecto dentro de 1".to_string(),
        con_bancos(vec![(
            "1".to_string(),
            Value::Object(vec![("x".to_string(), Value::Uint(1))]),
        )]),
    ));
    out.push((
        "banks=4 (non obxecto)".to_string(),
        MapperState::from_entries(vec![
            ("rom_size".to_string(), Value::Uint(0x40_0000)),
            ("banks".to_string(), Value::Uint(4)),
        ]),
    ));
    out.push((
        "banks={1:\"A\"}".to_string(),
        con_bancos(vec![("1".to_string(), Value::Text("A".to_string()))]),
    ));
    out
}

#[test]
fn snes_lorom_nin_un_panico_con_entradas_adversarias() {
    afirmar(
        "snes-lorom",
        varrer(&PerfilVarrido {
            id: "snes-lorom",
            validate: snes_lorom::validate_state,
            translate: snes_lorom::translate,
            invert: snes_lorom::invert,
            read: snes_lorom::read,
            enderezos: enderezos_snes(false),
            invert_min: 0x8_0000,
        }),
    );
}

#[test]
fn snes_hirom_nin_un_panico_con_entradas_adversarias() {
    afirmar(
        "snes-hirom",
        varrer(&PerfilVarrido {
            id: "snes-hirom",
            validate: snes_hirom::validate_state,
            translate: snes_hirom::translate,
            invert: snes_hirom::invert,
            read: snes_hirom::read,
            enderezos: enderezos_snes(false),
            invert_min: 0x1_0000,
        }),
    );
}

#[test]
fn snes_exhirom_nin_un_panico_con_entradas_adversarias() {
    afirmar(
        "snes-exhirom",
        varrer(&PerfilVarrido {
            id: "snes-exhirom",
            validate: snes_exhirom::validate_state,
            translate: snes_exhirom::translate,
            invert: snes_exhirom::invert,
            read: snes_exhirom::read,
            enderezos: enderezos_snes(true),
            invert_min: 0x50_0000,
        }),
    );
}

/// A caracterización que converte a varredura nun argumento: sobre o dominio
/// enumerado, o conxunto aceptado por `validate_state` é exactamente
/// `{Uint, no intervalo, potencia de 2}`. Con ese predicado,
/// `checked_rom_size` non pode fallar, `size - 1` non pode desbordar e
/// `offset % size` non pode dividir por cero.
#[test]
fn a_validacion_md_caracteriza_o_dominio_dos_expect() {
    let mut aceptados = BTreeSet::new();
    for tamaño in tamaños_adversarios() {
        let estado = MapperState::rom_size(tamaño);
        let lineal = md_linear::validate_state(&estado).is_ok();
        let ssf2 = md_ssf2::validate_state(&estado).is_ok();
        match u32::try_from(tamaño) {
            Ok(s) => {
                let esperado_lineal =
                    (0x0001_0000u32..=0x0040_0000).contains(&s) && s.is_power_of_two();
                assert_eq!(
                    lineal, esperado_lineal,
                    "md-linear aceptou {s:#x} cando o predicado di {esperado_lineal}"
                );
                let esperado_ssf2 =
                    (0x0008_0000u32..=0x0080_0000).contains(&s) && s.is_power_of_two();
                assert_eq!(
                    ssf2, esperado_ssf2,
                    "md-ssf2 aceptou {s:#x} cando o predicado di {esperado_ssf2}"
                );
                if esperado_lineal {
                    aceptados.insert(s);
                }
            }
            Err(_) => {
                assert!(
                    !lineal && !ssf2,
                    "rom_size {tamaño} fóra de 32 bits non pode ser aceptado"
                );
            }
        }
    }
    assert_eq!(
        aceptados,
        BTreeSet::from([
            0x0001_0000u32,
            0x0002_0000,
            0x0004_0000,
            0x0008_0000,
            0x0010_0000,
            0x0020_0000,
            0x0040_0000
        ]),
        "o dominio aceptado por md-linear debe ser exactamente as potencias de 2 de 64KB a 4MB"
    );

    // A outra metade do predicado: a **forma** do valor. Só `Uint` pode ser
    // aceptado; as claves alleas ignoranse en `md-linear` (política declarada en
    // `src/md_linear.rs:28`, igual que na referencia auditada) e son erro en
    // `md-ssf2`, que si ten claves propias.
    let aceptables_lineal = ["rom_size=1048576", "con clave allea"];
    let aceptables_ssf2 = ["rom_size=1048576"];
    for (nome, estado) in formas_adversarias(0x10_0000) {
        assert_eq!(
            md_linear::validate_state(&estado).is_ok(),
            aceptables_lineal.contains(&nome.as_str()),
            "md-linear e a forma {nome}"
        );
        assert_eq!(
            md_ssf2::validate_state(&estado).is_ok(),
            aceptables_ssf2.contains(&nome.as_str()),
            "md-ssf2 e a forma {nome}"
        );
    }
}

#[test]
fn a_capa_de_recursos_non_panic_ante_atestacion_e_limites_hostis() {
    let rom = vec![0xA5u8; 0x10_0000];
    let identidade_boa = || ImageIdentity {
        origin: "fixture:varredura".to_string(),
        sha256_hex: "0".repeat(64),
        byte_len: rom.len() as u64,
    };
    let estados = estados_para_varredura_recursos();
    let identidades = identidades_hostis(identidade_boa());
    let secuencias = secuencias_hostis();
    let limites = [
        Limits {
            max_bytes: 0,
            max_segments: 0,
        },
        Limits {
            max_bytes: 1,
            max_segments: 1,
        },
        Limits::DEFAULT,
        Limits {
            max_bytes: u32::MAX,
            max_segments: u32::MAX,
        },
    ];
    let lonxitudes_limite = [0u32, 1, 0x100_0000, u32::MAX];
    let perfis = Profile::all();
    // Reconto **exacto** do plan: cada combinación do dominio produce unha
    // chamada. Non é un limiar inventado despois de mirar a saída.
    let plan = identidades.len() * perfis.len() * estados.len() * 2
        + limites.len() * perfis.len() * lonxitudes_limite.len()
        + secuencias.len() * perfis.len();
    let mut v = Varredura::nova();
    v.piso = plan as u64;

    for (etiqueta, identidade) in &identidades {
        for perfil in perfis {
            for estado in &estados {
                let e = format!("recursos :: {etiqueta} / {}", perfil.id());
                let curto = ResourceRequest {
                    profile: perfil,
                    image: identidade.clone(),
                    state: estado,
                    cpu_address: 0x00a1_3000,
                    length: 0x100,
                    limits: Limits::DEFAULT,
                };
                v.chigar(
                    &e,
                    || read_resource(&curto, &rom).err().map(|x| x.code),
                    codigo_recusa,
                );
                let desbordante = ResourceRequest {
                    profile: perfil,
                    image: identidade.clone(),
                    state: estado,
                    cpu_address: 0,
                    length: u32::MAX,
                    limits: Limits::DEFAULT,
                };
                v.chigar(
                    &format!("{e} (length desbordante)"),
                    || read_resource(&desbordante, &rom).err().map(|x| x.code),
                    codigo_recusa,
                );
            }
        }
    }

    // `Limits` absurdos: un `length` descomunal recústase antes de percorrer.
    for limits in &limites {
        for perfil in perfis {
            for length in &lonxitudes_limite {
                let pedido = ResourceRequest {
                    profile: perfil,
                    image: identidade_boa(),
                    state: &MapperState::rom_size(0x10_0000),
                    cpu_address: 0,
                    length: *length,
                    limits: *limits,
                };
                let e = format!(
                    "recursos :: limits({:#x},{:#x}) {} len={length:#x}",
                    limits.max_bytes,
                    limits.max_segments,
                    perfil.id()
                );
                v.chigar(
                    &e,
                    || read_resource(&pedido, &rom).err().map(|x| x.code),
                    codigo_recusa,
                );
            }
        }
    }

    // Secuencias de bancos hostis, incluídos perfis sen rexistradores.
    for perfil in perfis {
        for (nome, steps) in &secuencias {
            let pedido = SequenceRequest {
                profile: perfil,
                image: identidade_boa(),
                initial_state: &MapperState::rom_size(0x10_0000),
                limits: Limits::DEFAULT,
                steps,
            };
            let e = format!("recursos :: secuencia {} :: {nome}", perfil.id());
            v.chigar(
                &e,
                || read_sequence(&pedido, &rom).err().map(|x| x.code),
                codigo_recusa,
            );
        }
    }

    let (chamadas, codigos, panicos) = v.acabar();
    assert!(
        panicos.is_empty(),
        "[recursos] {}\n{}",
        Varredura::resumo(&panicos, chamadas),
        panicos.join("\n")
    );
    assert_eq!(
        chamadas, plan as u64,
        "[recursos] a varredura non executou o plan: {chamadas} chamadas, plan {plan}"
    );
    for esperado in [
        "recusa/BadAttestation",
        "recusa/BadState",
        "recusa/InvalidRange",
        "recusa/LimitExceeded",
        "recusa/NonRomRegion",
    ] {
        assert!(
            codigos.contains(esperado),
            "[recursos] falta {esperado}: {codigos:?}"
        );
    }
    assert!(
        !codigos.iter().any(|c| c == "recusa/Ambiguous"),
        "[recursos] cunha imaxe de 1MB coherente non pode haber ambigüidade: {codigos:?}"
    );
    println!(
        "[recursos] {chamadas} chamadas, 0 pánicos, {} códigos: {codigos:?}",
        codigos.len()
    );
}

fn secuencias_hostis() -> Vec<(String, Vec<Step>)> {
    let ler = |cpu_address: u32, length: u32| Step::Read {
        cpu_address,
        length,
    };
    let escribir = |cpu_address: u32, data: u8| Step::WriteRegister { cpu_address, data };
    vec![
        ("unha escrita".to_string(), vec![escribir(0x00a1_3002, 5)]),
        (
            "escrita fora de páxina + lectura desbordante".to_string(),
            vec![escribir(0x00a1_2fff, 5), ler(0x0008_0000, u32::MAX)],
        ),
        (
            "lectura de cero bytes no bordo do barramento".to_string(),
            vec![ler(u32::MAX, 0)],
        ),
        (
            "banco extremo e lectura cruzada".to_string(),
            vec![escribir(0x00a1_3004, 0xff), ler(0x00ff_ffff, 0x100)],
        ),
        ("secuencia baleira".to_string(), vec![]),
        (
            "lectura en páxina de rexistradores".to_string(),
            vec![ler(0x00a1_3002, 0x10)],
        ),
    ]
}

fn identidades_hostis(boa: ImageIdentity) -> Vec<(String, ImageIdentity)> {
    let mut o = boa.clone();
    o.origin = "   ".to_string();
    let mut curto = boa.clone();
    curto.sha256_hex = "00".to_string();
    let mut maiusculas = boa.clone();
    maiusculas.sha256_hex = "A".repeat(64);
    let mut guions = boa.clone();
    guions.sha256_hex = "0-".repeat(32);
    let mut len_maior = boa.clone();
    len_maior.byte_len = boa.byte_len + 1;
    let mut len_cero = boa.clone();
    len_cero.byte_len = 0;
    vec![
        ("boa".to_string(), boa.clone()),
        ("orixe en branco".to_string(), o),
        ("hash curto".to_string(), curto),
        ("hash en maiúsculas".to_string(), maiusculas),
        ("hash con guións".to_string(), guions),
        ("byte_len mentireiro".to_string(), len_maior),
        ("byte_len cero".to_string(), len_cero),
    ]
}

fn estados_para_varredura_recursos() -> Vec<MapperState> {
    let mut out = vec![
        MapperState::empty(),
        MapperState::rom_size(0),
        MapperState::rom_size(0x10_0000),
        MapperState::rom_size(0x8_0000),
        MapperState::rom_size(3),
        MapperState::rom_size(u64::MAX),
        MapperState::ssf2(0x40_0000, &[(0, 1)]),
        MapperState::ssf2(0x40_0000, &[(1, 9), (2, 0)]),
        MapperState::from_entries(vec![(
            "rom_size".to_string(),
            Value::Text("1MB".to_string()),
        )]),
    ];
    out.extend(bancos_hostis().into_iter().map(|(_, estado)| estado));
    out
}
