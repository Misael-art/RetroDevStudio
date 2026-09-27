// SEGUNDA referencia: un matcher xenerico de xanelas declarativas, reimplementado
// en Rust a partir da descrición formal dos primitivos de bsnes (`reduce`,
// `mirror`, `Bus::map`) e das táboas declarativas da rodada 1-2.
//
// Por que isto non é a mesma fórmula duplicada:
//  - os perfis do crate son aritmética pechada por perfil (if-cadeas + máscara);
//  - aquí as xanelas ROM SNES **lense** de `vectors/windows-generated.json`,
//    extraído mecanicamente do `boards.bml` crudo de bsnes@7d5aa1e (cuxa SHA se
//    comproba antes de usar), e compoñense cun único `map` xenérico;
//  - as rexións internas van como **datos** (bancos, range, regra de offset);
//  - SSF2 simula a **táboa de 64 páxinas** de GPGX, reescrita por escritas de
//    rexistrador — estrutura distinta da aritmética de xanelas do perfil.
//
// Só para tests: non se exporta dende o crate.

use super::json::Json;
use super::sha256::sha256_hex;

pub const WINDOWS_SHA256: &str =
    "2de90492ed92066eb524f83f9985d84ada97e80987ff2705d554b14f86b115fa";
pub const BUS_LIMIT: u64 = 0xff_ffff;

#[derive(Clone, Debug)]
pub struct Window {
    pub banks: Vec<(u64, u64)>,
    pub a: (u64, u64),
    pub base: u64,
    pub mask: u64,
}

#[derive(Clone, Copy, Debug)]
pub enum OffsetRule {
    /// `offset = a` (endereço interno do banco).
    AIdentity,
    /// `offset = addr & m` sobre o enderezo completo do bus.
    AddrMask(u64),
    /// `offset = a & m`.
    AMask(u64),
    /// `offset = addr - base` (páxina/I-O con orixe fixa).
    AddrSub(u64),
}

