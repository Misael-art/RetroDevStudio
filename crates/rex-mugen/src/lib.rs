//! Perfil MUGEN -> SGDK do RetroDev (Experimental). Contrato: `CONTRACT.md`.
//!
//! Dados de entrada sao dados, nunca instrucoes: nada aqui executa conteudo do pacote.
//! Pacote autonomo: sem Tauri, sem dependencias externas, sem filesystem na logica.

pub mod air;
pub mod diag;
pub mod fixture;
pub mod palette;
pub mod plan;
pub mod sff;
pub mod sha256;
