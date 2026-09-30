//! Contaxe de secuencias de catro bytes asociadas a contedores de fluxo.
//!
//! Isto **non** diagnosea un códec: conta ocurrencias dunha secuencia de bytes
//! nunha imaxe. As etiquetaxes que a literatura asocia a `KosM`, `KosP`, `EniM`,
//! `GSS ` e `Unic` varian entre títulos e revisións, e ningún nome de ficheiro
//! nin xogo autoriza a afirmar «isto é Kosinski+». O que se ofrece é a medida
//! (canto e onde) para que a inferencia, se se faz, estea apoiada nunha
//! referencia externa fixada e non nunha lenda.
//!
//! Unha conta a cero é un resultado, non un fallo da ferramenta: é a única
//! maneira honesta de rexistrar que un corpus non emprega un formato.

/// As cinco secuencias de marcador que aparecen nos contedores da familia.
pub const MAXIAS: [&str; 5] = ["KosM", "KosP", "EniM", "GSS ", "Unic"];

/// Tope de desprazamentos gardados por secuencia. A conta total é sempre
/// exacta; o tope só recorta a lista de mostra.
#[derive(Clone, Copy)]
pub struct MagiaLimits {
    pub max_por_secuencia: usize,
}

impl MagiaLimits {
    pub const DEFAULT: MagiaLimits = MagiaLimits {
        max_por_secuencia: 32,
    };
}

/// Unha secuencia medida nunha imaxe.
#[derive(Debug)]
pub struct MagiaConta {
    pub secuencia: &'static str,
    /// Ocorrencias totais, incluídas as que o tope non gardou.
    pub ocorrencias: usize,
    pub desprazamentos: Vec<usize>,
    /// `true` cando houbo ocorrencias suficientes para recortar a lista.
    pub tope_acadado: bool,
}

/// Resultado completo do sondeo.
#[derive(Debug)]
pub struct Magias {
    pub total: usize,
    pub por_secuencia: Vec<MagiaConta>,
}

/// Conta as ocorrencias de cada marcador, posición a posición.
///
/// As ventás solápanse deliberadamente: un marcador podería aparecer dentro do
/// tramo descomprimido doutro, e ignorar solapamentos subestimaría a conta.
pub fn contar(imaxe: &[u8], limits: MagiaLimits) -> Magias {
    let mut por_secuencia = Vec::with_capacity(MAXIAS.len());
    let mut total = 0usize;
    for agulla in MAXIAS {
        let pat = agulla.as_bytes();
        let mut conta = MagiaConta {
            secuencia: agulla,
            ocorrencias: 0,
            desprazamentos: Vec::new(),
            tope_acadado: false,
        };
        if imaxe.len() >= pat.len() {
            for i in 0..=imaxe.len() - pat.len() {
                if &imaxe[i..i + pat.len()] == pat {
                    conta.ocorrencias += 1;
                    if conta.desprazamentos.len() < limits.max_por_secuencia {
                        conta.desprazamentos.push(i);
                    } else {
                        conta.tope_acadado = true;
                    }
                }
            }
        }
        total += conta.ocorrencias;
        por_secuencia.push(conta);
    }
    Magias {
        total,
        por_secuencia,
    }
}
