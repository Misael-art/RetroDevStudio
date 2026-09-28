//! Capa de lectura de recursos con procedencia (etapa 2).
//!
//! Todo o esperado deste ficheiro calcúlase **sen chamar á biblioteca**: as
//! expectativas son constantes escritas a man desde a especificación do perfil
//! (`docs/rex_profiles/addressing/*.md`) e os bytes veñen do oráculo pechado de
//! `support::banked`. Un fallo aquí significa que a lectura é incorrecta, non
//! que duas implementacións coincidiron en equivocar(se).

mod support;

use rex_addressing::resource::{
    read_resource, read_sequence, ImageIdentity, Limits, Profile, ResourceErrorCode,
    ResourceRequest, SequenceRequest, Step, CONTRACT_VERSION,
};
use rex_addressing::{MapperState, Region};
use support::{banked, sha256::sha256_hex};

fn imaxe(len: usize) -> Vec<u8> {
    banked::image(len)
}

fn atestacion(rom: &[u8]) -> ImageIdentity {
    ImageIdentity {
        origin: "fixture:resource-reader".to_string(),
        sha256_hex: sha256_hex(rom),
        byte_len: rom.len() as u64,
    }
}

fn solicitar<'a>(
    profile: Profile,
    state: &'a MapperState,
    image: ImageIdentity,
    cpu_address: u32,
    length: u32,
) -> ResourceRequest<'a> {
    ResourceRequest {
        profile,
        image,
        state,
        cpu_address,
        length,
        limits: Limits::DEFAULT,
    }
}

#[test]
fn lectura_dentro_da_venta_devolve_bytes_e_un_só_segmento() {
    let state = MapperState::rom_size(0x8_0000);
    let rom = imaxe(0x8_0000);
    let got = read_resource(
        &solicitar(Profile::MdLinear, &state, atestacion(&rom), 0x00_1234, 16),
        &rom,
    )
    .expect("lectura dentro da xanela do cartucho");
    assert_eq!(got.profile, "md-linear");
    assert_eq!(got.contract_version, CONTRACT_VERSION);
    assert_eq!((got.cpu_address, got.length), (0x00_1234, 16));
    assert_eq!(got.bytes, banked::expect(0x00_1234, 16));
    assert_eq!(got.segments.len(), 1);
    let seg = &got.segments[0];
    assert_eq!(seg.index, 0);
    assert_eq!((seg.cpu_address, seg.cpu_len), (0x00_1234, 16));
    assert_eq!(seg.rom_offset, 0x00_1234, "lineal: bus e offset coinciden");
    assert_eq!(seg.region, Region::Rom);
    assert_eq!(seg.state, state);
    assert_eq!(got.image, atestacion(&rom), "a identidade viaxa na saída");
}

#[test]
fn lectura_que_sae_da_venta_recusase_deixando_a_procedencia_percorrida() {
    let state = MapperState::rom_size(0x40_0000);
    let rom = imaxe(0x40_0000);
    // `$3FFF00` é o último corredor ROM: a xanela do cartucho remata en
    // `$3FFFFFFF` e `$400000` non ten dispositivo.
    let err = read_resource(
        &solicitar(
            Profile::MdLinear,
            &state,
            atestacion(&rom),
            0x3f_ff00,
            0x200,
        ),
        &rom,
    )
    .expect_err("un recurso truncado non é unha lectura integral");
    assert_eq!(err.code, ResourceErrorCode::NonRomRegion);
    assert_eq!(err.region, None, "$400000 é área sen dispositivo");
    assert_eq!(err.address, Some(0x40_0000), "onde se detivo o percorrido");
    assert_eq!(err.segments.len(), 1);
    assert_eq!(
        (err.segments[0].cpu_address, err.segments[0].cpu_len),
        (0x3f_ff00, 0x100),
        "percorréronse 256 bytes antes de recusar"
    );
    assert_eq!(err.segments[0].rom_offset, 0x3f_ff00);
}

