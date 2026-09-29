//! A fixture versionada e exatamente a saida do gerador, e o plano bate com expectativas
//! derivadas do desenho da fixture (nao do parser).

use std::path::PathBuf;

use rex_mugen::diag::Fidelity;
use rex_mugen::plan::{plan, Inputs};
use rex_mugen::{air, fixture, sff, sha256::sha256_hex};

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/probe")
}

fn check_committed(name: &str, f: fixture::Files) {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(name);
    let files: [(String, &[u8]); 5] = [
        (format!("{name}.def"), f.def.as_bytes()),
        (format!("{name}.air"), f.air.as_bytes()),
        (format!("{name}.cmd"), f.cmd.as_bytes()),
        (format!("{name}.cns"), f.cns.as_bytes()),
        (format!("{name}.sff"), &f.sff),
    ];
    if std::env::var("REX_MUGEN_WRITE_FIXTURES").is_ok() {
        std::fs::create_dir_all(&dir).unwrap();
        for (file, bytes) in &files {
            std::fs::write(dir.join(file), bytes).unwrap();
        }
    }
    for (file, bytes) in &files {
        let disk = std::fs::read(dir.join(file)).unwrap_or_else(|_| panic!("{file} ausente"));
        assert_eq!(
            &disk[..],
            *bytes,
            "{file} diverge do gerador (sha {})",
            sha256_hex(&disk)
        );
    }
}

#[test]
fn committed_walker_is_reproducible() {
    check_committed("walker", fixture::walker());
}

#[test]
fn committed_warden_is_reproducible() {
    check_committed("warden", fixture::warden());
}

#[test]
fn committed_sentinel_is_reproducible() {
    check_committed("sentinel", fixture::sentinel());
}

#[test]
fn committed_fixture_is_reproducible() {
    let f = fixture::probe();
    let files: [(&str, &[u8]); 5] = [
        ("probe.def", f.def.as_bytes()),
        ("probe.air", f.air.as_bytes()),
        ("probe.cmd", f.cmd.as_bytes()),
        ("probe.cns", f.cns.as_bytes()),
        ("probe.sff", &f.sff),
    ];
    if std::env::var("REX_MUGEN_WRITE_FIXTURES").is_ok() {
        std::fs::create_dir_all(dir()).unwrap();
        for (name, bytes) in files {
            std::fs::write(dir().join(name), bytes).unwrap();
        }
    }
    for (name, bytes) in files {
        let disk = std::fs::read(dir().join(name)).unwrap_or_else(|_| panic!("{name} ausente"));
        assert_eq!(
            disk,
            bytes,
            "{name} diverge do gerador (sha {})",
            sha256_hex(&disk)
        );
    }
}

#[test]
fn plan_matches_the_fixture_design() {
    let f = fixture::probe();
    let a = air::parse(&f.air, "probe.air");
    let s = sff::parse(&f.sff, "probe.sff").unwrap();
    assert!(a.diagnostics.is_empty() && s.diagnostics.is_empty());
    let p = plan(&Inputs {
        air: &a,
        air_sha256: &sha256_hex(f.air.as_bytes()),
        sff: &s,
        sff_sha256: &sha256_hex(&f.sff),
        actions: &[0, 200],
    })
    .unwrap();
    // Eixo comum: max(axis_x)=6, max(axis_y)=24; largura = 6 + max(w - ax) = 6 + 20 = 26 -> 32.
    assert_eq!(
        (p.anchor_x, p.anchor_y, p.cell_w, p.cell_h),
        (6, 24, 32, 24)
    );
    assert_eq!(p.cells.len(), 4);
    let idle = &p.actions[&0];
    assert_eq!(idle.rescomp_times(), "[5,9]");
    assert_eq!(idle.loopstart, 0);
    let punch = &p.actions[&200];
    assert_eq!(punch.rescomp_times(), "[3,6,4,2]");
    assert_eq!(punch.loopstart, 1);
    assert_eq!((punch.frames[1].x, punch.frames[2].hflip), (2, true));
    assert_eq!(punch.frames[1].clsn1.len(), 1);
    assert!(punch
        .frames
        .iter()
        .enumerate()
        .all(|(i, f)| (i == 1) == !f.clsn1.is_empty()));
    assert!(punch.frames.iter().all(|f| f.clsn2.len() == 1));
    assert_eq!(
        (idle.fidelity, punch.fidelity),
        (Fidelity::Direct, Fidelity::Direct)
    );
    assert!(p.needs_runtime.loopstart && p.needs_runtime.frame_table && p.needs_runtime.clsn_table);
    // Paleta: 5 cores ja na grade, nenhuma troca.
    assert_eq!(
        (
            p.palette.distinct_vdp_colors,
            p.palette.merged_pixels,
            p.palette.rounded_pixels
        ),
        (5, 0, 0)
    );
    // Pixel: sprite (0,0) tem eixo (4,24) -> dx = 6-4 = 2; canto inferior direito do pe = verde.
    let cell = p.render_cell(&s, 0);
    assert_eq!(cell[23 * 32 + 2 + 15], Some([0, 255, 0]));
    assert_eq!(cell[2], Some([255, 0, 0]));
    assert_eq!(cell[1], None);
    // Metrica indisponivel nao vira zero.
    let hw = p
        .metrics
        .iter()
        .find(|m| m.name == "hardware_sprites_per_frame")
        .unwrap();
    assert!(hw.value.is_none() && hw.availability.starts_with("indisponivel"));
}
