//! Fixture autoral "Probe" (personagem minimo e discriminante), gerada por codigo.
//!
//! Todo PCX grava a paleta (valido com ou sem a flag `same_palette`); os sprites
//! seguintes marcam `same_palette = 1`.
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
            same_palette: false,
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
            palette: Some(&pal),
            same_palette: true,
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
            palette: Some(&pal),
            same_palette: true,
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
            palette: Some(&pal),
            same_palette: true,
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

/// Segunda amostra autoral ("Sentinel"), desenhada DEPOIS do congelamento do conversor
/// (`data/rex_profiles/mugen_sgdk/evidence/2026-09-28-sentinel/FREEZE.md`).
///
/// Previsao registrada aqui, antes de qualquer execucao:
/// * celula 40x48, eixo (20,48); entidade em (96,96) -> eixo na tela (116,144);
/// * paleta: 17 cores VDP distintas -> 2 cores menos usadas (pontos de 1 px) fundidas:
///   `palette` aproximado com `merged_pixels` = 2;
/// * action 0 (idle): 8 + 8 ticks, sem Loopstart; Clsn2 POR FRAME: 1 caixa, depois 2;
///   corpo ciano (x 112..119) e cabeca branca no frame 0 / magenta no frame 1;
/// * action 210 (chute): 4 ticks perna baixa (y 126..129), 5 ticks perna alta com flip V
///   (perna desenhada abaixo do eixo: y 168..171), depois perna baixa com tempo -1
///   (parado para sempre; `AnimTime = 0` nunca vale, entao o estado 210 nao sai);
///   Clsn1 so no frame com flip (5 quadros); blend no ultimo frame -> aproximado (opaco);
/// * action 99 referencia sprite ausente -> aproximado + erro de diagnostico;
/// * comando `kick` (botao B) liga 0 -> 210 (direto); `Taunt` usa `&&`/`Time` (fora do
///   perfil) e `Alt` tem dois grupos trigger -> nao suportados, sem transicao; VelSet nao
///   ligado; statedef 230 aponta anim inexistente -> aproximado.
pub fn sentinel() -> Files {
    let mut pal = vec![[0u8, 0, 0]; 256];
    let base: [Rgb; 7] = [
        [0, 255, 255],   // 1 ciano (corpo)
        [255, 255, 255], // 2 branco (perna / cabeca)
        [255, 0, 255],   // 3 magenta (cabeca alternativa)
        [255, 0, 0],     // 4 vermelho (pe)
        [0, 0, 255],     // 5 azul (faixa)
        [0, 255, 0],     // 6 verde (faixa)
        [255, 255, 0],   // 7 amarelo (faixa)
    ];
    for (i, c) in base.iter().enumerate() {
        pal[i + 1] = *c;
    }
    // 10 cinzas/tons extras na grade VDP para pontos de 1 px (17 cores no total).
    let extra: [Rgb; 10] = [
        [36, 36, 36],
        [73, 73, 73],
        [109, 109, 109],
        [146, 146, 146],
        [182, 182, 182],
        [219, 219, 219],
        [36, 0, 0],
        [0, 36, 0],
        [0, 0, 36],
        [73, 0, 73],
    ];
    for (i, c) in extra.iter().enumerate() {
        pal[i + 8] = *c;
    }
    let (w, h) = (40usize, 48usize);
    let body = |head: u8, leg: Option<(usize, usize)>, dots: &[u8]| {
        let mut px = vec![0u8; w * h];
        for y in 0..h {
            for x in 16..24 {
                px[y * w + x] = 1;
            }
        }
        for y in 0..8 {
            for x in 16..24 {
                px[y * w + x] = head;
            }
        }
        for x in 16..24 {
            px[(h - 1) * w + x] = 4;
        }
        for (k, x) in (16..24).enumerate() {
            px[20 * w + x] = [5, 6, 7][k % 3]; // faixa de 3 cores (muitos px)
            px[21 * w + x] = [5, 6, 7][(k + 1) % 3];
        }
        if let Some((y0, y1)) = leg {
            for y in y0..y1 {
                for x in 24..40 {
                    px[y * w + x] = 2;
                }
            }
        }
        for (k, d) in dots.iter().enumerate() {
            px[(40 + k % 6) * w + 2 + k] = *d;
        }
        px
    };
    // Pontos: cores 8..15 com varios px (ficam), 16 e 17 com 1 px cada (fundidas).
    let many: Vec<u8> = (8..16).flat_map(|c| std::iter::repeat(c).take(3)).collect();
    let idle0 = body(2, None, &many);
    let idle1 = body(3, None, &[16]);
    let kick0 = body(2, Some((30, 34)), &[17]);
    let kick1 = body(2, Some((20, 24)), &[]);
    let sff = sff_v1(&[
        Image {
            group: 0,
            image: 0,
            axis_x: 20,
            axis_y: 48,
            width: 40,
            height: 48,
            pixels: &idle0,
            palette: Some(&pal),
            same_palette: false,
            link: None,
        },
        Image {
            group: 0,
            image: 1,
            axis_x: 20,
            axis_y: 48,
            width: 40,
            height: 48,
            pixels: &idle1,
            palette: Some(&pal),
            same_palette: true,
            link: None,
        },
        Image {
            group: 210,
            image: 0,
            axis_x: 20,
            axis_y: 48,
            width: 40,
            height: 48,
            pixels: &kick0,
            palette: Some(&pal),
            same_palette: true,
            link: None,
        },
        Image {
            group: 210,
            image: 1,
            axis_x: 20,
            axis_y: 48,
            width: 40,
            height: 48,
            pixels: &kick1,
            palette: Some(&pal),
            same_palette: true,
            link: None,
        },
    ]);
    let def = "; Sentinel: 2a amostra autoral (RetroDev rex-mugen)\n\
[Info]\nname = \"Sentinel\"\n\n\
[Files]\ncmd = sentinel.cmd\ncns = sentinel.cns\nsprite = sentinel.sff\nanim = sentinel.air\n"
        .to_string();
    let air = "[Begin Action 0]\n\
Clsn2: 1\n Clsn2[0] = -4, -48, 4, 0\n\
0,0, 0,0, 8\n\
Clsn2: 2\n Clsn2[0] = -4, -48, 4, -24\n Clsn2[1] = -6, -24, 6, 0\n\
0,1, 0,0, 8\n\
\n[Begin Action 210]\n\
Clsn2Default: 1\n Clsn2[0] = -4, -48, 4, 0\n\
210,0, 0,0, 4\n\
Clsn1: 1\n Clsn1[0] = 4, -28, 20, -24\n\
210,1, 0,0, 5, V\n\
210,0, 0,0, -1, , A\n\
\n[Begin Action 99]\n\
0,5, 0,0, 3\n"
        .to_string();
    let cmd = "[Command]\nname = \"kick\"\ncommand = b\ntime = 1\n\n\
[Command]\nname = \"taunt\"\ncommand = c\ntime = 1\n\n\
[Statedef -1]\n\n\
[State -1, Kick]\ntype = ChangeState\nvalue = 210\ntriggerall = command = \"kick\"\ntrigger1 = stateno = 0\n\n\
[State -1, Taunt]\ntype = ChangeState\nvalue = 230\ntrigger1 = command = \"taunt\" && Time > 10\n\n\
[State -1, Alt]\ntype = ChangeState\nvalue = 0\ntrigger1 = command = \"kick\"\ntrigger2 = command = \"taunt\"\n"
        .to_string();
    let cns = "[Statedef 0]\ntype = S\nanim = 0\n\n\
[Statedef 210]\ntype = S\nanim = 210\n\n\
[State 210, Push]\ntype = VelSet\ntrigger1 = 1\nx = 2\n\n\
[State 210, Back]\ntype = ChangeState\ntrigger1 = AnimTime = 0\nvalue = 0\n\n\
[Statedef 230]\ntype = S\nanim = 230\n"
        .to_string();
    Files {
        def,
        air,
        cmd,
        cns,
        sff,
    }
}