#[test]
fn rexion_coñecida_sin_backing_recusase_co_nome_da_rexion() {
    let state = MapperState::rom_size(0x10_0000);
    let rom = imaxe(0x10_0000);
    // HiROM: `$00FFF8` é ROM ata `$00FFFF`; `$010000` é o espello de WRAM.
    let err = read_resource(
        &solicitar(Profile::SnesHirom, &state, atestacion(&rom), 0x00_ff_f8, 16),
        &rom,
    )
    .expect_err("$010000 non é ROM");
    assert_eq!(err.code, ResourceErrorCode::NonRomRegion);
    assert_eq!(err.region, Some(Region::WramMirror));
    assert_eq!(err.segments.len(), 1);
    assert_eq!(err.segments[0].rom_offset, 0x00_ff_f8);
    assert_eq!(err.segments[0].cpu_len, 8);
}

/// A desviación da auditoría (`CLASSIFICACION.md` §8) non se herda: a capa de
/// recursos valida a fronteira do bus ela mesma, co mesmo canal nas duas
/// familias.
#[test]
fn a_fronteira_do_barramento_recusase_igual_en_md_e_en_snes() {
    let md = MapperState::rom_size(0x8_0000);
    let rom_md = imaxe(0x8_0000);
    let err = read_resource(
        &solicitar(Profile::MdLinear, &md, atestacion(&rom_md), 0xff_fff0, 0x20),
        &rom_md,
    )
    .expect_err("$FFFFFF + 32 cruza o fin do bus");
    assert_eq!(err.code, ResourceErrorCode::InvalidRange);
    assert!(
        err.segments.is_empty(),
        "recusado antes de percorrer: {:?}",
        err.segments
    );

    let snes = MapperState::rom_size(0x8_0000);
    let rom_snes = imaxe(0x8_0000);
    // Mesma forma que o caso MD: cruzar o fin do barramento, non caer nunha
    // rexión non-ROM. As dúas familias deben sair polo mesmo canal.
    let err = read_resource(
        &solicitar(
            Profile::SnesLorom,
            &snes,
            atestacion(&rom_snes),
            0xff_fff0,
            0x20,
        ),
        &rom_snes,
    )
    .expect_err("$FFFFFF + 32 cruza o fin do bus tamén en SNES");
    assert_eq!(err.code, ResourceErrorCode::InvalidRange);
    assert!(err.segments.is_empty());
}

#[test]
fn limites_de_bytes_e_de_segmentos_recusanse_antes_de_recoller_nada() {
    let state = MapperState::rom_size(0x8_0000);
    let rom = imaxe(0x8_0000);
    let mut req = solicitar(Profile::MdLinear, &state, atestacion(&rom), 0x00_1234, 16);
    req.limits = Limits {
        max_bytes: 8,
        max_segments: 64,
    };
    let err = read_resource(&req, &rom).expect_err("16 bytes con tope de 8");
    assert_eq!(err.code, ResourceErrorCode::LimitExceeded);
    assert!(err.segments.is_empty());

    // Tres xanelas SSF2 = tres segmentos, co tope en dous.
    let ssf2 = MapperState::ssf2(0x40_0000, &[]);
    let rom3 = imaxe(0x40_0000);
    req.profile = Profile::MdSsf2;
    req.state = &ssf2;
    req.image = atestacion(&rom3);
    req.cpu_address = 0x07_ff_f8;
    req.length = 0x8_0010;
    req.limits = Limits {
        max_bytes: 0x10_0000,
        max_segments: 2,
    };
    let err = read_resource(&req, &rom3).expect_err("tres xanelas con tope de 2");
    assert_eq!(err.code, ResourceErrorCode::LimitExceeded);
    assert_eq!(err.segments.len(), 2, "a procedencia di onde se parou");
}

