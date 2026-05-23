use std::collections::BTreeMap;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SgdkPatternNodeTemplate {
    pub node_type: String,
    pub label: String,
    pub params: BTreeMap<String, String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SgdkPatternTemplate {
    pub id: String,
    pub title: String,
    pub origin: String,
    pub technical_description: String,
    pub requirements: Vec<String>,
    pub risks: Vec<String>,
    pub targets_supported: Vec<String>,
    pub nodes_generated: Vec<SgdkPatternNodeTemplate>,
    pub hardware_warnings: Vec<String>,
    pub maturity: String,
    pub experimental: bool,
}

pub fn list_sgdk_pattern_templates() -> Vec<SgdkPatternTemplate> {
    vec![
        template(
            "line_scroll",
            "Line Scroll",
            "SGDK scroll table / HSCROLL_LINE pattern, modelado como template experimental RDS.",
            "Atualiza scroll por linha para parallax/raster sem prometer engine de efeitos completa.",
            ["Plano com tilemap largo", "VBlank/HBlank budget revisado"],
            ["Pode consumir DMA/CPU se atualizado sem limite por frame."],
            ["megadrive"],
            [
                node("event_vblank", "VBlank tick", []),
                node("effect_parallax", "Line scroll table", [("mode", "line_scroll")]),
            ],
            ["HSCROLL_LINE compete com outros efeitos de raster e precisa de medicao real."],
        ),
        template(
            "h_int",
            "H-Int",
            "SGDK horizontal interrupt callback, exposto como esqueleto rastreavel.",
            "Gera um ponto de interrupcao por linha para troca controlada de estado visual.",
            ["Registro H-Int revisado", "Rotina curta e deterministica"],
            ["Rotina longa quebra estabilidade de frame."],
            ["megadrive"],
            [
                node("event_hblank", "H-Int event", []),
                node("var_set", "Scanline latch", [("var_name", "h_int_line")]),
            ],
            ["H-Int deve permanecer minimo; qualquer acesso pesado precisa migrar para VBlank."],
        ),
        template(
            "pseudo_3d_road",
            "Pseudo-3D Road",
            "Padrao SGDK de estrada por line scroll, sem claim de engine pronta.",
            "Combina tabela de linhas, velocidade e horizonte para prototipo de estrada.",
            ["Line scroll ativo", "Tiles de estrada deduplicados"],
            ["Alto risco de tearing sem prova de frame stability."],
            ["megadrive"],
            [
                node("event_update", "Road tick", []),
                node("effect_parallax", "Road line scroll", [("profile", "pseudo_road")]),
                node("var_set", "Road speed", [("var_name", "road_speed")]),
            ],
            ["Pressiona CPU por linha e deve ser medido no Debug antes de build final."],
        ),
        template(
            "tile_streaming",
            "Tile Streaming",
            "SGDK DMA tile streaming pattern para mapas maiores que VRAM residente.",
            "Separa tiles residentes e streamaveis em um fluxo de camera.",
            ["Mapa segmentado", "Budget DMA por frame declarado"],
            ["Streaming acima do budget causa stutter ou artefatos."],
            ["megadrive"],
            [
                node("event_update", "Camera stream tick", []),
                node("move_camera", "Camera window", []),
                node("hardware_budget", "DMA budget", [("axis", "dma_frame")]),
            ],
            ["DMA por frame precisa ficar abaixo do limite do perfil de hardware."],
        ),
        template(
            "hud_window",
            "HUD via WINDOW",
            "SGDK WINDOW plane para HUD fixo, mapeado como template operacional.",
            "Reserva uma area de HUD sem misturar com o scroll principal.",
            ["Plane WINDOW disponivel", "Tiles/fontes de HUD separados"],
            ["Conflita com layouts que ja usam WINDOW para efeitos."],
            ["megadrive"],
            [
                node("event_vblank", "HUD VBlank", []),
                node("draw_text", "HUD text", [("plane", "WINDOW")]),
            ],
            ["WINDOW reduz flexibilidade de planos; revisar camadas antes de inserir."],
        ),
        template(
            "slope_collision",
            "Slope Collision",
            "Contrato de colisao inclinada como nodes e dados, nao fisica pronta.",
            "Adiciona leitura de metatile/slope id antes da resolucao de movimento.",
            ["CollisionMap com metadados", "Physics em ponto fixo"],
            ["Sem tabela de slopes real, o build deve permanecer Experimental."],
            ["megadrive", "snes"],
            [
                node("event_update", "Slope tick", []),
                node("condition_tile", "Read slope tile", [("kind", "slope")]),
                node("apply_physics", "Slope response", []),
            ],
            ["Slope exige validacao por target; nao assumir paridade MD/SNES."],
        ),
        template(
            "scene_reset",
            "Scene Reset",
            "Padrao de reset de cena para depuracao e fluxo de retry.",
            "Liga input/evento a reinicializacao controlada de variaveis e posicoes.",
            ["Cena com estado inicial definido", "Input declarado"],
            ["Reset parcial pode mascarar estado persistente/SRAM."],
            ["megadrive", "snes"],
            [
                node("event_update", "Reset poll", []),
                node("condition_input", "Reset combo", [("button", "START")]),
                node("scene_reset", "Reset scene state", []),
            ],
            ["Confirmar que SRAM/save nao e apagado silenciosamente."],
        ),
        template(
            "tidy_text",
            "TidyText",
            "Fluxo de texto compacto para debug/HUD com limites explicitos.",
            "Centraliza desenho de texto com paleta e tile budget revisaveis.",
            ["Fonte/tile budget definido", "Paleta de texto reservada"],
            ["Texto demais ocupa tiles e pode conflitar com HUD."],
            ["megadrive", "snes"],
            [
                node("event_vblank", "Text tick", []),
                node("draw_text", "Tidy text draw", [("style", "tidy")]),
                node("hardware_budget", "Text tile budget", [("axis", "tiles")]),
            ],
            ["Texto deve ser medido como tiles, nao tratado como overlay gratis."],
        ),
    ]
}

#[allow(clippy::too_many_arguments)]
fn template<const R: usize, const K: usize, const T: usize, const W: usize>(
    id: &str,
    title: &str,
    origin: &str,
    technical_description: &str,
    requirements: [&str; R],
    risks: [&str; K],
    targets_supported: [&str; T],
    nodes_generated: [SgdkPatternNodeTemplate; W],
    hardware_warnings: [&str; 1],
) -> SgdkPatternTemplate {
    SgdkPatternTemplate {
        id: id.to_string(),
        title: title.to_string(),
        origin: origin.to_string(),
        technical_description: technical_description.to_string(),
        requirements: requirements.iter().map(|value| value.to_string()).collect(),
        risks: risks.iter().map(|value| value.to_string()).collect(),
        targets_supported: targets_supported
            .iter()
            .map(|value| value.to_string())
            .collect(),
        nodes_generated: nodes_generated.into_iter().collect(),
        hardware_warnings: hardware_warnings
            .iter()
            .map(|value| value.to_string())
            .collect(),
        maturity: "experimental".to_string(),
        experimental: true,
    }
}

fn node<const N: usize>(
    node_type: &str,
    label: &str,
    params: [(&str, &str); N],
) -> SgdkPatternNodeTemplate {
    SgdkPatternNodeTemplate {
        node_type: node_type.to_string(),
        label: label.to_string(),
        params: params
            .into_iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sgdk_pattern_registry_exposes_required_experimental_templates() {
        let templates = list_sgdk_pattern_templates();
        let ids = templates
            .iter()
            .map(|template| template.id.as_str())
            .collect::<Vec<_>>();

        for required in [
            "line_scroll",
            "h_int",
            "pseudo_3d_road",
            "tile_streaming",
            "hud_window",
            "slope_collision",
            "scene_reset",
            "tidy_text",
        ] {
            assert!(ids.contains(&required), "missing {required}");
        }

        assert!(templates.iter().all(|template| template.experimental));
        assert!(templates
            .iter()
            .all(|template| template.maturity == "experimental"));
        assert!(templates
            .iter()
            .all(|template| !template.hardware_warnings.is_empty()));
    }

    #[test]
    fn sgdk_pattern_template_contains_traceable_nodes_and_origin() {
        let template = list_sgdk_pattern_templates()
            .into_iter()
            .find(|template| template.id == "line_scroll")
            .expect("line scroll");

        assert!(template.origin.contains("SGDK"));
        assert!(template
            .nodes_generated
            .iter()
            .any(|node| node.node_type == "effect_parallax"));
        assert!(template
            .targets_supported
            .contains(&"megadrive".to_string()));
    }
}
