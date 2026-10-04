//! In-place reordering of the Sonic 1 Rev00 `id_Wait` script's frame entries.
//!
//! This is the PART 2 increment: it moves the 18 frame-reference bytes at
//! `0x13BAF..0x13BC0` among themselves. It writes ONLY that window — the
//! interval byte at `0x13BAE` (the cadence domain, `sonic_cadence.rs`), the
//! terminator `FE 02`, the pad byte and the neighbouring script are never
//! touched. Addresses and refusals live here so the UI never reimplements
//! them. Contract: `docs/rex_profiles/sonic_sequencia/CONTRACT-SEQUENCIA.md`.

use super::sonic_cadence::{WAIT_ADDR, WAIT_FRAMES, WAIT_TERMINATOR};
use serde::{Deserialize, Serialize};

pub const EDIT_FORMAT: &str = "sonic1_wait_frame_order";

/// Start of the 18-entry frame region (the byte right after the interval).
pub const FRAMES_ADDR: usize = WAIT_ADDR + 1;
pub const FRAMES_LEN: usize = WAIT_FRAMES.len(); // 18
/// Inclusive end offset of the writable window (exclusive bound for slices).
pub const FRAMES_END: usize = FRAMES_ADDR + FRAMES_LEN;
pub const TERMINATOR_ADDR: usize = FRAMES_END;

fn err(code: &str, detail: impl Into<String>) -> String {
    format!("{code}: {}", detail.into())
}

/// Sorted multiset of the original frames — the invariant a reordering keeps.
fn original_multiset() -> [u8; FRAMES_LEN] {
    let mut v = WAIT_FRAMES;
    v.sort_unstable();
    v
}

/// Every value the script legitimately uses as a frame reference. Tokens
/// (`$FD..$FF`), `$00` and the special bit-7 range are never frames.
fn is_frame_value(b: u8) -> bool {
    matches!(b, 0x01..=0x04)
}

/// The working copy must still carry a valid interval, an untouched terminator
/// and a frames region that is a *permutation* of the original multiset (so a
/// reorder stays in scope while a tamper is refused).
fn check_copy(rom: &[u8]) -> Result<(), String> {
    let end = TERMINATOR_ADDR + WAIT_TERMINATOR.len();
    if rom.len() < end {
        return Err(err("seq_rom_short", "script do alvo truncado na copia"));
    }
    let interval = rom[WAIT_ADDR];
    if interval == 0 || interval >= 0x80 {
        return Err(err(
            "seq_base_mismatch",
            "copia carrega intervalo degenerado ou especial fora do contrato",
        ));
    }
    if rom[TERMINATOR_ADDR..end] != WAIT_TERMINATOR {
        return Err(err(
            "seq_base_mismatch",
            "terminador afBack 2 ausente ou adulterado na copia",
        ));
    }
    let mut seen = rom[FRAMES_ADDR..FRAMES_END].to_vec();
    if seen.iter().any(|b| !is_frame_value(*b)) {
        return Err(err(
            "seq_token_reserved",
            "regiao de molduras da copia contem byte que nao e referencia valida",
        ));
    }
    seen.sort_unstable();
    if seen != original_multiset() {
        return Err(err(
            "seq_frame_invalid",
            "multiconjunto de molduras da copia difere do contrato",
        ));
    }
    Ok(())
}

/// Current frame order of a working copy, after structural validation.
pub fn read_frames(rom: &[u8]) -> Result<Vec<u8>, String> {
    check_copy(rom)?;
    Ok(rom[FRAMES_ADDR..FRAMES_END].to_vec())
}

/// A proposal is valid only if it is exactly `FRAMES_LEN` long, every entry is
/// a frame reference, and it preserves the original multiset (a pure
/// permutation — no new values, no token, no length change).
fn validate_proposal(proposal: &[u8]) -> Result<(), String> {
    if proposal.len() != FRAMES_LEN {
        return Err(err(
            "seq_length_divergent",
            format!(
                "proposta tem {} entradas; o script exige exatamente {}",
                proposal.len(),
                FRAMES_LEN
            ),
        ));
    }
    if let Some(&b) = proposal.iter().find(|b| !is_frame_value(**b)) {
        return Err(err(
            "seq_token_reserved",
            format!("entrada {:#04x} nao e uma referencia de moldura", b),
        ));
    }
    let mut sorted = proposal.to_vec();
    sorted.sort_unstable();
    if sorted != original_multiset() {
        return Err(err(
            "seq_frame_invalid",
            "proposta altera o conjunto de molduras (so a ordem pode mudar)",
        ));
    }
    Ok(())
}

