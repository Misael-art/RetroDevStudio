//! Evidencia estrutural dentro da propia ROM: quen referencia o stream.
//!
//! Non se transplantan offsets doutra revisión nin se deducen polo nome do
//! xogo. Todo o que aquí se reporta é unha medida sobre os bytes locais.
//!
//! As funcións son deliberadamente distintas porque proban cousas
//! distintas: [`call_sites`] recoñece só operacións de chamada reais,
//! [`references_to`] busca o patrón de bytes sen interpretar (por iso atopaa
//! tamén dentro dunha táboa), [`cargas_abs_l`] recoñece o operand dun `lea`
//! absoluto longo — a forma pola que un fluxo chega á rutina — e
//! [`tables_for`] require que os valores caian **dentro da imaxe**: un punteiro
//! fóra da ROM non é un offset medido, é unha suposición.

/// `jsr`/`jmp` absolutos longos (`4E B9` / `4E FD`) nunha xanela da imaxe.
///
/// Os desprazamentos examínanse de dous en dous porque as instruccións 68k
/// están aliñadas a palabra: un opcode en desprazamento impar non é código.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JsrSite {
    pub offset: usize,
    pub target: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PointerTable {
    pub base_offset: usize,
    pub entries: usize,
    pub values: Vec<u32>,
    pub ascending: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RefSite {
    pub offset: usize,
    pub operand: u32,
}

/// `lea abs.l,An` (`41 F9`…`4F F9`): un enderezo absoluto longo cargado nun
/// rexistro de dirección.
///
/// Esta é a forma habitual de entregar un fluxo á rutina de descompresión
/// (`lea fluxo,A0`, `lea destino,A1`, chamada). `call_sites` non o ve porque a
/// chamada apunta á rutina, non ao fluxo.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CargaAbsoluta {
    pub offset: usize,
    /// 0..7 para A0..A7.
    pub registro: u8,
    pub operando: u32,
}

/// Opcode de chamada absoluta longa: `4E B9` (jsr) ou `4E FD` (jmp).
fn opcode_chamada(image: &[u8], o: usize) -> bool {
    image.len() > o + 1 && image[o] == 0x4E && (image[o + 1] == 0xB9 || image[o + 1] == 0xFD)
}

/// Cargas de enderezo absoluto longo nun rexistro de dirección, nunha xanela.
///
/// `lea abs.l,An` codifícase `0100 ddd 111 | 111 001`: o mesmo par `111/001`
/// (absoluto longo) que usa `4E B9` (`jsr abs.l`), co rexistro de destino no
/// campo `ddd`. Por iso os oitos opcodes válidos son `41 F9`, `43 F9` … `4F F9`
/// — todos con primeiro byte impar e nibre alto `4`. `4E F9` (`jmp abs.l`)
/// queda fóra porque o seu primeiro byte é par.
///
/// Os desprazamentos examínanse de dous en dous: un opcode en desprazamento
/// impar non é código 68k.
pub fn cargas_abs_l(image: &[u8], from: usize, to: usize, max: usize) -> Vec<CargaAbsoluta> {
    let to = to.min(image.len());
    let mut out = Vec::new();
    let mut o = from;
    // 2 bytes de opcode + 4 de operando.
    while o + 6 <= to {
        let primeiro = image[o];
        if primeiro & 0xF0 == 0x40 && primeiro & 1 == 1 && image[o + 1] == 0xF9 {
            out.push(CargaAbsoluta {
                offset: o,
                registro: (primeiro >> 1) & 7,
                operando: u32::from_be_bytes([
                    image[o + 2],
                    image[o + 3],
                    image[o + 4],
                    image[o + 5],
                ]),
            });
            if out.len() >= max {
                return out;
            }
        }
        o += 2;
    }
    out
}

pub fn call_sites(image: &[u8], from: usize, to: usize, max: usize) -> Vec<JsrSite> {
    let to = to.min(image.len());
    let mut out = Vec::new();
    let mut o = from;
    // 2 bytes de opcode + 4 de operando.
    while o + 6 <= to {
        if opcode_chamada(image, o) {
            out.push(JsrSite {
                offset: o,
                target: u32::from_be_bytes([
                    image[o + 2],
                    image[o + 3],
                    image[o + 4],
                    image[o + 5],
                ]),
            });
            if out.len() >= max {
                return out;
            }
        }
        o += 2;
    }
    out
}

/// Aparicións dos catro bytes do operando, sen interpretar o contexto.
pub fn references_to(image: &[u8], addr: u32, max: usize) -> Vec<RefSite> {
    let pattern = addr.to_be_bytes();
    let mut out = Vec::new();
    if image.len() < 4 {
        return out;
    }
    for i in 0..=image.len() - 4 {
        if image[i..i + 4] == pattern[..] {
            out.push(RefSite {
                offset: i,
                operand: addr,
            });
            if out.len() >= max {
                return out;
            }
        }
    }
    out
}

/// Secuencias maximais de longwords BE **crecentes, non nulas e dentro da imaxe**.
///
/// Un cero non é un punteiro válido: é recheo sen inicializar. Incluílo na
/// secuencia desprazaría o `base_offset` unha entrada enteira, e un offset
/// desprazado é exactamente o erro que esta fase ten que evitar.
///
/// Só se devolven as que conteñan cando menos un valor de `wanted`: unha
/// secuencia crecente de bytes do corpo da ROM tamén cumpre a forma, e chamalo
/// táboa sen estar ligada a nada que busquemos sería inferir estrutura polo
/// aspecto dos datos.
pub fn tables_for(
    image: &[u8],
    wanted: &[u32],
    min_entries: usize,
    max_tables: usize,
) -> Vec<PointerTable> {
    let n = image.len() / 4;
    let lim = image.len() as u32;
    let val = |i: usize| {
        u32::from_be_bytes([
            image[i * 4],
            image[i * 4 + 1],
            image[i * 4 + 2],
            image[i * 4 + 3],
        ])
    };
    // Válido = apunta a algún sitio desta imaxe: nonzero e por debaixo do fin.
    let válido = |v: u32| v != 0 && v < lim;
    let mut out = Vec::new();
    if min_entries == 0 {
        return out;
    }
    let mut i = 0;
    while i < n {
        if !válido(val(i)) {
            i += 1;
            continue;
        }
        let mut j = i;
        while j + 1 < n {
            let actual = val(j);
            let seguinte = val(j + 1);
            if válido(seguinte) && seguinte > actual {
                j += 1;
            } else {
                break;
            }
        }
        if j - i + 1 >= min_entries {
            let values: Vec<u32> = (i..=j).map(val).collect();
            if values.iter().any(|v| wanted.contains(v)) {
                out.push(PointerTable {
                    base_offset: i * 4,
                    entries: values.len(),
                    ascending: true,
                    values,
                });
                if out.len() >= max_tables {
                    return out;
                }
            }
        }
        i = j + 1;
    }
    out
}
