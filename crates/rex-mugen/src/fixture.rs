//! Fixture autoral "Probe" (personagem minimo e discriminante), gerada por codigo.
//!
//! Tudo aqui e autoral (sem conteudo de terceiros) e deterministico. `tests/fixture_probe.rs`
//! compara a saida com `fixtures/probe/` byte a byte; `REX_MUGEN_WRITE_FIXTURES=1` regrava.
//!
//! Discriminantes: sprites em L assimetricos, eixos diferentes, um sprite de tamanho
//! diferente, tempos 5/9 e 3/6/4/2, `Loopstart` no 2o frame, flip H e offset x=+2 por
//! frame, Clsn1 so no 2o frame do soco, Clsn2 padrao, comando `a` -> estado 200 -> 0.

use crate::sff::write::{sff_v1, Image};
use crate::sff::Rgb;

/// Cores ja na grade do VDP: 1 vermelho, 2 verde, 3 azul, 4 branco, 5 amarelo.
pub fn palette() -> Vec<Rgb> {
    let mut p = vec![[0u8, 0, 0]; 256];
    p[1] = [255, 0, 0];
    p[2] = [0, 255, 0];
    p[3] = [0, 0, 255];
    p[4] = [255, 255, 255];
    p[5] = [255, 255, 0];
    p
}

/// `w x h`, corpo (coluna de 4 px, cor `body`) a esquerda e pe (linha de 3 px no fundo,
/// cor `foot`) indo para a direita; `fist` = (y0, y1, x1, cor) pinta um braco ate `x1`.
fn l_shape(
    w: usize,
    h: usize,
    body: u8,
    foot: u8,
    fist: Option<(usize, usize, usize, u8)>,
) -> Vec<u8> {
    let mut px = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..4 {
            px[y * w + x] = body;
        }
    }
    for y in h - 3..h {
        for x in 4..w {
            px[y * w + x] = foot;
        }
    }
    if let Some((y0, y1, x1, c)) = fist {
        for y in y0..y1 {
            for x in 4..x1 {
                px[y * w + x] = c;
            }
        }
    }
    px
}

pub struct Files {
    pub def: String,
    pub air: String,
    pub cmd: String,
    pub cns: String,
    pub sff: Vec<u8>,
}

pub fn probe() -> Files {
    let pal = palette();
    let idle0 = l_shape(16, 24, 1, 2, None);
    let idle1 = l_shape(16, 24, 1, 3, None);
    let punch0 = l_shape(24, 24, 1, 2, Some((8, 12, 16, 4)));
    let punch1 = l_shape(20, 24, 5, 2, Some((6, 10, 20, 4)));
    let sff = sff_v1(&[
        Image {
            group: 0,
            image: 0,
            axis_x: 4,
            axis_y: 24,
            width: 16,
            height: 24,
            pixels: &idle0,
            palette: Some(&pal),
            link: None,
        },
        Image {
            group: 0,
            image: 1,
            axis_x: 4,
            axis_y: 24,
            width: 16,
            height: 24,
            pixels: &idle1,
            palette: None,
            link: None,
        },
        Image {
            group: 200,
            image: 0,
            axis_x: 4,
            axis_y: 24,
            width: 24,
            height: 24,
            pixels: &punch0,
            palette: None,
            link: None,
        },
        Image {
            group: 200,
            image: 1,
            axis_x: 6,
            axis_y: 24,
            width: 20,
            height: 24,
            pixels: &punch1,
            palette: None,
            link: None,
        },
    ]);
    let def = "; Probe: personagem autoral de teste (RetroDev rex-mugen)\n\
[Info]\nname = \"Probe\"\nauthor = \"RetroDev Studio (autoral)\"\n\n\
[Files]\ncmd = probe.cmd\ncns = probe.cns\nsprite = probe.sff\nanim = probe.air\n"
        .to_string();
    let air = "; Probe AIR\n\
[Begin Action 0]\n\
Clsn2Default: 1\n Clsn2[0] = -4, -24, 8, 0\n\
0,0, 0,0, 5\n\
0,1, 0,0, 9\n\
\n\
[Begin Action 200]\n\
Clsn2Default: 1\n Clsn2[0] = -4, -24, 8, 0\n\
200,0, 0,0, 3\n\
Loopstart\n\
Clsn1: 1\n Clsn1[0] = 8, -18, 16, -14\n\
200,1, 2,0, 6\n\
200,0, 0,0, 4, H\n\
0,0, 0,0, 2\n"
        .to_string();
    let cmd = "; Probe CMD\n\
[Command]\nname = \"a\"\ncommand = a\ntime = 1\n\n\
[Statedef -1]\n\n\
[State -1, Punch]\ntype = ChangeState\nvalue = 200\ntriggerall = command = \"a\"\ntrigger1 = stateno = 0\n"
        .to_string();
    let cns = "; Probe CNS\n\
[Statedef 0]\ntype = S\nanim = 0\n\n\
[Statedef 200]\ntype = S\nanim = 200\n\n\
[State 200, End]\ntype = ChangeState\ntrigger1 = AnimTime = 0\nvalue = 0\n"
        .to_string();
    Files {
        def,
        air,
        cmd,
        cns,
        sff,
    }
}