#[test]
fn atestacion_e_imaxe_teñen_que_coincidir() {
    let state = MapperState::rom_size(0x8_0000);
    let rom = imaxe(0x8_0000);
    // (a) a atestación fala dun tamaño distinto do buffer entregado
    let mut false_att = atestacion(&rom);
    false_att.byte_len -= 1;
    let err = read_resource(
        &solicitar(Profile::MdLinear, &state, false_att, 0x1000, 16),
        &rom,
    )
    .expect_err("tamaño atestado ≠ buffer");
    assert_eq!(err.code, ResourceErrorCode::IncompatibleSize);

    // (b) o `rom_size` declarado no estado non cabe na imaxe entregada: o
    // percorrido devolvería un prefixo, que non é unha lectura integral.
    let rom_curta = imaxe(0x4_0000);
    let err = read_resource(
        &solicitar(
            Profile::MdLinear,
            &state,
            atestacion(&rom_curta),
            0x3_f000,
            0x2000,
        ),
        &rom_curta,
    )
    .expect_err("32 KB faltantes non son un éxito");
    assert_eq!(err.code, ResourceErrorCode::IncompatibleSize);
    assert_eq!(err.segments.len(), 1);
    assert_eq!(err.segments[0].cpu_len, 0x1000, "o que si había");

    // (c) unha atestación mal formada non le nada. O núcleo **non** compute o
    // digest: comprobaba a forma (orixe non baleira, 64 hex minúsculos) e o
    // tamaño; o contido verifícao o adaptador, e iso píñase no test seguinte.
    let bom_digest = sha256_hex(&rom);
    for (origin, digest) in [
        ("".to_string(), bom_digest.clone()),
        ("x".to_string(), "zz".repeat(32)),
        ("x".to_string(), "A".repeat(64)),
        ("x".to_string(), bom_digest[..63].to_string()),
        ("   ".to_string(), bom_digest.clone()),
    ] {
        let bad = ImageIdentity {
            origin,
            sha256_hex: digest,
            byte_len: rom.len() as u64,
        };
        let err = read_resource(&solicitar(Profile::MdLinear, &state, bad, 0x1000, 16), &rom)
            .expect_err("identidade non verificable");
        assert_eq!(err.code, ResourceErrorCode::BadAttestation);
        assert!(err.segments.is_empty());
    }
}

/// Límite declarado da capa: o núcleo non hash de imaxes (por iso non ten
/// dependencias, e por iso unha lectura de 4 MB non paga un SHA-256 en cada
/// chamada). Un digest **ben formado pero de outro contido** pasa a validación
/// de forma — detectao quen chama, comparando o digest echo na saída co que
/// coñece do arquivo. Se alguén move a verificación de contido ao núcleo, este
/// test deixa de discriminar e hai que reescribilos os dous.
#[test]
fn a_verificacion_de_contido_e_perna_do_adaptador_non_do_nucleo() {
    let state = MapperState::rom_size(0x8_0000);
    let rom = imaxe(0x8_0000);
    let outra_imaxe = imaxe(0x1_0000);
    let allea = ImageIdentity {
        origin: "fixture:outra".to_string(),
        sha256_hex: sha256_hex(&outra_imaxe),
        byte_len: rom.len() as u64,
    };
    let got = read_resource(
        &solicitar(Profile::MdLinear, &state, allea.clone(), 0x1000, 16),
        &rom,
    )
    .expect("a forma é válida: o núcleo non compara contidos");
    assert_eq!(got.image, allea, "a identidade viaxa tal como entrou");
    assert_ne!(
        got.image.sha256_hex,
        sha256_hex(&rom),
        "e a comprobación que falta é exactamente esta, na frontada"
    );
}

#[test]
fn estado_rexeitado_polo_perfil_e_badstate_non_invalid_range() {
    // Sen `rom_size`: o que falla é o estado, non o enderezo.
    let empty = MapperState::empty();
    let rom = imaxe(0x8_0000);
    let err = read_resource(
        &solicitar(Profile::MdLinear, &empty, atestacion(&rom), 0x1000, 16),
        &rom,
    )
    .expect_err("estado incompleto");
    assert_eq!(err.code, ResourceErrorCode::BadState);

    // Clave allea nun perfil SNES (que si a rexeita).
    let con_bancos = MapperState::ssf2(0x8_0000, &[(1, 2)]);
    let err = read_resource(
        &solicitar(
            Profile::SnesLorom,
            &con_bancos,
            atestacion(&rom),
            0x8000,
            16,
        ),
        &rom,
    )
    .expect_err("LoROM non ten rexistradores");
    assert_eq!(err.code, ResourceErrorCode::BadState);
}

