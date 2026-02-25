use crate::ugdm::entities::{Project, Scene};
use crate::ugdm::components::SpriteComponent;

// ── AST Nodes ─────────────────────────────────────────────────────────────────

/// Um nó do AST representa uma operação de alto nível (agnóstica de SDK).
/// Campos marcados com allow(dead_code) serão consumidos na Sprint 1.3 (build_orch).
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum AstNode {
    /// Inicialização do sistema de sprites
    SpriteSystemInit,

    /// Carregamento de um spritesheet na VRAM
    /// (resource_name, asset_path, frame_w, frame_h, palette_slot)
    LoadSpritesheet {
        resource_name: String,
        asset_path: String,
        frame_width: u32,
        frame_height: u32,
        palette_slot: u8,
    },

    /// Instância de um sprite na cena
    /// (var_name, resource_name, x, y, priority)
    SpawnSprite {
        var_name: String,
        resource_name: String,
        x: i32,
        y: i32,
        priority_high: bool,
    },

    /// Configuração de animação em um sprite
    /// (var_name, anim_index)
    SetAnimation {
        var_name: String,
        anim_index: u32,
    },

    /// Texto na tela (placeholder debug)
    DrawText {
        x: u32,
        y: u32,
        text: String,
        palette_slot: u8,
    },

    /// Loop principal do jogo
    GameLoopBegin,
    GameLoopEnd,

    /// Atualização do engine de sprites (deve estar dentro do loop)
    SpriteUpdate,

    /// Espera pelo VSync
    VSync,
}

/// Resultado da geração do AST: nós + metadados de recursos
#[derive(Debug)]
pub struct AstOutput {
    pub nodes: Vec<AstNode>,
    pub sprite_assets: Vec<SpriteAsset>,
}

/// Metadados de asset de sprite — campos serão consumidos pelo build_orch (Sprint 1.3).
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct SpriteAsset {
    pub resource_name: String,
    pub asset_path: String,
    pub frame_width: u32,
    pub frame_height: u32,
    pub palette_slot: u8,
    pub animation_count: u32,
}

// ── Geração ───────────────────────────────────────────────────────────────────

/// Converte um Project + Scene em uma lista de AstNodes.
/// Esta função é agnóstica de SDK — a tradução para SGDK ocorre no sgdk_emitter.
pub fn generate_ast(project: &Project, scene: &Scene) -> AstOutput {
    let mut nodes: Vec<AstNode> = Vec::new();
    let mut sprite_assets: Vec<SpriteAsset> = Vec::new();

    // Inicializa sistemas
    nodes.push(AstNode::SpriteSystemInit);

    // Coleta texto de debug da cena
    nodes.push(AstNode::DrawText {
        x: 1,
        y: 1,
        text: format!("{} — {}", project.name, scene.scene_id),
        palette_slot: 0,
    });

    // Processa entidades com sprite
    for entity in &scene.entities {
        let Some(spr) = &entity.components.sprite else {
            continue;
        };

        let resource_name = sanitize_identifier(&entity.entity_id);
        let var_name = format!("spr_{}", resource_name);

        // Registra asset se ainda não foi adicionado
        if !sprite_assets.iter().any(|a| a.asset_path == spr.asset) {
            let anim_count = count_unique_frames(spr);
            sprite_assets.push(SpriteAsset {
                resource_name: resource_name.clone(),
                asset_path: spr.asset.clone(),
                frame_width: spr.frame_width,
                frame_height: spr.frame_height,
                palette_slot: spr.palette_slot,
                animation_count: anim_count,
            });

            nodes.push(AstNode::LoadSpritesheet {
                resource_name: resource_name.clone(),
                asset_path: spr.asset.clone(),
                frame_width: spr.frame_width,
                frame_height: spr.frame_height,
                palette_slot: spr.palette_slot,
            });
        }

        let priority_high = spr.priority == "foreground";

        nodes.push(AstNode::SpawnSprite {
            var_name: var_name.clone(),
            resource_name: resource_name.clone(),
            x: entity.transform.x,
            y: entity.transform.y,
            priority_high,
        });

        // Define animação padrão (primeira definida, se houver)
        if !spr.animations.is_empty() {
            nodes.push(AstNode::SetAnimation {
                var_name: var_name.clone(),
                anim_index: 0,
            });
        }
    }

    // Loop principal
    nodes.push(AstNode::GameLoopBegin);
    nodes.push(AstNode::SpriteUpdate);
    nodes.push(AstNode::VSync);
    nodes.push(AstNode::GameLoopEnd);

    AstOutput { nodes, sprite_assets }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Converte um entity_id para um identificador C válido.
fn sanitize_identifier(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_alphanumeric() || c == '_' { c } else { '_' })
        .collect::<String>()
        .to_lowercase()
}

/// Conta o número total de frames únicos nas animações de um sprite.
fn count_unique_frames(spr: &SpriteComponent) -> u32 {
    use std::collections::HashSet;
    let unique: HashSet<u32> = spr.animations.values()
        .flat_map(|a| a.frames.iter().copied())
        .collect();
    unique.len().max(1) as u32
}
