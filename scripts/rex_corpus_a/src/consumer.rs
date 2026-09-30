//! Evidencia estrutural dentro da propia ROM: quen referencia o stream.
//!
//! Non se transplantan offsets doutra revisión nin se deducen polo nome do
//! xogo. Todo o que aquí se reporta é unha medida sobre os bytes locais.

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

/// `jsr`/`jmp` absolutos longos (`4E B9` / `4E FD`) nunha xanela da imaxe.
pub fn call_sites(_image: &[u8], _from: usize, _to: usize, _max: usize) -> Vec<JsrSite> {
    todo!()
}

/// Táboas de longwords ordenadas crecendo que conteñan algunho dos valores buscados.
pub fn tables_for(
    _image: &[u8],
    _wanted: &[u32],
    _min_entries: usize,
    _max_tables: usize,
) -> Vec<PointerTable> {
    todo!()
}

/// Operandos absolutos (`lea`/`movea`/`jsr`) que apuntan a unha direccion dada.
pub fn references_to(_image: &[u8], _addr: u32, _max: usize) -> Vec<RefSite> {
    todo!()
}