/// O caso que xustifica a existencia da capa: **o mesmo enderezo lóxico, dous
/// estados, bytes distintos** — e cada lectura leva o seu estado na procedencia.
#[test]
fn mesmo_enderezo_loxico_dous_estados_bytes_distintos() {
    let rom = imaxe(0x40_0000);
    let identidade = MapperState::ssf2(0x40_0000, &[]);
    let remapeado = MapperState::ssf2(0x40_0000, &[(1, 5)]);

    let a = read_resource(
        &solicitar(
            Profile::MdSsf2,
            &identidade,
            atestacion(&rom),
            0x08_0000,
            32,
        ),
        &rom,
    )
    .expect("xanela 1 en identidade");
    let b = read_resource(
        &solicitar(Profile::MdSsf2, &remapeado, atestacion(&rom), 0x08_0000, 32),
        &rom,
    )
    .expect("xanela 1 co banco 5");

    assert_eq!(a.segments[0].rom_offset, 0x08_0000);
    assert_eq!(
        b.segments[0].rom_offset, 0x28_0000,
        "banco 5 · 512 KB: base 0x280000, calculado á man desde a spec"
    );
    assert_eq!(a.bytes, banked::expect(0x08_0000, 32));
    assert_eq!(b.bytes, banked::expect(0x28_0000, 32));
    assert_ne!(a.bytes, b.bytes);
    assert_eq!(a.segments[0].state, identidade);
    assert_eq!(b.segments[0].state, remapeado);
    // Instantánea inmutable: ningunha das dúas chamadas alterou os estados.
    assert_eq!(
        identidade,
        MapperState::ssf2(0x40_0000, &[]),
        "a lectura con estado prestado non o muta"
    );
    assert_eq!(
        remapeado,
        MapperState::ssf2(0x40_0000, &[(1, 5)]),
        "a segunda instancia segue intacta"
    );
}

#[test]
fn a_procedencia_reconstrue_a_saida_byte_a_byte() {
    let state = MapperState::ssf2(0x40_0000, &[(1, 5), (2, 5), (3, 6)]);
    let rom = imaxe(0x40_0000);
    // `$07FFF8` durante `$100108` bytes: 8 na cola da xanela 0, as xanelas 1 e
    // 2 enteiras (ambas no banco 5, `0x280000`) e `$100` na 3 (banco 6).
    let got = read_resource(
        &solicitar(
            Profile::MdSsf2,
            &state,
            atestacion(&rom),
            0x07_ff_f8,
            0x10_0108,
        ),
        &rom,
    )
    .expect("lectura a catro xanelas");
    assert_eq!(got.segments.len(), 4, "{:?}", got.segments);
    assert_eq!(
        got.segments[1].rom_offset, got.segments[2].rom_offset,
        "dous bancos remapeados á mesma base son dous segmentos distintos"
    );
    assert_ne!(
        got.segments[1].cpu_address, got.segments[2].cpu_address,
        "e non se emenden: o enderezo lóxico é o que os separa"
    );

    let mut reconstruido: Vec<u8> = Vec::new();
    let mut cursor = got.cpu_address;
    for (i, seg) in got.segments.iter().enumerate() {
        assert_eq!(seg.index, i as u32);
        assert_eq!(
            seg.cpu_address, cursor,
            "a secuencia lóxica non ten ocos nin solapamentos"
        );
        cursor += seg.cpu_len;
        reconstruido.extend_from_slice(
            banked::expect(seg.rom_offset as usize, seg.cpu_len as usize).as_slice(),
        );
    }
    assert_eq!(cursor, got.cpu_address + got.length);
    assert_eq!(
        reconstruido, got.bytes,
        "a procedencia non reconstrúe o que devolve a lectura"
    );
}

