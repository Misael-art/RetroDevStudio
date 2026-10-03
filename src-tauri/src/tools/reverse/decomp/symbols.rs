//! Parser de symbol tables estilo `nm` (ex.: `symbol.txt` do build SGDK, saída de
//! `m68k-elf-nm`) — ground truth de fronteiras de função para a Etapa A.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SymbolEntry {
    pub addr: u32,
    pub kind: char,
    pub name: String,
    /// Presente quando a saída vem de `nm -S` (`addr size kind name`).
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FunctionRange {
    pub addr: u32,
    pub size: u32,
    pub name: String,
}

/// Parseia linhas `8-hex <kind> <name>` (nm clássico) ou `8-hex 8-hex <kind> <name>`
/// (`nm -S`, com tamanho). Ignora linhas em branco, cabeçalhos e endereços longos
/// (`FFFFFFFF` / símbolos indefinidos `U` sem endereço efetivo).
pub fn parse_nm_symbols(content: &str) -> Vec<SymbolEntry> {
    let mut symbols = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let tokens: Vec<&str> = trimmed.split_whitespace().collect();
        let (addr_token, size, kind, name) = match tokens.as_slice() {
            [addr, kind, name, ..]
                if kind.len() == 1 && kind.chars().all(|c| c.is_ascii_alphabetic() || c == '?') =>
            {
                (*addr, None, *kind, *name)
            }
            [addr, size, kind, name, ..]
                if kind.len() == 1 && size.chars().all(|c| c.is_ascii_hexdigit()) =>
            {
                let Ok(size) = u32::from_str_radix(size, 16) else {
                    continue;
                };
                (*addr, Some(size), *kind, *name)
            }
            _ => continue,
        };
        let Ok(addr) = u32::from_str_radix(addr_token, 16) else {
            continue;
        };
        let Some(kind_char) = kind.chars().next() else {
            continue;
        };
        if kind_char == 'U' || kind_char == 'w' || kind_char == '?' {
            continue;
        }
        symbols.push(SymbolEntry {
            addr,
            kind: kind_char,
            name: name.to_string(),
            size,
        });
    }
    symbols
}

/// Funções de texto (`t`/`T`) ordenadas por endereço, com tamanho derivado do próximo
/// símbolo de texto quando o próprio não declara `size` (`nm -S`). `text_end` delimita
/// a última função (ex.: fim da seção `.text` ou da ROM).
pub fn function_ranges(symbols: &[SymbolEntry], text_end: Option<u32>) -> Vec<FunctionRange> {
    let mut functions: Vec<&SymbolEntry> = symbols
        .iter()
        .filter(|symbol| symbol.kind == 't' || symbol.kind == 'T')
        .collect();
    functions.sort_by_key(|symbol| symbol.addr);

    let mut ranges = Vec::with_capacity(functions.len());
    for (index, symbol) in functions.iter().enumerate() {
        let size = symbol.size.unwrap_or_else(|| {
            functions
                .get(index + 1)
                .map(|next| next.addr.saturating_sub(symbol.addr))
                .unwrap_or_else(|| {
                    text_end
                        .map(|end| end.saturating_sub(symbol.addr))
                        .unwrap_or(0)
                })
        });
        ranges.push(FunctionRange {
            addr: symbol.addr,
            size,
            name: symbol.name.clone(),
        });
    }
    ranges
}

/// Endereços de início das funções (ground truth para boundary precision/recall).
pub fn function_starts(ranges: &[FunctionRange]) -> Vec<u32> {
    let mut addrs: Vec<u32> = ranges.iter().map(|range| range.addr).collect();
    addrs.sort_unstable();
    addrs.dedup();
    addrs
}

#[cfg(test)]
mod tests {
    use super::*;

    const TAIKETSU_STYLE: &str = "00000200 t _Entry_Point
00000422 t _VINT
00004f60 T FUNCAO_FSM
0000a204 T PLAYER_STATE
0000a260 T after_last
e0ff0005 D gRoom
e0ff0d6e B P
         U undefined_ext
";

    #[test]
    fn parses_nm_lines_and_skips_undefined() {
        let symbols = parse_nm_symbols(TAIKETSU_STYLE);
        assert_eq!(
            symbols.len(),
            7,
            "U e linhas vazias sao ignoradas: {symbols:?}"
        );
        assert_eq!(symbols[0].name, "_Entry_Point");
        assert_eq!(symbols[0].kind, 't');
        assert_eq!(symbols[2].name, "FUNCAO_FSM");
        assert_eq!(symbols[2].kind, 'T');
        assert_eq!(symbols[3].addr, 0xA204);
        assert_eq!(symbols[5].kind, 'D');
        assert_eq!(symbols[6].kind, 'B');
        assert!(symbols.iter().all(|symbol| symbol.size.is_none()));
    }

    #[test]
    fn function_ranges_derive_sizes_from_next_symbol() {
        let symbols = parse_nm_symbols(TAIKETSU_STYLE);
        let ranges = function_ranges(&symbols, Some(0xA400));
        assert_eq!(ranges.len(), 5);
        assert_eq!(ranges[0].addr, 0x200);
        assert_eq!(ranges[0].size, 0x222);
        assert_eq!(ranges[2].name, "FUNCAO_FSM");
        assert_eq!(ranges[2].size, 0xA204 - 0x4F60);
        // Última função usa text_end quando size não está declarado.
        let last = ranges.last().expect("last range");
        assert_eq!(last.addr, 0xA260);
        assert_eq!(last.size, 0xA400 - 0xA260);
    }

    #[test]
    fn nm_line_annotations_preserve_function_boundaries() {
        let symbols = parse_nm_symbols(
            "00000200 T main\tsrc/main.c:12\n00000300 00000020 t helper\tC:/source/foo.c:8\n",
        );
        assert_eq!(symbols.len(), 2);
        assert_eq!(symbols[0].name, "main");
        assert_eq!(symbols[1].size, Some(0x20));
    }

    #[test]
    fn nm_dash_s_sizes_are_honored() {
        let symbols = parse_nm_symbols("00000400 00000034 T first\n00000434 00000010 T second\n");
        let ranges = function_ranges(&symbols, None);
        assert_eq!(ranges[0].size, 0x34);
        assert_eq!(ranges[1].size, 0x10);
        assert_eq!(function_starts(&ranges), vec![0x400, 0x434]);
    }
}
