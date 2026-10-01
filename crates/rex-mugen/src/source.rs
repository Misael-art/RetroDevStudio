//! Triagem pura de DEF e referências. Não executa nem modifica pacotes.
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reference {
    pub section: String,
    pub key: String,
    pub value: String,
    pub line: u32,
}

#[derive(Debug, Clone, Default)]
pub struct Definition {
    pub name: String,
    pub references: Vec<Reference>,
    pub duplicate_keys: Vec<(String, u32)>,
}

impl Definition {
    pub fn file(&self, key: &str) -> Option<&str> {
        self.references
            .iter()
            .find(|r| r.section == "files" && r.key == key)
            .map(|r| r.value.as_str())
    }
    pub fn is_character(&self) -> bool {
        self.file("sprite").is_some() && self.file("anim").is_some()
    }
}

pub fn parse_def(text: &str) -> Definition {
    let mut out = Definition::default();
    let mut section = String::new();
    let mut seen = BTreeMap::new();
    for (i, raw) in text.lines().enumerate() {
        let line = raw.split(';').next().unwrap_or_default().trim();
        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].trim().to_ascii_lowercase();
        } else if let Some((key, value)) = line.split_once('=') {
            let key = key.trim().to_ascii_lowercase();
            let value = value.trim().trim_matches('"').to_string();
            if section == "info" && (key == "name" || key == "displayname") {
                out.name = value.clone();
            }
            if matches!(section.as_str(), "files" | "arcade") {
                if seen.insert((section.clone(), key.clone()), i).is_some() {
                    out.duplicate_keys.push((key.clone(), i as u32 + 1));
                }
                out.references.push(Reference {
                    section: section.clone(),
                    key,
                    value,
                    line: i as u32 + 1,
                });
            }
        }
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolution {
    Resolved(String),
    Missing,
    Ambiguous(Vec<String>),
    External,
}

/// Case-insensitive, relativo ao DEF. Nunca escolhe entre colisões de nomes.
pub fn resolve(files: &[String], base: &str, requested: &str) -> Resolution {
    let rel = requested.trim().trim_matches('"').replace('\\', "/");
    if rel.starts_with('/') || rel.contains(':') || rel.split('/').any(|p| p == "..") {
        return Resolution::External;
    }
    let candidate = if base.is_empty() {
        rel
    } else {
        format!("{base}/{rel}")
    };
    let hits: Vec<String> = files
        .iter()
        .filter(|f| f.eq_ignore_ascii_case(&candidate))
        .cloned()
        .collect();
    match hits.len() {
        0 => Resolution::Missing,
        1 => Resolution::Resolved(hits[0].clone()),
        _ => Resolution::Ambiguous(hits),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distinguishes_storyboard_and_duplicate_reference_with_location() {
        assert!(!parse_def("[SceneDef]\nspr=x.sff").is_character());
        let d = parse_def("[Files]\nsprite=a.sff\nanim=a.air\nanim=b.air");
        assert!(d.is_character());
        assert_eq!(d.duplicate_keys, vec![("anim".into(), 4)]);
    }
    #[test]
    fn paths_are_unambiguous_and_contained_on_every_host() {
        let files = vec![
            "ken/Ken.AIR".into(),
            "ken/ken.air".into(),
            "ken/a/b.sff".into(),
        ];
        assert!(matches!(
            resolve(&files, "ken", "ken.air"),
            Resolution::Ambiguous(_)
        ));
        assert_eq!(
            resolve(&files, "ken", "a\\b.sff"),
            Resolution::Resolved("ken/a/b.sff".into())
        );
        for p in ["../outside", "C:\\outside", "/outside"] {
            assert_eq!(resolve(&files, "ken", p), Resolution::External);
        }
        assert_eq!(resolve(&files, "ken", "missing"), Resolution::Missing);
    }
}