#[test]
fn lorom_a15_ambiguo_recusase_por_nome_non_como_rango() {
    let state = MapperState::rom_size(0x8_0000);
    let rom = imaxe(0x8_0000);
    let err = read_resource(
        &solicitar(Profile::SnesLorom, &state, atestacion(&rom), 0x40_0000, 8),
        &rom,
    )
    .expect_err("metade baixa do banco 40: as fontes diverxen");
    assert_eq!(err.code, ResourceErrorCode::Ambiguous);
    assert!(err.segments.is_empty(), "non se leu nada antes diso");
}

/// Propiedade central da capa: **nunca** se devolve un parcial como éxito.
/// A columna `e_lectura` escríbese a man desde as specs dos cinco perfis
/// (`docs/rex_profiles/addressing/*.md`), non desde a implementación: cada caso
/// di onde acaba o percorrido e por iso a táboa non é vacía en ningunha rama.
#[test]
fn ningunha_lectura_devolve_parciais_como_exitos() {
    struct Caso {
        profile: Profile,
        state: MapperState,
        rom_len: usize,
        cpu: u32,
        length: u32,
        e_lectura: bool,
        /// Rexión na que acaba a lectura cando acaba mal (`None` = éxito, ou
        /// área sen dispositivo ningún).
        rexion: Option<Region>,
        por_que: &'static str,
    }
    use Region::*;
    let casos = [
        Caso {
            profile: Profile::MdLinear,
            state: MapperState::rom_size(0x8_0000),
            rom_len: 0x8_0000,
            cpu: 0x00_7ff00,
            length: 0x200,
            e_lectura: true,
            rexion: None,
            por_que: "espello dentro da xanela do cartucho: $80000 é o byte 0 do banco 0",
        },
        Caso {
            profile: Profile::MdLinear,
            state: MapperState::rom_size(0x40_0000),
            rom_len: 0x40_0000,
            cpu: 0x3f_ff00,
            length: 0x200,
            e_lectura: false,
            rexion: None,
            por_que: "$400000 está fóra da xanela do cartucho e sen dispositivo",
        },
        Caso {
            profile: Profile::MdSsf2,
            state: MapperState::ssf2(0x40_0000, &[(1, 5)]),
            rom_len: 0x40_0000,
            cpu: 0x07_fff8,
            length: 0x20,
            e_lectura: true,
            rexion: None,
            por_que: "corte de xanela 0→1, ambas ROM",
        },
        Caso {
            profile: Profile::MdSsf2,
            state: MapperState::ssf2(0x40_0000, &[]),
            rom_len: 0x40_0000,
            cpu: 0x00_3f_f8,
            length: 0x10,
            e_lectura: true,
            rexion: None,
            por_que: "todo dentro da xanela 0 fixa",
        },
        Caso {
            profile: Profile::SnesLorom,
            state: MapperState::rom_size(0x8_0000),
            rom_len: 0x8_0000,
            cpu: 0x00_8000,
            length: 0x20,
            e_lectura: true,
            rexion: None,
            por_que: "$8000 do banco 00: metade alta, ROM",
        },
        Caso {
            profile: Profile::SnesLorom,
            state: MapperState::rom_size(0x8_0000),
            rom_len: 0x8_0000,
            cpu: 0x70_1000,
            length: 0x10,
            e_lectura: false,
            rexion: Some(Sram),
            por_que: "banco $70 metade baixa: SRAM, sen bytes na imaxe",
        },
        Caso {
            profile: Profile::SnesHirom,
            state: MapperState::rom_size(0x10_0000),
            rom_len: 0x10_0000,
            cpu: 0x00_ff_f8,
            length: 0x10,
            e_lectura: false,
            rexion: Some(WramMirror),
            por_que: "$010000 é a metade baixa do banco 01: espello de WRAM",
        },
        Caso {
            profile: Profile::SnesHirom,
            state: MapperState::rom_size(0x10_0000),
            rom_len: 0x10_0000,
            cpu: 0x40_ff_f8,
            length: 0x10,
            e_lectura: true,
            rexion: None,
            por_que: "banco $40 completo: ROM e emenda no seguinte",
        },
        Caso {
            profile: Profile::SnesExhirom,
            state: MapperState::rom_size(0x50_0000),
            rom_len: 0x50_0000,
            cpu: 0x00_8000,
            length: 0x10,
            e_lectura: true,
            rexion: None,
            por_que: "metade alta de banco $00 = área 2, base 4MB",
        },
        Caso {
            profile: Profile::SnesExhirom,
            state: MapperState::rom_size(0x50_0000),
            rom_len: 0x50_0000,
            cpu: 0x20_6000,
            length: 0x10,
            e_lectura: false,
            rexion: Some(Sram),
            por_que: "$6000 do banco $20: SRAM con batería",
        },
    ];
    let mut ok = 0usize;
    let mut recusadas = 0usize;
    for caso in casos {
        let rom = imaxe(caso.rom_len);
        let req = solicitar(
            caso.profile,
            &caso.state,
            atestacion(&rom),
            caso.cpu,
            caso.length,
        );
        match (read_resource(&req, &rom), caso.e_lectura) {
            (Ok(got), true) => {
                ok += 1;
                assert_eq!(got.bytes.len(), caso.length as usize);
                assert_eq!(
                    got.segments
                        .iter()
                        .map(|s| s.cpu_len as usize)
                        .sum::<usize>(),
                    caso.length as usize
                );
                let mut visto = 0usize;
                for seg in &got.segments {
                    assert_eq!(seg.region, Region::Rom);
                    assert!(
                        (seg.rom_offset as usize) + seg.cpu_len as usize <= rom.len(),
                        "{:?} / {:#x}: segmento fóra da imaxe ({})",
                        caso.profile,
                        caso.cpu,
                        caso.por_que
                    );
                    assert_eq!(
                        &got.bytes[visto..visto + seg.cpu_len as usize],
                        banked::expect(seg.rom_offset as usize, seg.cpu_len as usize),
                        "{:?} / {:#x}: procedencia ≠ bytes",
                        caso.profile,
                        caso.cpu
                    );
                    visto += seg.cpu_len as usize;
                }
            }
            (Ok(got), false) => panic!(
                "{:?} / {:#x}: esperaba recusa ({}) e deu {} bytes en {} segmentos",
                caso.profile,
                caso.cpu,
                caso.por_que,
                got.bytes.len(),
                got.segments.len()
            ),
            (Err(err), true) => panic!(
                "{:?} / {:#x}: esperaba lectura ({}) e deu {:?}: {}",
                caso.profile, caso.cpu, caso.por_que, err.code, err.detail
            ),
            (Err(err), false) => {
                recusadas += 1;
                assert_eq!(
                    err.code,
                    ResourceErrorCode::NonRomRegion,
                    "{}",
                    caso.por_que
                );
                assert_eq!(err.region, caso.rexion, "{}", caso.por_que);
                let andan = err
                    .segments
                    .iter()
                    .map(|s| s.cpu_len as usize)
                    .sum::<usize>();
                assert!(
                    andan < caso.length as usize,
                    "{:?} / {:#x}: recusa con {andan} bytes completos (parcial non recusada?)",
                    caso.profile,
                    caso.cpu
                );
            }
        }
    }
    assert_eq!(ok, 6, "caseiros que esperaban éxito: {ok}");
    assert_eq!(recusadas, 4, "caseiros que esperaban recusa: {recusadas}");
}

