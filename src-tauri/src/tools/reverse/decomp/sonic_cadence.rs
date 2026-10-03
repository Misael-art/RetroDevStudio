//! Cadence of the proven Sonic 1 Rev00 `id_Wait` sequence.
//!
//! Contract: `docs/rex_profiles/sonic_cadence/CONTRACT.md`. Addresses, tokens,
//! editable limits and refusals live here so the UI never reimplements them.
//! Only the single interval byte at `WAIT_ADDR` may change; every other byte
//! is out of scope. Effective durations are measured in emulated frames by
//! the Etapa 4 oracles, never asserted from this module.

use serde::{Deserialize, Serialize};

pub const EDIT_FORMAT: &str = "sonic1_wait_interval_byte";

/// `Ani_Sonic` table: 31 BE words, each relative to the table base.
pub const ANI_TABLE: usize = 0x13b48;
pub const ANI_COUNT: usize = 31;
pub const SCRIPTS_BASE: usize = ANI_TABLE + ANI_COUNT * 2;

/// Prologue of `Sonic_Animate` (`lea $13B48.l,a1 … move.b $1C(a0),d0 …`).
pub const SONIC_ANIMATE_PROLOGUE: &[u8] = &[
    0x43, 0xf9, 0x00, 0x01, 0x3b, 0x48, 0x70, 0x00, 0x10, 0x28, 0x00, 0x1c, 0xb0, 0x28, 0x00,
    0x1d,
];
/// Absolute-long operand inside that prologue; unique in the pinned ROM.
pub const TABLE_ABSOLUTE_REF: &[u8] = &[0x00, 0x01, 0x3b, 0x48];

pub const WAIT_ANIM: usize = 5;
pub const WAIT_ADDR: usize = 0x13bae;
pub const WAIT_ORIGINAL_INTERVAL: u8 = 0x17;
pub const WAIT_FRAMES: [u8; 18] = [
    0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x03, 0x02, 0x02,
    0x02, 0x03, 0x04,
];
pub const WAIT_TERMINATOR: [u8; 2] = [0xfe, 0x02];

pub const EDITABLE_MIN: u8 = 0x01;
pub const EDITABLE_MAX: u8 = 0x7f;

fn err(code: &str, detail: impl Into<String>) -> String {
    format!("{code}: {}", detail.into())
}

fn word(rom: &[u8], offset: usize) -> Result<usize, String> {
    rom.get(offset..offset + 2)
        .map(|b| usize::from(u16::from_be_bytes([b[0], b[1]])))
        .ok_or_else(|| err("cadence_rom_short", "palavra fora da ROM"))
}

fn find_all(rom: &[u8], pattern: &[u8]) -> Vec<usize> {
    if pattern.is_empty() || rom.len() < pattern.len() {
        return Vec::new();
    }
    (0..=rom.len() - pattern.len())
        .filter(|&i| rom[i..i + pattern.len()] == *pattern)
        .collect()
}

fn script_bytes_match(rom: &[u8], allow_original_interval: bool) -> Result<(), String> {
    let end = WAIT_ADDR + 1 + WAIT_FRAMES.len() + WAIT_TERMINATOR.len();
    if rom.len() < end {
        return Err(err("cadence_rom_short", "script do alvo truncado"));
    }
    if allow_original_interval && rom[WAIT_ADDR] != WAIT_ORIGINAL_INTERVAL {
        return Err(err(
            "cadence_base_interval",
            "byte de intervalo da base difere do contrato ($17)",
        ));
    }
    if rom[WAIT_ADDR + 1..WAIT_ADDR + 1 + WAIT_FRAMES.len()] != WAIT_FRAMES {
        return Err(err(
            "cadence_structure_mismatch",
            "sequência de frames do alvo não coincide com o contrato",
        ));
    }
    if rom[WAIT_ADDR + 1 + WAIT_FRAMES.len()..end] != WAIT_TERMINATOR {
        return Err(err(
            "cadence_structure_mismatch",
            "terminador afBack 2 ausente no script do alvo",
        ));
    }
    Ok(())
}

/// Revalidates the contract against the read-only base ROM: wrong variants,
/// moved tables, tampered consumers or altered scripts all refuse here.
pub fn validate_base(base: &[u8]) -> Result<(), String> {
    if base.len() <= SCRIPTS_BASE {
        return Err(err("cadence_rom_short", "ROM menor que a tabela Ani_Sonic"));
    }
    let entry = word(base, ANI_TABLE + WAIT_ANIM * 2)?;
    if ANI_TABLE + entry != WAIT_ADDR {
        return Err(err(
            "cadence_table_moved",
            "tabela não aponta o script comprovado do alvo",
        ));
    }
    for i in 0..ANI_COUNT {
        let offset = word(base, ANI_TABLE + i * 2)?;
        if ANI_TABLE + offset < SCRIPTS_BASE {
            return Err(err(
                "cadence_table_moved",
                format!("entrada {i} da tabela resolve antes do fim da própria tabela"),
            ));
        }
    }
    let prologues = find_all(base, SONIC_ANIMATE_PROLOGUE);
    if prologues.len() != 1 {
        return Err(err(
            "cadence_consumer_ambiguous",
            format!("prólogo de Sonic_Animate encontrado {} vezes", prologues.len()),
        ));
    }
    let references = find_all(base, TABLE_ABSOLUTE_REF);
    if references.len() != 1 {
        return Err(err(
            "cadence_consumer_ambiguous",
            "referência absoluta à tabela não é única",
        ));
    }
    let prologue = prologues[0];
    let reference = references[0];
    if !(prologue..prologue + SONIC_ANIMATE_PROLOGUE.len()).contains(&reference) {
        return Err(err(
            "cadence_consumer_ambiguous",
            "única referência absoluta está fora do único consumidor",
        ));
    }
    script_bytes_match(base, true)
}

