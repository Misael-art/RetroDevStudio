use std::collections::{HashSet, VecDeque};

use super::manifest::{
    CallGraphEdge, CodeRegion, CodeXref, DisassemblyResult, DisassemblyRow, FunctionCandidate,
    LogicHint,
};
use super::platform::LoadedRom;

const MAX_FUNCTIONS: usize = 24;
const MAX_INSTRUCTIONS_PER_FUNCTION: usize = 128;

#[derive(Debug, Clone)]
struct DecodedInstruction {
    row: DisassemblyRow,
    terminal: bool,
}

fn read_be_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    bytes.get(offset..offset + 2)
        .map(|slice| u16::from_be_bytes([slice[0], slice[1]]))
}

fn read_be_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    bytes.get(offset..offset + 4)
        .map(|slice| u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn read_le_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    bytes.get(offset..offset + 2)
        .map(|slice| u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_le_u24(bytes: &[u8], offset: usize) -> Option<u32> {
    bytes.get(offset..offset + 3)
        .map(|slice| u32::from(slice[0]) | (u32::from(slice[1]) << 8) | (u32::from(slice[2]) << 16))
}

fn decode_megadrive(bytes: &[u8], offset: usize) -> DecodedInstruction {
    let opcode = read_be_u16(bytes, offset).unwrap_or(0);
    let mut row = DisassemblyRow {
        offset: offset as u32,
        bytes: bytes.get(offset..offset + 2).unwrap_or(&[]).to_vec(),
        size: 2,
        text: format!("dc.w ${:04X}", opcode),
        kind: "data".to_string(),
        target: None,
    };
    let mut terminal = false;

    match opcode {
        0x4E71 => {
            row.text = "nop".to_string();
            row.kind = "nop".to_string();
        }
        0x4E75 => {
            row.text = "rts".to_string();
            row.kind = "return".to_string();
            terminal = true;
        }
        0x4EB9 => {
            if let Some(target) = read_be_u32(bytes, offset + 2) {
                row.bytes = bytes.get(offset..offset + 6).unwrap_or(&[]).to_vec();
                row.size = 6;
                row.text = format!("jsr ${:08X}", target);
                row.kind = "call".to_string();
                row.target = Some(target);
            }
        }
        0x4EF9 => {
            if let Some(target) = read_be_u32(bytes, offset + 2) {
                row.bytes = bytes.get(offset..offset + 6).unwrap_or(&[]).to_vec();
                row.size = 6;
                row.text = format!("jmp ${:08X}", target);
                row.kind = "jump".to_string();
                row.target = Some(target);
                terminal = true;
            }
        }
        0x4EB8 => {
            if let Some(target) = read_be_u16(bytes, offset + 2) {
                row.bytes = bytes.get(offset..offset + 4).unwrap_or(&[]).to_vec();
                row.size = 4;
                row.text = format!("jsr ${:04X}.w", target);
                row.kind = "call".to_string();
                row.target = Some(u32::from(target));
            }
        }
        0x4EF8 => {
            if let Some(target) = read_be_u16(bytes, offset + 2) {
                row.bytes = bytes.get(offset..offset + 4).unwrap_or(&[]).to_vec();
                row.size = 4;
                row.text = format!("jmp ${:04X}.w", target);
                row.kind = "jump".to_string();
                row.target = Some(u32::from(target));
                terminal = true;
            }
        }
        value if (value & 0xFF00) == 0x6000 || (value & 0xFF00) == 0x6100 => {
            let disp8 = (value & 0x00FF) as u8 as i8 as i32;
            let kind = if (value & 0xFF00) == 0x6100 { "call" } else { "branch" };
            let target = if (value & 0x00FF) == 0 {
                let disp16 = read_be_u16(bytes, offset + 2).unwrap_or(0) as i16 as i32;
                row.bytes = bytes.get(offset..offset + 4).unwrap_or(&[]).to_vec();
                row.size = 4;
                ((offset as i32) + 2 + disp16) as u32
            } else {
                ((offset as i32) + 2 + disp8) as u32
            };
            row.text = if kind == "call" {
                format!("bsr ${:08X}", target)
            } else {
                format!("bra ${:08X}", target)
            };
            row.kind = kind.to_string();
            row.target = Some(target);
            terminal = kind == "branch";
        }
        value if (value & 0xF100) == 0x7000 => {
            let register = (value >> 9) & 0x7;
            let imm = (value & 0x00FF) as i8;
            row.text = format!("moveq #{}, d{}", imm, register);
            row.kind = "move".to_string();
        }
        _ => {}
    }

    DecodedInstruction { row, terminal }
}

fn decode_snes(bytes: &[u8], offset: usize) -> DecodedInstruction {
    let opcode = bytes.get(offset).copied().unwrap_or(0);
    let mut row = DisassemblyRow {
        offset: offset as u32,
        bytes: bytes.get(offset..offset + 1).unwrap_or(&[]).to_vec(),
        size: 1,
        text: format!("db ${:02X}", opcode),
        kind: "data".to_string(),
        target: None,
    };
    let mut terminal = false;

    match opcode {
        0xEA => {
            row.text = "nop".to_string();
            row.kind = "nop".to_string();
        }
        0x60 => {
            row.text = "rts".to_string();
            row.kind = "return".to_string();
            terminal = true;
        }
        0x6B => {
            row.text = "rtl".to_string();
            row.kind = "return".to_string();
            terminal = true;
        }
        0xA9 | 0xA2 | 0xA0 | 0xC2 | 0xE2 => {
            let imm = bytes.get(offset + 1).copied().unwrap_or(0);
            row.bytes = bytes.get(offset..offset + 2).unwrap_or(&[]).to_vec();
            row.size = 2;
            row.text = match opcode {
                0xA9 => format!("lda #${:02X}", imm),
                0xA2 => format!("ldx #${:02X}", imm),
                0xA0 => format!("ldy #${:02X}", imm),
                0xC2 => format!("rep #${:02X}", imm),
                _ => format!("sep #${:02X}", imm),
            };
            row.kind = "immediate".to_string();
        }
        0x8D | 0xAD | 0x20 | 0x4C => {
            let operand = read_le_u16(bytes, offset + 1).unwrap_or(0);
            row.bytes = bytes.get(offset..offset + 3).unwrap_or(&[]).to_vec();
            row.size = 3;
            row.text = match opcode {
                0x8D => format!("sta ${:04X}", operand),
                0xAD => format!("lda ${:04X}", operand),
                0x20 => format!("jsr ${:04X}", operand),
                _ => format!("jmp ${:04X}", operand),
            };
            row.kind = match opcode {
                0x20 => "call",
                0x4C => {
                    terminal = true;
                    "jump"
                }
                _ => "memory",
            }
            .to_string();
            if matches!(opcode, 0x20 | 0x4C) {
                row.target = Some(u32::from(operand));
            }
        }
        0x22 | 0x5C => {
            let operand = read_le_u24(bytes, offset + 1).unwrap_or(0);
            row.bytes = bytes.get(offset..offset + 4).unwrap_or(&[]).to_vec();
            row.size = 4;
            row.text = if opcode == 0x22 {
                format!("jsl ${:06X}", operand)
            } else {
                format!("jml ${:06X}", operand)
            };
            row.kind = if opcode == 0x22 { "call" } else { "jump" }.to_string();
            row.target = Some(operand);
            terminal = opcode == 0x5C;
        }
        0x80 | 0xD0 | 0xF0 => {
            let disp = bytes.get(offset + 1).copied().unwrap_or(0) as i8 as i32;
            let target = ((offset as i32) + 2 + disp) as u32;
            row.bytes = bytes.get(offset..offset + 2).unwrap_or(&[]).to_vec();
            row.size = 2;
            row.text = match opcode {
                0x80 => format!("bra ${:06X}", target),
                0xD0 => format!("bne ${:06X}", target),
                _ => format!("beq ${:06X}", target),
            };
            row.kind = "branch".to_string();
            row.target = Some(target);
            terminal = opcode == 0x80;
        }
        _ => {}
    }

    DecodedInstruction { row, terminal }
}

fn decode_instruction(loaded: &LoadedRom, offset: usize) -> DecodedInstruction {
    match loaded.target.as_str() {
        "snes" => decode_snes(&loaded.bytes, offset),
        _ => decode_megadrive(&loaded.bytes, offset),
    }
}

pub fn disassemble_region(loaded: &LoadedRom, offset: usize, length: usize) -> DisassemblyResult {
    if offset >= loaded.bytes.len() {
        return DisassemblyResult {
            ok: false,
            error: format!("Offset 0x{:X} fora da ROM.", offset),
            total_size: loaded.bytes.len(),
            rows: Vec::new(),
        };
    }

    let end = loaded.bytes.len().min(offset.saturating_add(length.max(16)));
    let mut rows = Vec::new();
    let mut cursor = offset;
    while cursor < end {
        let decoded = decode_instruction(loaded, cursor);
        let advance = decoded.row.size.max(1) as usize;
        rows.push(decoded.row);
        cursor = cursor.saturating_add(advance);
    }

    DisassemblyResult {
        ok: true,
        error: String::new(),
        total_size: loaded.bytes.len(),
        rows,
    }
}

pub fn analyze_code(loaded: &LoadedRom) -> (Vec<CodeRegion>, Vec<CallGraphEdge>, Vec<LogicHint>) {
    let mut queue: VecDeque<u32> = loaded.entry_points.iter().copied().collect();
    let mut visited = HashSet::new();
    let mut rows = Vec::new();
    let mut xrefs = Vec::new();
    let mut call_graph = Vec::new();

    while let Some(function_start) = queue.pop_front() {
        if !visited.insert(function_start) || visited.len() > MAX_FUNCTIONS {
            continue;
        }

        let mut cursor = function_start as usize;
        let mut instructions = 0usize;
        while cursor < loaded.bytes.len() && instructions < MAX_INSTRUCTIONS_PER_FUNCTION {
            let decoded = decode_instruction(loaded, cursor);
            let next_cursor = cursor.saturating_add(decoded.row.size.max(1) as usize);
            if let Some(target) = decoded.row.target {
                let xref_kind = decoded.row.kind.clone();
                xrefs.push(CodeXref {
                    from: decoded.row.offset,
                    to: target,
                    kind: xref_kind.clone(),
                    label: format!("{} @ {:08X}", xref_kind, decoded.row.offset),
                });
                if xref_kind == "call" {
                    call_graph.push(CallGraphEdge {
                        from: function_start,
                        to: target,
                        kind: "call".to_string(),
                    });
                    if target < loaded.bytes.len() as u32 {
                        queue.push_back(target);
                    }
                }
            }

            rows.push(decoded.row.clone());
            cursor = next_cursor;
            instructions += 1;
            if decoded.terminal {
                break;
            }
        }
    }

    rows.sort_by_key(|row| row.offset);
    rows.dedup_by_key(|row| row.offset);
    xrefs.sort_by_key(|xref| (xref.from, xref.to, xref.kind.clone()));
    xrefs.dedup_by_key(|xref| (xref.from, xref.to, xref.kind.clone()));
    call_graph.sort_by_key(|edge| (edge.from, edge.to, edge.kind.clone()));
    call_graph.dedup_by_key(|edge| (edge.from, edge.to, edge.kind.clone()));

    let function_candidates = visited
        .iter()
        .copied()
        .map(|address| FunctionCandidate {
            address,
            end: rows
                .iter()
                .rfind(|row| row.offset >= address)
                .map(|row| row.offset + u32::from(row.size))
                .unwrap_or(address),
            name: format!("sub_{:06X}", address),
            executed: false,
            confidence: if loaded.entry_points.contains(&address) { 85 } else { 61 },
        })
        .collect::<Vec<_>>();

    let region_start = rows.first().map(|row| row.offset).unwrap_or(0);
    let region_end = rows
        .last()
        .map(|row| row.offset + u32::from(row.size))
        .unwrap_or(region_start);
    let logic_hints = vec![
        LogicHint {
            id: format!("logic_entry_{:06X}", region_start),
            category: "code".to_string(),
            message: format!(
                "Regiao de codigo candidata com {} instrucoes e {} funcoes mapeadas.",
                rows.len(),
                function_candidates.len()
            ),
            start: Some(region_start),
            end: Some(region_end),
        },
        LogicHint {
            id: "trace_future_overlay".to_string(),
            category: "trace".to_string(),
            message: "Trace Libretro ainda nao coleta execucao nesta wave; overlay futuro ja previsto na arquitetura.".to_string(),
            start: None,
            end: None,
        },
    ];

    let code_regions = if rows.is_empty() {
        Vec::new()
    } else {
        vec![CodeRegion {
            start: region_start,
            end: region_end,
            architecture: if loaded.target == "snes" { "65816" } else { "68000" }.to_string(),
            entry_points: loaded.entry_points.clone(),
            functions: function_candidates,
            xrefs,
            disassembly: rows,
        }]
    };

    (code_regions, call_graph, logic_hints)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::reverse::manifest::RomHeader;
    use crate::tools::reverse::platform::LoadedRom;

    fn sample_loaded(target: &str, bytes: Vec<u8>, entry_points: Vec<u32>) -> LoadedRom {
        LoadedRom {
            target: target.to_string(),
            source_path: "dummy.rom".to_string(),
            bytes,
            detected_format: "bin".to_string(),
            stripped_header_bytes: 0,
            header: RomHeader::default(),
            mapper: String::new(),
            special_chips: Vec::new(),
            segments: Vec::new(),
            entry_points,
            trace_note: String::new(),
        }
    }

    #[test]
    fn disassemble_region_formats_megadrive_calls() {
        let rom = vec![0x4E, 0xB9, 0x00, 0x00, 0x01, 0x00, 0x4E, 0x75];
        let loaded = sample_loaded("megadrive", rom, vec![0]);
        let result = disassemble_region(&loaded, 0, 16);
        assert!(result.ok);
        assert!(result.rows[0].text.contains("jsr"));
        assert_eq!(result.rows[0].target, Some(0x100));
    }

    #[test]
    fn analyze_code_builds_call_graph_for_snes_jsl() {
        let rom = vec![0x22, 0x34, 0x12, 0x00, 0x6B];
        let loaded = sample_loaded("snes", rom, vec![0]);
        let (regions, graph, hints) = analyze_code(&loaded);
        assert_eq!(regions.len(), 1);
        assert_eq!(graph.len(), 1);
        assert!(!hints.is_empty());
    }
}