/// Reorders the 18 frame entries of a working copy in place. Returns the
/// previous order. Reserved/invalid proposals refuse before touching `rom`.
/// When the proposal equals the current order the copy is left untouched and
/// the no-op is reported as such (never a silent "edit").
pub fn permute(rom: &mut [u8], proposal: &[u8]) -> Result<PermuteOutcome, String> {
    check_copy(rom)?;
    validate_proposal(proposal)?;
    let previous: Vec<u8> = rom[FRAMES_ADDR..FRAMES_END].to_vec();
    if previous == proposal {
        return Ok(PermuteOutcome {
            previous,
            changed_offsets: Vec::new(),
            noop: true,
        });
    }
    rom[FRAMES_ADDR..FRAMES_END].copy_from_slice(proposal);
    let changed_offsets: Vec<usize> = (0..FRAMES_LEN)
        .filter(|&i| previous[i] != proposal[i])
        .map(|i| FRAMES_ADDR + i)
        .collect();
    // The write stayed strictly inside the authorized window.
    debug_assert!(changed_offsets
        .iter()
        .all(|&o| (FRAMES_ADDR..FRAMES_END).contains(&o)));
    Ok(PermuteOutcome {
        previous,
        changed_offsets,
        noop: false,
    })
}

/// Restores exactly the original frame order — and only the sequence. The
/// interval byte, terminator, pad and neighbours are never modified.
pub fn restore(rom: &mut [u8]) -> Result<Vec<u8>, String> {
    check_copy(rom)?;
    let previous = rom[FRAMES_ADDR..FRAMES_END].to_vec();
    rom[FRAMES_ADDR..FRAMES_END].copy_from_slice(&WAIT_FRAMES);
    Ok(previous)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PermuteOutcome {
    pub previous: Vec<u8>,
    pub changed_offsets: Vec<usize>,
    pub noop: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SequenceInfo {
    pub anim: usize,
    pub name: String,
    pub script_addr: u64,
    pub frames_addr: u64,
    pub frames_len: usize,
    pub original_frames: Vec<u8>,
    pub current_frames: Vec<u8>,
    pub changed_positions: Vec<usize>,
    pub terminator: String,
    pub loop_effect: String,
    pub valid_values: Vec<u8>,
    pub reserved: Vec<String>,
    pub provenience: Vec<String>,
    pub limitations: Vec<String>,
    pub contract_path: String,
}

/// Serializable view the UI renders: original vs current order, the positions
/// that differ, and the contract language about the terminator's loop.
pub fn describe(base: &[u8], rom: &[u8]) -> Result<SequenceInfo, String> {
    super::sonic_cadence::validate_base(base).map_err(|e| {
        // Re-label cadence base refusals under the sequence code namespace.
        err("seq_base_mismatch", e)
    })?;
    let current = read_frames(rom)?;
    let changed_positions: Vec<usize> = (0..FRAMES_LEN)
        .filter(|&i| current[i] != WAIT_FRAMES[i])
        .collect();
    Ok(SequenceInfo {
        anim: 5,
        name: "id_Wait · Parado esperando".into(),
        script_addr: WAIT_ADDR as u64,
        frames_addr: FRAMES_ADDR as u64,
        frames_len: FRAMES_LEN,
        original_frames: WAIT_FRAMES.to_vec(),
        current_frames: current,
        changed_positions,
        terminator: "FE 02 — afBack k=2 (preservado; este incremento nunca o reescreve)".into(),
        loop_effect: "o loop fixa as duas ULTIMAS POSICOES do script; reordenar entradas distintas muda tanto o primeiro frame exibido quanto o par que se repete para sempre".into(),
        valid_values: vec![0x01, 0x02, 0x03, 0x04],
        reserved: vec![
            "0x00 e 0x80..0xFF — nunca sao molduras".into(),
            "0xFD, 0xFE, 0xFF — tokens de script, recusados como entrada".into(),
            "multiconjunto deve permanecer {01x12, 02x3, 03x2, 04} — so a ordem muda".into(),
        ],
        provenience: vec![
            "script id_Wait em 0x13BAE; janela escrevivel 0x13BAF..0x13BC0 (18 entradas)".into(),
            "consumidor unico Sonic_Animate via tabela Ani_Sonic em 0x13B48 (anim 5)".into(),
            "anim 6 comeca em 0x13BC4 e o pad 0x13BC3 fica fora desta janela".into(),
        ],
        limitations: vec![
            "perfil assistido Rev00 para a ROM pinada; outras variantes recusadas".into(),
            "so a ORDEM das 18 entradas muda; duracao (0x13BAE), pixel e paleta permanecem intactos".into(),
            "nao ha jornada de edicao mista ordem+duracao nesta frente (os dois editores escrevem faixas disjointes mas o cadencia revalida a copia em ordem exata)".into(),
        ],
        contract_path: "docs/rex_profiles/sonic_sequencia/CONTRACT-SEQUENCIA.md".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::super::sonic_cadence::{
        ANI_COUNT, ANI_TABLE, SCRIPTS_BASE, SONIC_ANIMATE_PROLOGUE, WAIT_ANIM,
    };
    use super::*;

    /// Author-shaped base ROM with the contract structures at their proven
    /// addresses (same shape as the cadence tests). No commercial bytes beyond
    /// the pinned short patterns are reproduced.
    fn authored_base() -> Vec<u8> {
        let mut rom = vec![0u8; SCRIPTS_BASE + 0x100];
        for i in 0..ANI_COUNT {
            let offset = (SCRIPTS_BASE - ANI_TABLE) + i * 0x10;
            rom[ANI_TABLE + i * 2..ANI_TABLE + i * 2 + 2]
                .copy_from_slice(&(offset as u16).to_be_bytes());
        }
        rom[ANI_TABLE + WAIT_ANIM * 2..ANI_TABLE + WAIT_ANIM * 2 + 2]
            .copy_from_slice(&((WAIT_ADDR - ANI_TABLE) as u16).to_be_bytes());
        rom[0x139c4..0x139c4 + SONIC_ANIMATE_PROLOGUE.len()]
            .copy_from_slice(SONIC_ANIMATE_PROLOGUE);
        rom[WAIT_ADDR] = 0x17;
        rom[FRAMES_ADDR..FRAMES_END].copy_from_slice(&WAIT_FRAMES);
        rom[TERMINATOR_ADDR..TERMINATOR_ADDR + WAIT_TERMINATOR.len()]
            .copy_from_slice(&WAIT_TERMINATOR);
        rom[TERMINATOR_ADDR + WAIT_TERMINATOR.len()] = 0x00; // pad
        rom.resize(WAIT_ADDR + 0x80, 0);
        rom
    }

    /// The pre-frozen discriminating proof: move the first `03` (index 12) to
    /// position 0. Multiset preserved; the byte stream actually changes.
    fn discriminating_proposal() -> [u8; FRAMES_LEN] {
        let mut p = WAIT_FRAMES;
        p.swap(0, 12); // 03,01,01,...,03(->was 01 at idx12)...  -> first frame becomes 03
        p
    }

    #[test]
    fn describe_reads_original_order_with_no_changes() {
        let base = authored_base();
        let info = describe(&base, &base).unwrap();
        assert_eq!(info.original_frames, WAIT_FRAMES.to_vec());
        assert_eq!(info.current_frames, WAIT_FRAMES.to_vec());
        assert!(info.changed_positions.is_empty());
        assert_eq!(info.frames_len, 18);
    }

    #[test]
    fn discriminating_permutation_changes_bytes_only_inside_window() {
        let base = authored_base();
        let proposal = discriminating_proposal();
        assert_ne!(
            &proposal[..],
            &WAIT_FRAMES[..],
            "a prova deve ser nao-vacia"
        );
        let mut rom = base.clone();
        let out = permute(&mut rom, &proposal).unwrap();
        assert!(!out.noop);
        // Only positions inside the authorized window may differ vs base.
        let diffs: Vec<usize> = (0..rom.len()).filter(|&i| rom[i] != base[i]).collect();
        assert!(
            diffs
                .iter()
                .all(|&i| (FRAMES_ADDR..FRAMES_END).contains(&i)),
            "escrita vazou para fora da janela: {diffs:?}"
        );
        // Interval, terminator, pad and neighbour are byte-for-byte intact.
        assert_eq!(rom[WAIT_ADDR], base[WAIT_ADDR]);
        assert_eq!(
            &rom[TERMINATOR_ADDR..TERMINATOR_ADDR + 2],
            &WAIT_TERMINATOR[..]
        );
        assert_eq!(rom[TERMINATOR_ADDR + 2], 0x00);
        // The written region equals the proposal and stays a valid permutation.
        assert_eq!(&rom[FRAMES_ADDR..FRAMES_END], &proposal[..]);
        read_frames(&rom).unwrap();
        let info = describe(&base, &rom).unwrap();
        assert_eq!(info.current_frames, proposal.to_vec());
        assert!(info.changed_positions.contains(&0));
    }

    #[test]
    fn restore_returns_only_the_sequence_to_original() {
        let base = authored_base();
        let mut rom = base.clone();
        permute(&mut rom, &discriminating_proposal()).unwrap();
        let prev = restore(&mut rom).unwrap();
        assert_eq!(prev, discriminating_proposal().to_vec());
        assert_eq!(&rom[FRAMES_ADDR..FRAMES_END], &WAIT_FRAMES[..]);
        // After restore the whole copy equals the base again.
        assert_eq!(
            rom, base,
            "restaurar so a sequencia deve voltar a copia integral"
        );
    }

    #[test]
    fn noop_permutation_does_not_touch_copy() {
        let base = authored_base();
        let mut rom = base.clone();
        let out = permute(&mut rom, &WAIT_FRAMES).unwrap();
        assert!(out.noop);
        assert!(out.changed_offsets.is_empty());
        assert_eq!(rom, base);
    }

    #[test]
    fn swapping_identical_entries_is_still_a_noop_stream() {
        // Swapping two equal `01` bytes yields the same stream: permute must
        // treat it as a no-op (previous == proposal), the discriminating case
        // is exercised elsewhere with distinct values.
        let base = authored_base();
        let mut proposal = WAIT_FRAMES;
        proposal.swap(0, 1); // both 0x01
        let mut rom = base.clone();
        let out = permute(&mut rom, &proposal).unwrap();
        assert!(out.noop, "troca de identicos nao e prova e nao deve gravar");
        assert_eq!(rom, base);
    }

    #[test]
    fn negatives_refuse_without_writing() {
        let base = authored_base();
        let untouched = |rom: &[u8]| rom == base;

        // seq_length_divergent
        let mut rom = base.clone();
        assert!(permute(&mut rom, &[0x01u8; 17])
            .unwrap_err()
            .contains("seq_length_divergent"));
        assert!(untouched(&rom));

        // seq_token_reserved (a token byte in the proposal)
        let mut tok = WAIT_FRAMES;
        tok[0] = 0xFE;
        let mut rom = base.clone();
        assert!(permute(&mut rom, &tok)
            .unwrap_err()
            .contains("seq_token_reserved"));
        assert!(untouched(&rom));

        // seq_frame_invalid (multiset changed: an extra 04 replacing a 01)
        let mut bad = WAIT_FRAMES;
        bad[1] = 0x04; // now 01x11, 04x2 ... multiset differs
        let mut rom = base.clone();
        assert!(permute(&mut rom, &bad)
            .unwrap_err()
            .contains("seq_frame_invalid"));
        assert!(untouched(&rom));

        // seq_frame_invalid (value out of domain, e.g. 0x07, even if it kept size)
        let mut dom = WAIT_FRAMES;
        dom[2] = 0x07;
        let mut rom = base.clone();
        assert!(permute(&mut rom, &dom)
            .unwrap_err()
            .contains("seq_token_reserved"));
        assert!(untouched(&rom));
    }

    #[test]
    fn tampered_copy_is_refused_as_base_mismatch() {
        // Working copy with an altered terminator must be refused before any
        // reorder or restore.
        let mut rom = authored_base();
        rom[TERMINATOR_ADDR + 1] = 0x03;
        assert!(permute(&mut rom, &discriminating_proposal())
            .unwrap_err()
            .contains("seq_base_mismatch"));
        assert!(restore(&mut rom).unwrap_err().contains("seq_base_mismatch"));

        // Copy with a degenerate/special interval byte is likewise refused.
        let mut rom = authored_base();
        rom[WAIT_ADDR] = 0x90;
        assert!(read_frames(&rom).unwrap_err().contains("seq_base_mismatch"));
    }

    #[test]
    fn describe_refuses_moved_table_variant() {
        let mut base = authored_base();
        base[ANI_TABLE + WAIT_ANIM * 2 + 1] = 0x99; // table points elsewhere
        assert!(describe(&base, &base)
            .unwrap_err()
            .contains("seq_base_mismatch"));
    }
}