#[derive(Clone, Debug)]
pub enum RowKind {
    Region { region: &'static str, rule: OffsetRule },
    Error(&'static str),
}

#[derive(Clone, Debug)]
pub struct InternalRow {
    pub banks: Vec<(u64, u64)>,
    pub addr: Option<(u64, u64)>,
    pub kind: RowKind,
}

#[derive(Clone, Debug)]
pub struct Table {
    pub windows: Vec<Window>,
    pub internal: Vec<InternalRow>,
    pub rom_size: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Engine {
    Ok { region: String, offset: u64 },
    Err(String),
}

fn bank_in(bank: u64, ranges: &[(u64, u64)]) -> bool {
    ranges.iter().any(|(lo, hi)| bank >= *lo && bank <= *hi)
}

/// `reduce(A, mask)`: borra os bits indicados en `mask` e **compacta** os
/// superiores cara abaixo (descrición formal, non transcripción).
pub fn reduce_address(a: u64, mask: u64) -> u64 {
    if mask == 0 {
        return a;
    }
    let mut result = 0u64;
    let mut write_bit = 0u32;
    for bit in 0..=23u32 {
        if (mask >> bit) & 1 == 1 {
            continue;
        }
        if (a >> bit) & 1 == 1 {
            result |= 1 << write_bit;
        }
        write_bit += 1;
    }
    result
}

/// `mirror(x, size)` no dominio que este motor exercita: identidade cando
/// `x < size`, plegada de máscara cando `size` é potencia de 2. Fóra dese
/// dominio, falla ruidosamente en vez de inventar una plegada hierárquica.
pub fn mirror_mod(x: u64, size: u64) -> u64 {
    if size == 0 {
        return 0;
    }
    if x < size {
        return x;
    }
    assert!(
        size.is_power_of_two(),
        "mirrorMod fóra do dominio probado: x=0x{x:x} size=0x{size:x}"
    );
    x & (size - 1)
}

/// `Bus::map`: `offset = reduce(A, mask)`; `base = mirror(base, size)`;
/// `offset = base + mirror(offset, size - base)`.
pub fn bsnes_map_offset(addr: u64, win: &Window, rom_size: u64) -> u64 {
    let reduced = reduce_address(addr, win.mask);
    let base = mirror_mod(win.base, rom_size);
    base + mirror_mod(reduced, rom_size - base)
}

fn apply_rule(rule: OffsetRule, addr: u64, a: u64) -> u64 {
    match rule {
        OffsetRule::AIdentity => a,
        OffsetRule::AddrMask(m) => addr & m,
        OffsetRule::AMask(m) => a & m,
        OffsetRule::AddrSub(base) => addr - base,
    }
}

fn match_internal(rows: &[InternalRow], addr: u64) -> Option<Engine> {
    let bank = (addr >> 16) & 0xff;
    let a = addr & 0xffff;
    for r in rows {
        if let Some((lo, hi)) = r.addr {
            if !(a >= lo && a <= hi) {
                continue;
            }
        }
        if !bank_in(bank, &r.banks) {
            continue;
        }
        return Some(match &r.kind {
            RowKind::Error(code) => Engine::Err((*code).to_string()),
            RowKind::Region { region, rule } => Engine::Ok {
                region: (*region).to_string(),
                offset: apply_rule(*rule, addr, a),
            },
        });
    }
    None
}

impl Table {
    pub fn translate(&self, addr: u64) -> Engine {
        if addr > BUS_LIMIT {
            return Engine::Err("out-of-range".into());
        }
        let bank = (addr >> 16) & 0xff;
        let a = addr & 0xffff;
        for w in &self.windows {
            if bank_in(bank, &w.banks) && a >= w.a.0 && a <= w.a.1 {
                return Engine::Ok {
                    region: "rom".into(),
                    offset: bsnes_map_offset(addr, w, self.rom_size),
                };
            }
        }
        match_internal(&self.internal, addr).unwrap_or_else(|| Engine::Err("unsupported".into()))
    }
}

// ------------------------------------------------------------------ táboas

/// Ventanas ROM dun taboleiro SNES, lidas do ficheiro xerado (procedencia
/// verificada por SHA).
pub fn snes_table(board: &str, rom_size: u64, internal: Vec<InternalRow>) -> Table {
    Table {
        windows: board_rom_windows(board),
        internal,
        rom_size,
    }
}

pub fn windows_json() -> Json {
    let src = include_str!("../../vectors/windows-generated.json");
    let digest = sha256_hex(src.as_bytes());
    assert_eq!(
        digest, WINDOWS_SHA256,
        "windows-generated.json non coincide coa SHA pinada"
    );
    Json::parse(src).expect("windows-generated.json inválido")
}

pub fn board_rom_windows(board: &str) -> Vec<Window> {
    let doc = windows_json();
    let boards = doc.get("boards").and_then(Json::obj).expect("boards");
    let node = boards
        .iter()
        .find(|(k, _)| k == board)
        .map(|(_, v)| v)
        .unwrap_or_else(|| panic!("taboleiro {board} ausente"));
    let wins = node
        .get("rom_windows")
        .and_then(Json::arr)
        .expect("rom_windows");
    wins.iter()
        .map(|w| {
            let banks = w
                .get("banks")
                .and_then(Json::arr)
                .expect("banks")
                .iter()
                .map(|pair| {
                    let p = pair.arr().expect("par [lo,hi]");
                    (p[0].as_u64().expect("lo"), p[1].as_u64().expect("hi"))
                })
                .collect();
            let a = w.get("a").and_then(Json::arr).expect("a");
            Window {
                banks,
                a: (a[0].as_u64().expect("a.lo"), a[1].as_u64().expect("a.hi")),
                base: w.get("base").and_then(Json::as_u64).unwrap_or(0),
                mask: w.get("mask").and_then(Json::as_u64).unwrap_or(0),
            }
        })
        .collect()
}

/// Rexións internas de SNES (terceira representación dos mesmos feitos
/// documentais: bancos + range + regra de offset, coa cita de orixe no
// `internal-regions.mjs` da rodada 1-2).
fn snes_wram() -> InternalRow {
    InternalRow {
        banks: vec![(0x7e, 0x7f)],
        addr: None,
        kind: RowKind::Region {
            region: "wram",
            rule: OffsetRule::AIdentity,
        },
    }
}

fn snes_mirror_and_io() -> Vec<InternalRow> {
    let low_banks = vec![(0x00, 0x3d), (0x80, 0xbd)];
    vec![
        InternalRow {
            banks: low_banks.clone(),
            addr: Some((0x0000, 0x1fff)),
            kind: RowKind::Region {
                region: "wram-mirror",
                rule: OffsetRule::AMask(0x1fff),
            },
        },
        InternalRow {
            banks: low_banks,
            addr: Some((0x2000, 0x7fff)),
            kind: RowKind::Region {
                region: "io",
                rule: OffsetRule::AIdentity,
            },
        },
    ]
}

pub fn snes_lorom_table(rom_size: u64) -> Table {
    let mut internal = vec![snes_wram()];
    internal.push(snes_sram_lorom());
    internal.extend(snes_mirror_and_io());
    internal.push(InternalRow {
        banks: vec![(0x40, 0x7d), (0xc0, 0xff)],
        addr: Some((0x0000, 0x7fff)),
        kind: RowKind::Error("ambiguous"),
    });
    Table {
        windows: board_rom_windows("LOROM"),
        internal,
        rom_size,
    }
}

fn snes_sram_lorom() -> InternalRow {
    InternalRow {
        banks: vec![(0x70, 0x7d), (0xf0, 0xff)],
        addr: Some((0x0000, 0x7fff)),
        kind: RowKind::Region {
            region: "sram",
            rule: OffsetRule::AMask(0x7fff),
        },
    }
}

fn hirom_sram() -> InternalRow {
    InternalRow {
        banks: vec![(0x20, 0x3f), (0xa0, 0xbf)],
        addr: Some((0x6000, 0x7fff)),
        kind: RowKind::Region {
            region: "sram",
            rule: OffsetRule::AMask(0x1fff),
        },
    }
}

pub fn snes_hirom_table(rom_size: u64) -> Table {
    let mut internal = vec![snes_wram(), hirom_sram()];
    internal.extend(snes_mirror_and_io());
    Table {
        windows: board_rom_windows("HIROM"),
        internal,
        rom_size,
    }
}

pub fn snes_exhirom_table(rom_size: u64) -> Table {
    let mut internal = vec![snes_wram(), hirom_sram()];
    internal.extend(snes_mirror_and_io());
    Table {
        windows: board_rom_windows("EXHIROM"),
        internal,
        rom_size,
    }
}

/// Mega Drive: xanela de cartucho como pseudo-ventoia bsnes (sen mask/base =>
/// mirror lineal) + táboa interna declarativa.
pub fn md_linear_table(rom_size: u64) -> Table {
    Table {
        windows: vec![Window {
            banks: vec![(0x00, 0x3f)],
            a: (0x0000, 0xffff),
            base: 0,
            mask: 0,
        }],
        internal: md_internal_rows(),
        rom_size,
    }
}

fn md_internal_rows() -> Vec<InternalRow> {
    let mut rows = Vec::new();
    for (lo, hi) in [(0x0000u64, 0x3fffu64), (0x8000, 0xbfff)] {
        rows.push(InternalRow {
            banks: vec![(0xa0, 0xa0)],
            addr: Some((lo, hi)),
            kind: RowKind::Region {
                region: "z80-ram",
                rule: OffsetRule::AMask(0x1fff),
            },
        });
    }
    for (lo, hi) in [(0x4000u64, 0x7fffu64), (0xc000, 0xffff)] {
        rows.push(InternalRow {
            banks: vec![(0xa0, 0xa0)],
            addr: Some((lo, hi)),
            kind: RowKind::Error("unsupported"),
        });
    }
    rows.push(InternalRow {
        banks: vec![(0xa1, 0xa1)],
        addr: Some((0x3000, 0x30ff)),
        kind: RowKind::Region {
            region: "cart-io",
            rule: OffsetRule::AddrSub(0xa13000),
        },
    });
    rows.push(InternalRow {
        banks: vec![(0xa1, 0xa1)],
        addr: Some((0x0000, 0xffff)),
        kind: RowKind::Region {
            region: "io",
            rule: OffsetRule::AddrSub(0xa10000),
        },
    });
    rows.push(InternalRow {
        banks: vec![(0xe0, 0xff)],
        addr: None,
        kind: RowKind::Region {
            region: "work-ram",
            rule: OffsetRule::AIdentity,
        },
    });
    rows
}

pub fn table_for(profile: &str, state_rom_size: u64) -> Table {
    match profile {
        "md-linear" => md_linear_table(state_rom_size),
        "snes-lorom" => snes_lorom_table(state_rom_size),
        "snes-hirom" => snes_hirom_table(state_rom_size),
        "snes-exhirom" => snes_exhirom_table(state_rom_size),
        other => panic!("perfil {other} sen táboa de referencia (ssf2 usa Ssf2Engine)"),
    }
}

// ------------------------------------------------- SSF2: táboa de páxinas

/// Simulación literal do modelo de 64 páxinas de GPGX: cada escrita de
/// rexistrador reescribe 8 páxinas de 64KB. `banks` é só o estado observable.
pub struct Ssf2Engine {
    pages: [u64; 64],
}

impl Ssf2Engine {
    pub fn new(rom_size: u64, banks: &[(u64, u64)]) -> Ssf2Engine {
        let mask = rom_size - 1;
        let mut pages = [0u64; 64];
        for (p, slot) in pages.iter_mut().enumerate() {
            *slot = ((p as u64) << 16) & mask;
        }
        let mut engine = Ssf2Engine { pages };
        for w in 1..=7u64 {
            let data = banks
                .iter()
                .find(|(k, _)| *k == w)
                .map(|(_, v)| *v)
                .unwrap_or(w);
            engine.write_register(0xa13000 | (w << 1), data, rom_size);
        }
        engine
    }

    /// `mapper_ssf2_w` + `mapper_512k_w`: só a páxina TIME, só slots != 0.
    pub fn write_register(&mut self, addr: u64, data: u64, rom_size: u64) {
        if addr < 0xa13000 || addr > 0xa130ff {
            return;
        }
        if addr & 0x0e == 0 {
            return;
        }
        let mask = rom_size - 1;
        let slot = (((addr << 2) & 0x38) >> 3) as usize;
        let src = (data << 19) & mask;
        for i in 0..8usize {
            self.pages[(slot << 3) + i] = (src + ((i as u64) << 16)) & mask;
        }
    }

    pub fn translate(&self, addr: u64) -> Engine {
        if addr > BUS_LIMIT {
            return Engine::Err("out-of-range".into());
        }
        if addr <= 0x3f_ffff {
            return Engine::Ok {
                region: "rom".into(),
                offset: self.pages[(addr >> 16) as usize] + (addr & 0xffff),
            };
        }
        md_ssf2_non_rom(addr)
    }

    pub fn page(&self, index: usize) -> u64 {
        self.pages[index]
    }
}

/// Rexións internas no rango alto do bus do 68K, en forma de datos.
pub fn md_ssf2_non_rom(addr: u64) -> Engine {
    match_internal(&md_internal_rows(), addr).unwrap_or_else(|| Engine::Err("unsupported".into()))
}