/// Current interval byte of a working copy (base or accumulated edit). The
/// copy must still carry the contract's frames and terminator.
pub fn read_interval(rom: &[u8]) -> Result<u8, String> {
    script_bytes_match(rom, false)?;
    let value = rom[WAIT_ADDR];
    if value >= 0x80 {
        return Err(err(
            "cadence_copy_off_scope",
            "cópia carrega byte especial fora do intervalo editável",
        ));
    }
    Ok(value)
}

/// Writes the single duration byte into a working copy. Returns the previous
/// byte. Reserved values never touch the buffer.
pub fn set_interval(rom: &mut [u8], value: u8) -> Result<u8, String> {
    if value == 0 {
        return Err(err(
            "cadence_value_reserved",
            "0x00 é degenerado e não comprovado; recusado pelo contrato",
        ));
    }
    if value >= 0x80 {
        return Err(err(
            "cadence_value_reserved",
            "bit 7 ativa o handler especial walk/run/roll (duração dependente de velocidade)",
        ));
    }
    let previous = read_interval(rom)?;
    rom[WAIT_ADDR] = value;
    Ok(previous)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CadenceInfo {
    pub anim: usize,
    pub name: String,
    pub script_addr: u64,
    pub interval_addr: u64,
    pub original_interval: u8,
    pub current_interval: u8,
    pub frames: Vec<u8>,
    pub terminator: String,
    pub editable_min: u8,
    pub editable_max: u8,
    pub reserved: Vec<String>,
    pub unit: String,
    pub semantics: String,
    pub provenience: Vec<String>,
    pub limitations: Vec<String>,
    pub contract_path: String,
}

/// Serializable view used by the UI: frame order, current vs original byte,
/// limits, and the contract language around what is still unmeasured.
pub fn describe(base: &[u8], rom: &[u8]) -> Result<CadenceInfo, String> {
    validate_base(base)?;
    let current = read_interval(rom)?;
    Ok(CadenceInfo {
        anim: WAIT_ANIM,
        name: "id_Wait · Parado esperando".into(),
        script_addr: WAIT_ADDR as u64,
        interval_addr: WAIT_ADDR as u64,
        original_interval: WAIT_ORIGINAL_INTERVAL,
        current_interval: current,
        frames: WAIT_FRAMES.to_vec(),
        terminator: "afBack 2 — repete os dois últimos frames (batida de pé) para sempre".into(),
        editable_min: EDITABLE_MIN,
        editable_max: EDITABLE_MAX,
        reserved: vec![
            "0x00 — degenerado, não comprovado".into(),
            "0x80..0xFF — bit 7 é o handler especial de caminhada/corrida".into(),
        ],
        unit: "ticks da rotina de objetos (1 por frame de tela em 60 Hz; PAL não medido)".into(),
        semantics: "o byte recarrega o contador, que decresce 1 por tick e troca o frame ao ficar negativo; a relação exata entre o byte e frames exibidos será medida no core, não é afirmada aqui".into(),
        provenience: vec![
            "tabela Ani_Sonic em 0x13B48; script em 0x13BAE (offset de arquivo = CPU − $100000)".into(),
            "consumidor único Sonic_Animate em 0x139C4, referência absoluta única em 0x139C6".into(),
            "gatilho: parado em chão plano sem botões (Sonic_Move .notright, sites 0x12F02/0x131C2)".into(),
        ],
        limitations: vec![
            "perfil assistido Rev00 para uma ROM pinada; outras variantes serão recusadas".into(),
            "apenas a sequência id_Wait tem contrato; caminhada e corrida ficam fora por duração dependente de velocidade".into(),
            "duração efetiva e transições dependem da medição em frames emulados (Etapa 4)".into(),
        ],
        contract_path: "docs/rex_profiles/sonic_cadence/CONTRACT.md".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Author-shaped ROM with the contract's structures at their proven
    /// addresses — no commercial bytes are reproduced beyond the short
    /// patterns the contract pins.
    fn authored_base() -> Vec<u8> {
        let mut rom = vec![0u8; SCRIPTS_BASE + 0x100];
        for i in 0..ANI_COUNT {
            let offset = (SCRIPTS_BASE - ANI_TABLE) + i * 0x10;
            rom[ANI_TABLE + i * 2..ANI_TABLE + i * 2 + 2].copy_from_slice(&(offset as u16).to_be_bytes());
        }
        rom[ANI_TABLE + WAIT_ANIM * 2..ANI_TABLE + WAIT_ANIM * 2 + 2]
            .copy_from_slice(&((WAIT_ADDR - ANI_TABLE) as u16).to_be_bytes());
        rom[0x139c4..0x139c4 + SONIC_ANIMATE_PROLOGUE.len()]
            .copy_from_slice(SONIC_ANIMATE_PROLOGUE);
        rom[WAIT_ADDR] = WAIT_ORIGINAL_INTERVAL;
        rom[WAIT_ADDR + 1..WAIT_ADDR + 1 + WAIT_FRAMES.len()].copy_from_slice(&WAIT_FRAMES);
        let tail = WAIT_ADDR + 1 + WAIT_FRAMES.len();
        rom[tail..tail + WAIT_TERMINATOR.len()].copy_from_slice(&WAIT_TERMINATOR);
        // Keep every other table entry above SCRIPTS_BASE like the real ROM.
        rom.truncate(WAIT_ADDR + WAIT_FRAMES.len() + 3);
        rom.resize(WAIT_ADDR + 0x80, 0);
        rom
    }

    #[test]
    fn contract_validates_and_describes_without_reimplementing_in_ui() {
        let base = authored_base();
        validate_base(&base).unwrap();
        let info = describe(&base, &base).unwrap();
        assert_eq!(info.current_interval, 0x17);
        assert_eq!(info.frames.len(), 18);
        assert_eq!((info.editable_min, info.editable_max), (1, 0x7f));
    }

    #[test]
    fn wrong_variant_moved_table_and_tampered_consumer_refuse() {
        let mut rom = authored_base();
        rom.truncate(ANI_TABLE);
        assert!(validate_base(&rom).unwrap_err().contains("cadence_rom_short"));
        let mut rom = authored_base();
        rom[ANI_TABLE + WAIT_ANIM * 2 + 1] = 0x99;
        assert!(validate_base(&rom).unwrap_err().contains("cadence_table_moved"));
        let mut rom = authored_base();
        rom[0x139c4] = 0x00;
        assert!(validate_base(&rom)
            .unwrap_err()
            .contains("cadence_consumer_ambiguous"));
        let mut rom = authored_base();
        let tail = rom.len() + 16;
        rom.resize(tail, 0);
        rom[tail - 16..].copy_from_slice(SONIC_ANIMATE_PROLOGUE);
        assert!(validate_base(&rom)
            .unwrap_err()
            .contains("cadence_consumer_ambiguous"));
    }

    #[test]
    fn altered_origin_interval_and_frames_refuse() {
        let mut rom = authored_base();
        rom[WAIT_ADDR] = 0x18;
        assert!(validate_base(&rom)
            .unwrap_err()
            .contains("cadence_base_interval"));
        let mut rom = authored_base();
        rom[WAIT_ADDR + 5] = 0x09;
        assert!(validate_base(&rom)
            .unwrap_err()
            .contains("cadence_structure_mismatch"));
        let mut rom = authored_base();
        rom[WAIT_ADDR + 1 + WAIT_FRAMES.len()] = 0xff;
        assert!(validate_base(&rom)
            .unwrap_err()
            .contains("cadence_structure_mismatch"));
    }

    #[test]
    fn reserved_values_refuse_and_edit_writes_exactly_one_byte() {
        let base = authored_base();
        for value in [0x00u8, 0x80, 0xfe, 0xff] {
            let mut rom = base.clone();
            let message = set_interval(&mut rom, value).unwrap_err();
            assert!(message.contains("cadence_value_reserved"), "{message}");
            assert_eq!(rom, base, "recusa não pode alterar a cópia");
        }
        let mut rom = base.clone();
        assert_eq!(set_interval(&mut rom, 40).unwrap(), 0x17);
        assert_eq!(
            (0..rom.len())
                .filter(|&i| rom[i] != base[i])
                .collect::<Vec<_>>(),
            vec![WAIT_ADDR]
        );
        assert_eq!(read_interval(&rom).unwrap(), 40);
        // Accumulated copy keeps validating against the untouched base.
        let info = describe(&base, &rom).unwrap();
        assert_eq!((info.original_interval, info.current_interval), (0x17, 40));
        // A token-like or special byte in the copy is off-scope, not re-editable
        // as if it were plain.
        let mut tampered = base.clone();
        tampered[WAIT_ADDR] = 0x90;
        assert!(read_interval(&tampered)
            .unwrap_err()
            .contains("cadence_copy_off_scope"));
    }

    #[test]
    fn zero_padding_entries_before_scripts_base_refuse() {
        let mut rom = authored_base();
        // Entry that resolves inside the table itself (offset 0): the real
        // ROM has no such entry; the validator must refuse it.
        for i in 0..ANI_COUNT {
            if i != WAIT_ANIM {
                rom[ANI_TABLE + i * 2..ANI_TABLE + i * 2 + 2].copy_from_slice(&0u16.to_be_bytes());
            }
        }
        assert!(validate_base(&rom).unwrap_err().contains("cadence_table_moved"));
    }
}
