//! Núcleo estático da decompilação pareada M68K (`docs/12_DECOMPILACAO_PAREADA_PLANO.md`,
//! Fase 0 / Sprint 1, sob GO formal do operador em 2026-09-09).
//!
//! Determinístico: sem LLM, sem UI e sem comandos Tauri nesta fase. Toda ROM é BYOR
//! (host-provided, somente leitura; nada de ROM versionada no repo). Saídas persistidas
//! ficam em `RDS_DECOMP_WORK` (default `~/.retrodev/decomp_work`) e relatórios de
//! validação em `target-test/validation/decomp/` (gitignored).
//!
//! API staged: os consumidores de produção (comandos/Reverse Workspace) chegam nas
//! fases seguintes do plano; hoje o núcleo é exercido pelos testes unitários e pelo
//! runner `#[ignore]` da Etapa A — daí o `allow(dead_code)` de módulo.

#![allow(dead_code)]

pub mod decomp_orch;
pub mod fingerprint;
pub mod ghidra_bridge;
pub mod object_diff;
pub mod rom_library;
pub mod symbols;
pub mod triage;
