use crate::ugdm::components::{AnimationDef, SpriteComponent};
use crate::ugdm::entities::{Project, Scene};

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum AstNode {
    SpriteSystemInit,
    LoadTilemap {
        resource_name: String,
        asset_path: String,
        map_width: u32,
        map_height: u32,
    },
    LoadSpritesheet {
        resource_name: String,
        asset_path: String,
        frame_width: u32,
        frame_height: u32,
        palette_slot: u8,
    },
    SpawnSprite {
        var_name: String,
        resource_name: String,
        x: i32,
        y: i32,
        priority_high: bool,
    },
    DrawTilemap {
        resource_name: String,
        x: i32,
        y: i32,
        scroll_x: i32,
        scroll_y: i32,
    },
    SetAnimation {
        var_name: String,
        resource_name: String,
        anim_index: u32,
        frame_time: u32,
        frames: Vec<u32>,
        looping: bool,
    },
    DrawText {
        x: u32,
        y: u32,
        text: String,
        palette_slot: u8,
    },
    GameLoopBegin,
    GameLoopEnd,
    SpriteUpdate,
    VSync,
}

#[derive(Debug)]
pub struct AstOutput {
    pub nodes: Vec<AstNode>,
    pub sprite_assets: Vec<SpriteAsset>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct SpriteAsset {
    pub resource_name: String,
    pub asset_path: String,
    pub frame_width: u32,
    pub frame_height: u32,
    pub palette_slot: u8,
    pub animation_count: u32,
    pub default_animation: Option<SpriteAnimation>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpriteAnimation {
    pub name: String,
    pub frames: Vec<u32>,
    pub frame_time: u32,
    pub looping: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TilemapAsset {
    pub resource_name: String,
    pub asset_path: String,
    pub map_width: u32,
    pub map_height: u32,
}

pub fn generate_ast(project: &Project, scene: &Scene) -> AstOutput {
    let mut nodes: Vec<AstNode> = Vec::new();
    let mut sprite_assets: Vec<SpriteAsset> = Vec::new();
    let mut tilemap_assets: Vec<TilemapAsset> = Vec::new();
    let mut asset_resource_names: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut tilemap_resource_names: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    nodes.push(AstNode::SpriteSystemInit);
    nodes.push(AstNode::DrawText {
        x: 1,
        y: 1,
        text: format!("{} - {}", project.name, scene.scene_id),
        palette_slot: 0,
    });

    for entity in &scene.entities {
        if let Some(tilemap) = &entity.components.tilemap {
            let resource_name = tilemap_resource_names
                .get(&tilemap.tileset)
                .cloned()
                .unwrap_or_else(|| sanitize_identifier(&format!("{}_tilemap", entity.entity_id)));

            if !tilemap_assets
                .iter()
                .any(|asset| asset.asset_path == tilemap.tileset)
            {
                tilemap_assets.push(TilemapAsset {
                    resource_name: resource_name.clone(),
                    asset_path: tilemap.tileset.clone(),
                    map_width: tilemap.map_width,
                    map_height: tilemap.map_height,
                });
                tilemap_resource_names.insert(tilemap.tileset.clone(), resource_name.clone());

                nodes.push(AstNode::LoadTilemap {
                    resource_name: resource_name.clone(),
                    asset_path: tilemap.tileset.clone(),
                    map_width: tilemap.map_width,
                    map_height: tilemap.map_height,
                });
            }

            nodes.push(AstNode::DrawTilemap {
                resource_name,
                x: entity.transform.x,
                y: entity.transform.y,
                scroll_x: tilemap.scroll_x,
                scroll_y: tilemap.scroll_y,
            });
        }

        let Some(sprite) = &entity.components.sprite else {
            continue;
        };

        let resource_name = asset_resource_names
            .get(&sprite.asset)
            .cloned()
            .unwrap_or_else(|| sanitize_identifier(&entity.entity_id));
        let var_name = format!("spr_{}", resource_name);
        let default_animation = default_animation(project.fps, sprite);

        if !sprite_assets.iter().any(|asset| asset.asset_path == sprite.asset) {
            sprite_assets.push(SpriteAsset {
                resource_name: resource_name.clone(),
                asset_path: sprite.asset.clone(),
                frame_width: sprite.frame_width,
                frame_height: sprite.frame_height,
                palette_slot: sprite.palette_slot,
                animation_count: count_unique_frames(sprite),
                default_animation: default_animation.clone(),
            });
            asset_resource_names.insert(sprite.asset.clone(), resource_name.clone());

            nodes.push(AstNode::LoadSpritesheet {
                resource_name: resource_name.clone(),
                asset_path: sprite.asset.clone(),
                frame_width: sprite.frame_width,
                frame_height: sprite.frame_height,
                palette_slot: sprite.palette_slot,
            });
        }

        nodes.push(AstNode::SpawnSprite {
            var_name: var_name.clone(),
            resource_name: resource_name.clone(),
            x: entity.transform.x,
            y: entity.transform.y,
            priority_high: sprite.priority == "foreground",
        });

        if let Some(animation) = default_animation {
            nodes.push(AstNode::SetAnimation {
                var_name,
                resource_name,
                anim_index: 0,
                frame_time: animation.frame_time,
                frames: animation.frames,
                looping: animation.looping,
            });
        }
    }

    nodes.push(AstNode::GameLoopBegin);
    nodes.push(AstNode::SpriteUpdate);
    nodes.push(AstNode::VSync);
    nodes.push(AstNode::GameLoopEnd);

    AstOutput {
        nodes,
        sprite_assets,
    }
}

fn sanitize_identifier(id: &str) -> String {
    id.chars()
        .map(|character| {
            if character.is_alphanumeric() || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .to_lowercase()
}

fn count_unique_frames(sprite: &SpriteComponent) -> u32 {
    use std::collections::HashSet;

    let unique: HashSet<u32> = sprite
        .animations
        .values()
        .flat_map(|animation| animation.frames.iter().copied())
        .collect();
    unique.len().max(1) as u32
}

fn default_animation(project_fps: u32, sprite: &SpriteComponent) -> Option<SpriteAnimation> {
    let (name, animation) = sprite
        .animations
        .iter()
        .min_by(|(left_name, _), (right_name, _)| left_name.cmp(right_name))?;

    Some(SpriteAnimation {
        name: name.clone(),
        frames: normalized_frames(animation),
        frame_time: animation_frame_time(project_fps, animation.fps),
        looping: animation.looping,
    })
}

fn normalized_frames(animation: &AnimationDef) -> Vec<u32> {
    if animation.frames.is_empty() {
        vec![0]
    } else {
        animation.frames.clone()
    }
}

fn animation_frame_time(project_fps: u32, animation_fps: u32) -> u32 {
    if animation_fps == 0 {
        return 0;
    }

    ((project_fps + (animation_fps / 2)) / animation_fps).max(1)
}

pub fn collect_tilemap_assets(ast: &AstOutput) -> Vec<TilemapAsset> {
    ast.nodes
        .iter()
        .filter_map(|node| match node {
            AstNode::LoadTilemap {
                resource_name,
                asset_path,
                map_width,
                map_height,
            } => Some(TilemapAsset {
                resource_name: resource_name.clone(),
                asset_path: asset_path.clone(),
                map_width: *map_width,
                map_height: *map_height,
            }),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ugdm::components::Components;
    use crate::ugdm::entities::{Entity, Resolution, Transform};
    use std::collections::HashMap;

    #[test]
    fn generate_ast_uses_default_animation_timing_from_sprite_component() {
        let mut animations = HashMap::new();
        animations.insert(
            "walk".to_string(),
            AnimationDef {
                frames: vec![1, 2, 3, 4],
                fps: 10,
                looping: true,
            },
        );

        let project = Project {
            rds_version: "1.0".to_string(),
            name: "Timing Demo".to_string(),
            target: "megadrive".to_string(),
            resolution: Resolution {
                width: 320,
                height: 224,
            },
            fps: 60,
            palette_mode: "4x16".to_string(),
            entry_scene: "main".to_string(),
            build: None,
        };
        let scene = Scene {
            scene_id: "main".to_string(),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![Entity {
                entity_id: "hero".to_string(),
                prefab: None,
                transform: Transform { x: 32, y: 48 },
                components: Components {
                    sprite: Some(SpriteComponent {
                        asset: "assets/sprites/hero.png".to_string(),
                        frame_width: 16,
                        frame_height: 16,
                        pivot: None,
                        palette_slot: 1,
                        animations,
                        priority: "foreground".to_string(),
                    }),
                    ..Components::default()
                },
            }],
            palettes: Vec::new(),
        };

        let ast = generate_ast(&project, &scene);
        let asset = ast
            .sprite_assets
            .first()
            .expect("sprite asset should be registered");
        let default_animation = asset
            .default_animation
            .as_ref()
            .expect("default animation should be captured");

        assert_eq!(default_animation.frame_time, 6);
        assert_eq!(default_animation.frames, vec![1, 2, 3, 4]);
        assert!(default_animation.looping);

        let set_animation = ast
            .nodes
            .iter()
            .find_map(|node| match node {
                AstNode::SetAnimation {
                    resource_name,
                    frame_time,
                    frames,
                    looping,
                    ..
                } => Some((resource_name, frame_time, frames, looping)),
                _ => None,
            })
            .expect("animation node should be emitted");

        assert_eq!(set_animation.0, "hero");
        assert_eq!(*set_animation.1, 6);
        assert_eq!(set_animation.2, &vec![1, 2, 3, 4]);
        assert!(*set_animation.3);
    }

    #[test]
    fn animation_frame_time_disables_auto_animation_when_fps_is_zero() {
        assert_eq!(animation_frame_time(60, 0), 0);
    }

    #[test]
    fn generate_ast_emits_tilemap_nodes_for_tilemap_component() {
        let project = Project {
            rds_version: "1.0".to_string(),
            name: "Tilemap Demo".to_string(),
            target: "megadrive".to_string(),
            resolution: Resolution {
                width: 320,
                height: 224,
            },
            fps: 60,
            palette_mode: "4x16".to_string(),
            entry_scene: "main".to_string(),
            build: None,
        };
        let scene = Scene {
            scene_id: "main".to_string(),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![Entity {
                entity_id: "background".to_string(),
                prefab: None,
                transform: Transform { x: 16, y: 24 },
                components: Components {
                    tilemap: Some(crate::ugdm::components::TilemapComponent {
                        tileset: "assets/tilesets/level.ppm".to_string(),
                        map_width: 32,
                        map_height: 32,
                        scroll_x: 4,
                        scroll_y: 8,
                    }),
                    ..Components::default()
                },
            }],
            palettes: Vec::new(),
        };

        let ast = generate_ast(&project, &scene);
        let tilemap_assets = collect_tilemap_assets(&ast);

        assert_eq!(tilemap_assets.len(), 1);
        assert_eq!(tilemap_assets[0].resource_name, "background_tilemap");
        assert_eq!(tilemap_assets[0].asset_path, "assets/tilesets/level.ppm");

        assert!(ast.nodes.iter().any(|node| matches!(
            node,
            AstNode::DrawTilemap {
                resource_name,
                x,
                y,
                scroll_x,
                scroll_y
            } if resource_name == "background_tilemap"
                && *x == 16
                && *y == 24
                && *scroll_x == 4
                && *scroll_y == 8
        )));
    }
}
