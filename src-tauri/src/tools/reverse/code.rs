use std::collections::{HashSet, VecDeque};

use super::manifest::{
    CallGraphEdge, CodeRegion, CodeXref, DisassemblyResult, DisassemblyRow, FunctionCandidate,
    LogicHint,
};
use super::platform::LoadedRom;
use super::trace::ExecutionTraceLog;

const MAX_FUNCTIONS: usize = 24;
const MAX_INSTRUCTIONS_PER_FUNCTION: usize = 128;

#[derive(Debug, Clone)]
struct DecodedInstruction {
    row: DisassemblyRow,
    terminal: bool,
}

fn read_be_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    bytes
        .get(offset..offset + 2)
        .map(|slice| u16::from_be_bytes([slice[0], slice[1]]))
}

fn read_be_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    bytes
        .get(offset..offset + 4)
        .map(|slice| u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn read_le_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    bytes
        .get(offset..offset + 2)
        .map(|slice| u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_le_u24(bytes: &[u8], offset: usize) -> Option<u32> {
    bytes
        .get(offset..offset + 3)
        .map(|slice| u32::from(slice[0]) | (u32::from(slice[1]) << 8) | (u32::from(slice[2]) << 16))
}

fn align_megadrive_code_address(address: u32) -> u32 {
    address & !1
}

fn normalize_code_address(loaded: &LoadedRom, address: u32) -> u32 {
    if loaded.target == "megadrive" {
        align_megadrive_code_address(address)
    } else {
        address
    }
}

fn trace_allows_address(trace: Option<&ExecutionTraceLog>, address: u32) -> bool {
    trace.map(|log| log.was_executed(address)).unwrap_or(true)
}

fn target_points_inside_instruction(
    target: u32,
    current_offset: usize,
    next_cursor: usize,
) -> bool {
    let target = target as usize;
    target > current_offset && target < next_cursor
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
                let target = align_megadrive_code_address(target);
                row.text = format!("jsr ${:08X}", target);
                row.kind = "call".to_string();
                row.target = Some(target);
            }
        }
        0x4EF9 => {
            if let Some(target) = read_be_u32(bytes, offset + 2) {
                row.bytes = bytes.get(offset..offset + 6).unwrap_or(&[]).to_vec();
                row.size = 6;
                let target = align_megadrive_code_address(target);
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
                let target = align_megadrive_code_address(u32::from(target));
                row.text = format!("jsr ${:04X}.w", target);
                row.kind = "call".to_string();
                row.target = Some(target);
            }
        }
        0x4EF8 => {
            if let Some(target) = read_be_u16(bytes, offset + 2) {
                row.bytes = bytes.get(offset..offset + 4).unwrap_or(&[]).to_vec();
                row.size = 4;
                let target = align_megadrive_code_address(u32::from(target));
                row.text = format!("jmp ${:04X}.w", target);
                row.kind = "jump".to_string();
                row.target = Some(target);
                terminal = true;
            }
        }
        value if (value & 0xFF00) == 0x6000 || (value & 0xFF00) == 0x6100 => {
            let disp8 = (value & 0x00FF) as u8 as i8 as i32;
            let kind = if (value & 0xFF00) == 0x6100 {
                "call"
            } else {
                "branch"
            };
            let target = if (value & 0x00FF) == 0 {
                let disp16 = read_be_u16(bytes, offset + 2).unwrap_or(0) as i16 as i32;
                row.bytes = bytes.get(offset..offset + 4).unwrap_or(&[]).to_vec();
                row.size = 4;
                ((offset as i32) + 2 + disp16) as u32
            } else {
                ((offset as i32) + 2 + disp8) as u32
            };
            let target = align_megadrive_code_address(target);
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
        value if (value & 0xF000) == 0x1000 && ((value >> 6) & 0x7) == 0 => {
            let destination = (value >> 9) & 0x7;
            let source_mode = (value >> 3) & 0x7;
            let source_register = value & 0x7;
            match source_mode {
                0b011 => {
                    row.text = format!("move.b (a{})+, d{}", source_register, destination);
                    row.kind = "move".to_string();
                }
                0b100 => {
                    row.text = format!("move.b -(a{}), d{}", source_register, destination);
                    row.kind = "move".to_string();
                }
                _ => {}
            }
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
        0xA7 => {
            let operand = bytes.get(offset + 1).copied().unwrap_or(0);
            row.bytes = bytes.get(offset..offset + 2).unwrap_or(&[]).to_vec();
            row.size = 2;
            row.text = format!("lda [${:02X}]", operand);
            row.kind = "memory".to_string();
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

    let end = loaded
        .bytes
        .len()
        .min(offset.saturating_add(length.max(16)));
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
    analyze_code_with_trace(loaded, None)
}

pub fn analyze_code_with_trace_overlay(
    loaded: &LoadedRom,
    trace: &ExecutionTraceLog,
) -> (Vec<CodeRegion>, Vec<CallGraphEdge>, Vec<LogicHint>) {
    analyze_code_with_trace(loaded, Some(trace))
}

fn analyze_code_with_trace(
    loaded: &LoadedRom,
    trace: Option<&ExecutionTraceLog>,
) -> (Vec<CodeRegion>, Vec<CallGraphEdge>, Vec<LogicHint>) {
    let normalized_entry_points = loaded
        .entry_points
        .iter()
        .copied()
        .map(|address| normalize_code_address(loaded, address))
        .collect::<HashSet<_>>();
    let mut queue: VecDeque<u32> = normalized_entry_points.iter().copied().collect();
    let mut visited = HashSet::new();
    let mut rows = Vec::new();
    let mut xrefs = Vec::new();
    let mut call_graph = Vec::new();

    while let Some(function_start) = queue.pop_front() {
        if function_start as usize >= loaded.bytes.len()
            || visited.contains(&function_start)
            || visited.len() > MAX_FUNCTIONS
            || !trace_allows_address(trace, function_start)
        {
            continue;
        }
        visited.insert(function_start);

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
                    if target < loaded.bytes.len() as u32
                        && !target_points_inside_instruction(target, cursor, next_cursor)
                        && trace_allows_address(trace, target)
                    {
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
            executed: trace.map(|log| log.was_executed(address)).unwrap_or(false),
            confidence: {
                let base = if normalized_entry_points.contains(&address) {
                    85
                } else {
                    61
                };
                let trace_bonus = trace
                    .and_then(|log| log.cpu_states.get(&address))
                    .map(|state| if state.m_flag != state.x_flag { 8 } else { 4 })
                    .unwrap_or(0);
                (base + trace_bonus).min(100)
            },
        })
        .collect::<Vec<_>>();

    let region_start = rows.first().map(|row| row.offset).unwrap_or(0);
    let region_end = rows
        .last()
        .map(|row| row.offset + u32::from(row.size))
        .unwrap_or(region_start);
    let mut logic_hints = vec![LogicHint {
        id: format!("logic_entry_{:06X}", region_start),
        category: "code".to_string(),
        message: format!(
            "Regiao de codigo candidata com {} instrucoes e {} funcoes mapeadas.",
            rows.len(),
            function_candidates.len()
        ),
        start: Some(region_start),
        end: Some(region_end),
    }];
    logic_hints.push(if let Some(trace_log) = trace {
        LogicHint {
            id: "trace_overlay_active".to_string(),
            category: "trace".to_string(),
            message: format!(
                "Trace dinamico aplicado: {} PCs executados e {} estados CPU capturados.",
                trace_log.executed_pcs.len(),
                trace_log.cpu_states.len()
            ),
            start: None,
            end: None,
        }
    } else {
        LogicHint {
            id: "trace_future_overlay".to_string(),
            category: "trace".to_string(),
            message: "Trace Libretro ainda nao coleta execucao nesta wave; overlay futuro ja previsto na arquitetura.".to_string(),
            start: None,
            end: None,
        }
    });

    let code_regions = if rows.is_empty() {
        Vec::new()
    } else {
        vec![CodeRegion {
            start: region_start,
            end: region_end,
            architecture: if loaded.target == "snes" {
                "65816"
            } else {
                "68000"
            }
            .to_string(),
            entry_points: normalized_entry_points.iter().copied().collect(),
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
    use crate::tools::reverse::trace::{CpuState, ExecutionTraceLog};

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

    #[test]
    fn decode_megadrive_instruction_coverage() {
        let mut rom = Vec::new();
        // NOP
        rom.extend_from_slice(&[0x4E, 0x71]);
        // JSR abs.l $00000100
        rom.extend_from_slice(&[0x4E, 0xB9, 0x00, 0x00, 0x01, 0x00]);
        // JMP abs.l $00000200
        rom.extend_from_slice(&[0x4E, 0xF9, 0x00, 0x00, 0x02, 0x00]);
        // JSR abs.w $0300
        rom.extend_from_slice(&[0x4E, 0xB8, 0x03, 0x00]);
        // JMP abs.w $0400
        rom.extend_from_slice(&[0x4E, 0xF8, 0x04, 0x00]);
        // MOVEQ #42, d0
        rom.extend_from_slice(&[0x70, 0x2A]);
        // BRA 8-bit (disp=+4)
        rom.extend_from_slice(&[0x60, 0x04]);
        // BSR 8-bit (disp=+6)
        rom.extend_from_slice(&[0x61, 0x06]);
        // RTS
        rom.extend_from_slice(&[0x4E, 0x75]);

        let loaded = sample_loaded("megadrive", rom, vec![0]);
        let result = disassemble_region(&loaded, 0, 64);
        assert!(result.ok);

        // NOP at offset 0
        assert_eq!(result.rows[0].kind, "nop");
        assert_eq!(result.rows[0].size, 2);
        // JSR abs.l at offset 2
        assert_eq!(result.rows[1].kind, "call");
        assert_eq!(result.rows[1].size, 6);
        assert_eq!(result.rows[1].target, Some(0x100));
        assert!(result.rows[1].text.contains("jsr"));
        // JMP abs.l at offset 8
        assert_eq!(result.rows[2].kind, "jump");
        assert_eq!(result.rows[2].size, 6);
        assert_eq!(result.rows[2].target, Some(0x200));
        // JSR abs.w at offset 14
        assert_eq!(result.rows[3].kind, "call");
        assert_eq!(result.rows[3].size, 4);
        assert_eq!(result.rows[3].target, Some(0x0300));
        assert!(result.rows[3].text.contains("jsr"));
        // JMP abs.w at offset 18
        assert_eq!(result.rows[4].kind, "jump");
        assert_eq!(result.rows[4].size, 4);
        assert_eq!(result.rows[4].target, Some(0x0400));
        // MOVEQ at offset 22
        assert_eq!(result.rows[5].kind, "move");
        assert!(result.rows[5].text.contains("moveq"));
        assert!(result.rows[5].text.contains("42"));
        // BRA 8-bit at offset 24
        assert_eq!(result.rows[6].kind, "branch");
        assert!(result.rows[6].text.contains("bra"));
        assert_eq!(result.rows[6].target, Some(24 + 2 + 4));
        // BSR 8-bit at offset 26
        assert_eq!(result.rows[7].kind, "call");
        assert!(result.rows[7].text.contains("bsr"));
        assert_eq!(result.rows[7].target, Some(26 + 2 + 6));
        // RTS at offset 28
        assert_eq!(result.rows[8].kind, "return");
        assert!(result.rows[8].text.contains("rts"));
    }

    #[test]
    fn decode_megadrive_bra_bsr_16bit_displacement() {
        let mut rom = Vec::new();
        // BRA 16-bit: opcode=0x6000, disp16=0x0010
        rom.extend_from_slice(&[0x60, 0x00, 0x00, 0x10]);
        // BSR 16-bit: opcode=0x6100, disp16=0x0020
        rom.extend_from_slice(&[0x61, 0x00, 0x00, 0x20]);

        let loaded = sample_loaded("megadrive", rom, vec![0]);
        let result = disassemble_region(&loaded, 0, 16);
        assert!(result.ok);

        // BRA 16-bit at offset 0: size=4, target = 0 + 2 + 0x10 = 0x12
        assert_eq!(result.rows[0].size, 4);
        assert_eq!(result.rows[0].kind, "branch");
        assert_eq!(result.rows[0].target, Some(0x12));
        assert!(result.rows[0].text.contains("bra"));

        // BSR 16-bit at offset 4: size=4, target = 4 + 2 + 0x20 = 0x26
        assert_eq!(result.rows[1].size, 4);
        assert_eq!(result.rows[1].kind, "call");
        assert_eq!(result.rows[1].target, Some(0x26));
        assert!(result.rows[1].text.contains("bsr"));
    }

    #[test]
    fn decode_megadrive_unknown_opcode_produces_dc_w() {
        // 0xFFFF is unrecognized, 0x4E75 is RTS
        let rom = vec![0xFF, 0xFF, 0x4E, 0x75];
        let loaded = sample_loaded("megadrive", rom, vec![0]);
        let result = disassemble_region(&loaded, 0, 8);
        assert!(result.ok);
        assert_eq!(result.rows[0].kind, "data");
        assert!(result.rows[0].text.contains("dc.w"));
        // Second instruction should be RTS
        assert_eq!(result.rows[1].kind, "return");
    }

    #[test]
    fn decode_megadrive_terminal_stops_function_walk() {
        // NOP + NOP + RTS + NOP
        let rom = vec![
            0x4E, 0x71, // NOP
            0x4E, 0x71, // NOP
            0x4E, 0x75, // RTS (terminal)
            0x4E, 0x71, // NOP (should NOT be reached)
        ];
        let loaded = sample_loaded("megadrive", rom, vec![0]);
        let (regions, _, _) = analyze_code(&loaded);
        assert_eq!(regions.len(), 1);
        let disasm = &regions[0].disassembly;
        // Should have 3 instructions (NOP, NOP, RTS) and stop at the terminal
        assert_eq!(disasm.len(), 3);
        assert_eq!(disasm[2].kind, "return");
    }

    #[test]
    fn decode_snes_instruction_coverage() {
        let mut rom = Vec::new();
        // NOP
        rom.push(0xEA);
        // LDA #$42
        rom.extend_from_slice(&[0xA9, 0x42]);
        // LDX #$10
        rom.extend_from_slice(&[0xA2, 0x10]);
        // LDY #$20
        rom.extend_from_slice(&[0xA0, 0x20]);
        // REP #$30
        rom.extend_from_slice(&[0xC2, 0x30]);
        // SEP #$20
        rom.extend_from_slice(&[0xE2, 0x20]);
        // STA $2100
        rom.extend_from_slice(&[0x8D, 0x00, 0x21]);
        // LDA $4210
        rom.extend_from_slice(&[0xAD, 0x10, 0x42]);
        // JSR $8000
        rom.extend_from_slice(&[0x20, 0x00, 0x80]);
        // JMP $9000
        rom.extend_from_slice(&[0x4C, 0x00, 0x90]);

        let loaded = sample_loaded("snes", rom, vec![0]);
        let result = disassemble_region(&loaded, 0, 64);
        assert!(result.ok);

        assert_eq!(result.rows[0].kind, "nop");
        assert_eq!(result.rows[0].size, 1);
        // LDA #$42
        assert_eq!(result.rows[1].kind, "immediate");
        assert_eq!(result.rows[1].size, 2);
        assert!(result.rows[1].text.contains("lda #$42"));
        // LDX #$10
        assert!(result.rows[2].text.contains("ldx #$10"));
        // LDY #$20
        assert!(result.rows[3].text.contains("ldy #$20"));
        // REP #$30
        assert!(result.rows[4].text.contains("rep #$30"));
        // SEP #$20
        assert!(result.rows[5].text.contains("sep #$20"));
        // STA $2100
        assert_eq!(result.rows[6].kind, "memory");
        assert_eq!(result.rows[6].size, 3);
        assert!(result.rows[6].text.contains("sta $2100"));
        // LDA $4210
        assert!(result.rows[7].text.contains("lda $4210"));
        // JSR $8000
        assert_eq!(result.rows[8].kind, "call");
        assert_eq!(result.rows[8].size, 3);
        assert_eq!(result.rows[8].target, Some(0x8000));
        // JMP $9000
        assert_eq!(result.rows[9].kind, "jump");
        assert_eq!(result.rows[9].target, Some(0x9000));
    }

    #[test]
    fn decode_snes_long_and_branch_instructions() {
        let mut rom = Vec::new();
        // JSL $010000
        rom.extend_from_slice(&[0x22, 0x00, 0x00, 0x01]);
        // JML $020000
        rom.extend_from_slice(&[0x5C, 0x00, 0x00, 0x02]);
        // BRA +4
        rom.extend_from_slice(&[0x80, 0x04]);
        // BNE +2
        rom.extend_from_slice(&[0xD0, 0x02]);
        // BEQ +0
        rom.extend_from_slice(&[0xF0, 0x00]);
        // RTL
        rom.push(0x6B);
        // RTS
        rom.push(0x60);

        let loaded = sample_loaded("snes", rom, vec![0]);
        let result = disassemble_region(&loaded, 0, 32);
        assert!(result.ok);

        // JSL: size=4, call, target=0x010000
        assert_eq!(result.rows[0].size, 4);
        assert_eq!(result.rows[0].kind, "call");
        assert_eq!(result.rows[0].target, Some(0x010000));

        // JML: size=4, jump (terminal), target=0x020000
        assert_eq!(result.rows[1].size, 4);
        assert_eq!(result.rows[1].kind, "jump");
        assert_eq!(result.rows[1].target, Some(0x020000));

        // BRA: size=2, branch (terminal), target = 8 + 2 + 4 = 14
        assert_eq!(result.rows[2].size, 2);
        assert_eq!(result.rows[2].kind, "branch");
        assert_eq!(result.rows[2].target, Some(14));

        // BNE: size=2, branch (non-terminal), target = 10 + 2 + 2 = 14
        assert_eq!(result.rows[3].kind, "branch");
        assert_eq!(result.rows[3].target, Some(14));

        // BEQ: size=2, branch (non-terminal), target = 12 + 2 + 0 = 14
        assert_eq!(result.rows[4].kind, "branch");
        assert_eq!(result.rows[4].target, Some(14));

        // RTL: return (terminal)
        assert_eq!(result.rows[5].kind, "return");
        assert!(result.rows[5].text.contains("rtl"));

        // RTS: return (terminal)
        assert_eq!(result.rows[6].kind, "return");
        assert!(result.rows[6].text.contains("rts"));
    }

    #[test]
    fn decode_snes_unknown_opcode_produces_db() {
        // 0x02 = COP (not decoded), 0x60 = RTS
        let rom = vec![0x02, 0x60];
        let loaded = sample_loaded("snes", rom, vec![0]);
        let result = disassemble_region(&loaded, 0, 8);
        assert!(result.ok);
        assert_eq!(result.rows[0].kind, "data");
        assert!(result.rows[0].text.contains("db $02"));
        // Second byte is RTS
        assert_eq!(result.rows[1].kind, "return");
    }

    #[test]
    fn analyze_code_walks_multiple_entry_points_and_builds_xrefs() {
        // At offset 0x00: JSR $00000010 + RTS
        // At offset 0x10: NOP + RTS
        let mut rom = vec![0u8; 0x14];
        // JSR abs.l $00000010
        rom[0] = 0x4E;
        rom[1] = 0xB9;
        rom[2..6].copy_from_slice(&0x0000_0010u32.to_be_bytes());
        // RTS at offset 6
        rom[6] = 0x4E;
        rom[7] = 0x75;
        // NOP at offset 0x10
        rom[0x10] = 0x4E;
        rom[0x11] = 0x71;
        // RTS at offset 0x12
        rom[0x12] = 0x4E;
        rom[0x13] = 0x75;

        let loaded = sample_loaded("megadrive", rom, vec![0]);
        let (regions, graph, _) = analyze_code(&loaded);

        assert_eq!(regions.len(), 1);
        // Should discover 2 functions: sub at 0 and sub at 0x10
        assert!(regions[0].functions.len() >= 2);

        // Call graph should have edge from 0 -> 0x10
        assert!(graph
            .iter()
            .any(|edge| edge.from == 0 && edge.to == 0x10 && edge.kind == "call"));

        // Xrefs should have a call entry
        assert!(regions[0]
            .xrefs
            .iter()
            .any(|xref| xref.to == 0x10 && xref.kind == "call"));
    }

    #[test]
    fn decode_megadrive_indirect_auto_increment_side_effects() {
        let rom = vec![
            0x10, 0x18, // move.b (a0)+, d0
            0x14, 0x21, // move.b -(a1), d2
        ];
        let loaded = sample_loaded("megadrive", rom, vec![0]);
        let result = disassemble_region(&loaded, 0, 8);
        assert!(result.ok);
        assert_eq!(result.rows[0].kind, "move");
        assert!(result.rows[0].text.contains("(a0)+"));
        assert!(result.rows[0].text.contains("d0"));
        assert_eq!(result.rows[1].kind, "move");
        assert!(result.rows[1].text.contains("-(a1)"));
        assert!(result.rows[1].text.contains("d2"));
    }

    #[test]
    fn decode_megadrive_data_alignment_even() {
        let rom = vec![0x60, 0x03, 0x4E, 0x75];
        let loaded = sample_loaded("megadrive", rom, vec![0]);
        let result = disassemble_region(&loaded, 0, 8);
        assert!(result.ok);
        assert_eq!(result.rows[0].kind, "branch");
        assert_eq!(result.rows[0].target, Some(4));
    }

    #[test]
    fn decode_snes_bank_crossing_trampolines() {
        let mut rom = vec![0u8; 0x10010];
        rom[0..4].copy_from_slice(&[0x22, 0x00, 0x00, 0x01]); // JSL $010000
        rom[4] = 0x6B; // RTL
        rom[0x10000] = 0xEA; // NOP in another bank
        rom[0x10001] = 0x6B; // RTL

        let loaded = sample_loaded("snes", rom, vec![0]);
        let mut trace = ExecutionTraceLog::default();
        trace.mark_executed_with_state(
            0,
            CpuState {
                m_flag: false,
                x_flag: true,
            },
        );
        trace.mark_executed_with_state(
            0x010000,
            CpuState {
                m_flag: true,
                x_flag: true,
            },
        );

        let (regions, graph, hints) = analyze_code_with_trace(&loaded, Some(&trace));

        assert_eq!(regions.len(), 1);
        assert!(graph
            .iter()
            .any(|edge| edge.from == 0 && edge.to == 0x010000));
        assert!(regions[0]
            .functions
            .iter()
            .any(|function| function.address == 0x010000 && function.executed));
        assert!(hints
            .iter()
            .any(|hint| hint.message.contains("Trace dinamico aplicado")));
    }

    #[test]
    fn decode_snes_direct_page_indirect_long() {
        let rom = vec![0xA7, 0x12, 0x60];
        let loaded = sample_loaded("snes", rom, vec![0]);
        let result = disassemble_region(&loaded, 0, 8);
        assert!(result.ok);
        assert_eq!(result.rows[0].kind, "memory");
        assert_eq!(result.rows[0].size, 2);
        assert!(result.rows[0].text.contains("lda [$12]"));
        assert_eq!(result.rows[1].kind, "return");
    }

    #[test]
    fn analyze_code_handles_ascii_disguised_as_code() {
        let mut rom = vec![0u8; 0x30];
        rom[0] = 0x4E;
        rom[1] = 0xB9;
        rom[2..6].copy_from_slice(&0x0000_0020u32.to_be_bytes());
        rom[6] = 0x4E;
        rom[7] = 0x75;
        rom[0x20..0x24].copy_from_slice(b"GAME");

        let loaded = sample_loaded("megadrive", rom, vec![0]);
        let mut trace = ExecutionTraceLog::default();
        trace.mark_executed(0);

        let (regions, _, _) = analyze_code_with_trace(&loaded, Some(&trace));
        let data_view = disassemble_region(&loaded, 0x20, 4);

        assert_eq!(regions.len(), 1);
        assert!(!regions[0]
            .functions
            .iter()
            .any(|function| function.address == 0x20));
        assert!(!regions[0].disassembly.iter().any(|row| row.offset >= 0x20));
        assert_eq!(data_view.rows[0].kind, "data");
    }

    #[test]
    fn analyze_code_handles_pointers_to_middle_of_instructions() {
        let mut rom = vec![0u8; 0x10];
        rom[0] = 0x4E;
        rom[1] = 0xB9;
        rom[2..6].copy_from_slice(&0x0000_0002u32.to_be_bytes());
        rom[6] = 0x4E;
        rom[7] = 0x75;

        let loaded = sample_loaded("megadrive", rom, vec![0]);
        let (regions, graph, _) = analyze_code(&loaded);

        assert_eq!(regions.len(), 1);
        assert!(graph.iter().any(|edge| edge.to == 0x2));
        assert!(!regions[0]
            .functions
            .iter()
            .any(|function| function.address == 0x2));
    }
}