#[test]
fn secuencia_de_bancos_e_unha_operacion_distinta() {
    let rom = imaxe(0x40_0000);
    let inicial = MapperState::ssf2(0x40_0000, &[]);

    // (a) un perfil sen rexistradores non pode pedir secuencia
    let lineal = MapperState::rom_size(0x8_0000);
    let err = read_sequence(
        &SequenceRequest {
            profile: Profile::MdLinear,
            image: atestacion(&imaxe(0x8_0000)),
            initial_state: &lineal,
            limits: Limits::DEFAULT,
            steps: &[Step::Read {
                cpu_address: 0x1000,
                length: 8,
            }],
        },
        &rom,
    )
    .expect_err("md-linear non ten rexistradores");
    assert_eq!(err.code, ResourceErrorCode::BadState);

    // (b) `$A13002` → xanela 1 (bits 1-3 da páxina), banco 5; `$A13004` →
    // xanela 2, banco 6. Despois de cada escrita, a lectura ve o novo estado.
    let informe = read_sequence(
        &SequenceRequest {
            profile: Profile::MdSsf2,
            image: atestacion(&rom),
            initial_state: &inicial,
            limits: Limits::DEFAULT,
            steps: &[
                Step::Read {
                    cpu_address: 0x08_0000,
                    length: 8,
                },
                Step::WriteRegister {
                    cpu_address: 0xa1_3002,
                    data: 5,
                },
                Step::Read {
                    cpu_address: 0x08_0000,
                    length: 8,
                },
                Step::WriteRegister {
                    cpu_address: 0xa1_3004,
                    data: 6,
                },
                Step::Read {
                    cpu_address: 0x10_0000,
                    length: 8,
                },
            ],
        },
        &rom,
    )
    .expect("secuencia SSF2");
    assert_eq!(informe.writes_applied, 2);
    assert_eq!(informe.reads.len(), 3);
    assert_eq!(
        informe.reads[0].segments[0].rom_offset, 0x08_0000,
        "identidade"
    );
    assert_eq!(
        informe.reads[1].segments[0].rom_offset, 0x28_0000,
        "banco 5"
    );
    assert_eq!(
        informe.reads[2].segments[0].rom_offset, 0x30_0000,
        "banco 6"
    );
    assert_eq!(informe.reads[1].bytes, banked::expect(0x28_0000, 8));
    assert_eq!(
        informe.reads[0].segments[0].state, inicial,
        "a primeira lectura ve o estado inicial"
    );
    assert_eq!(
        informe.reads[1].segments[0].state,
        MapperState::ssf2(0x40_0000, &[(1, 5)]),
        "a segunda ve o estado despois da primeira escrita"
    );
    assert_eq!(
        inicial,
        MapperState::ssf2(0x40_0000, &[]),
        "a secuencia non muta o estado que lle prestaron"
    );
    assert_eq!(
        informe.final_state,
        MapperState::ssf2(0x40_0000, &[(1, 5), (2, 6)])
    );
}

#[test]
fn unha_escrita_de_secuencia_invalida_recusase_a_operacion_completa() {
    let rom = imaxe(0x40_0000);
    let inicial = MapperState::ssf2(0x40_0000, &[]);
    // `$A13100` está fóra da páxina de rexistradores.
    let err = read_sequence(
        &SequenceRequest {
            profile: Profile::MdSsf2,
            image: atestacion(&rom),
            initial_state: &inicial,
            limits: Limits::DEFAULT,
            steps: &[
                Step::Read {
                    cpu_address: 0x1000,
                    length: 8,
                },
                Step::WriteRegister {
                    cpu_address: 0xa1_3100,
                    data: 5,
                },
            ],
        },
        &rom,
    )
    .expect_err("escrita fóra da páxina");
    assert_eq!(err.code, ResourceErrorCode::BadState);
    assert_eq!(
        err.segments.len(),
        1,
        "a lectura anterior queda na procedencia"
    );
    assert_eq!(err.address, Some(0xa1_3100));
    assert_eq!(
        inicial,
        MapperState::ssf2(0x40_0000, &[]),
        "unha secuencia rexeitada non deixa estado escrito"
    );
}
