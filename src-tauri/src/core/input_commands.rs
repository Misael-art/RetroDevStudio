use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const DEFAULT_MAX_FRAMES: u32 = 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InputCommandStep {
    pub tokens: Vec<String>,
    pub display: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InputCommandDefinition {
    pub id: String,
    pub display_name: String,
    pub notation: String,
    pub source: String,
    pub max_frames: u32,
    pub steps: Vec<InputCommandStep>,
    pub unsupported_tokens: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledInputCommandStep {
    pub direction: Option<u8>,
    pub buttons: Vec<String>,
    pub unsupported_tokens: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledInputCommand {
    pub steps: Vec<CompiledInputCommandStep>,
    pub unsupported_tokens: Vec<String>,
}

pub fn parse_command_dat(content: &str, source: &str) -> Vec<InputCommandDefinition> {
    let mut commands = Vec::new();
    let mut in_command = false;
    let mut name = String::new();
    let mut notation = String::new();
    let mut max_frames = DEFAULT_MAX_FRAMES;

    fn flush(
        commands: &mut Vec<InputCommandDefinition>,
        in_command: bool,
        name: &str,
        notation: &str,
        max_frames: u32,
        source: &str,
    ) {
        if !in_command || name.trim().is_empty() || notation.trim().is_empty() {
            return;
        }
        let compiled = parse_command_notation(notation);
        commands.push(InputCommandDefinition {
            id: slugify(name),
            display_name: name.trim().to_string(),
            notation: notation.trim().to_string(),
            source: source.to_string(),
            max_frames,
            steps: compiled
                .steps
                .iter()
                .map(|step| InputCommandStep {
                    tokens: step_tokens_for_display(step),
                    display: step
                        .tokens_for_display()
                        .into_iter()
                        .map(|token| display_token(&token))
                        .collect(),
                })
                .collect(),
            unsupported_tokens: compiled.unsupported_tokens,
        });
    }

    for raw_line in content.lines() {
        let line = strip_comment(raw_line).trim().to_string();
        if line.is_empty() {
            continue;
        }

        if line.starts_with('[') && line.ends_with(']') {
            flush(
                &mut commands,
                in_command,
                &name,
                &notation,
                max_frames,
                source,
            );
            in_command = line[1..line.len() - 1]
                .trim()
                .eq_ignore_ascii_case("command");
            name.clear();
            notation.clear();
            max_frames = DEFAULT_MAX_FRAMES;
            continue;
        }

        if !in_command {
            continue;
        }

        if let Some((raw_key, raw_value)) = line.split_once('=') {
            let key = raw_key.trim().to_ascii_lowercase();
            let value = unquote(raw_value.trim());
            match key.as_str() {
                "name" => name = value,
                "command" => notation = value,
                "time" => {
                    max_frames = value
                        .parse::<u32>()
                        .ok()
                        .filter(|value| *value > 0)
                        .unwrap_or(DEFAULT_MAX_FRAMES);
                }
                _ => {}
            }
        }
    }

    flush(
        &mut commands,
        in_command,
        &name,
        &notation,
        max_frames,
        source,
    );

    commands
}

pub fn parse_command_notation(notation: &str) -> CompiledInputCommand {
    let mut unsupported = BTreeSet::new();
    let steps = notation
        .split(',')
        .filter_map(|chunk| {
            let tokens: Vec<String> = chunk
                .split('+')
                .map(|token| token.trim())
                .filter(|token| !token.is_empty())
                .map(ToOwned::to_owned)
                .collect();
            if tokens.is_empty() {
                return None;
            }

            let mut direction = None;
            let mut buttons = Vec::new();
            let mut step_unsupported = Vec::new();
            for token in &tokens {
                match classify_token(token) {
                    TokenKind::Direction(value) => direction = Some(value),
                    TokenKind::Button(value) => buttons.push(value),
                    TokenKind::Unsupported => {
                        unsupported.insert(token.clone());
                        step_unsupported.push(token.clone());
                    }
                }
            }

            Some(CompiledInputCommandStep {
                direction,
                buttons,
                unsupported_tokens: step_unsupported,
            })
        })
        .collect();

    CompiledInputCommand {
        steps,
        unsupported_tokens: unsupported.into_iter().collect(),
    }
}

enum TokenKind {
    Direction(u8),
    Button(String),
    Unsupported,
}

trait DisplayTokens {
    fn tokens_for_display(&self) -> Vec<String>;
}

impl DisplayTokens for CompiledInputCommandStep {
    fn tokens_for_display(&self) -> Vec<String> {
        let mut tokens = Vec::new();
        if let Some(direction) = self.direction {
            tokens.push(format!("_{}", direction));
        }
        tokens.extend(self.buttons.iter().cloned());
        tokens.extend(self.unsupported_tokens.iter().cloned());
        tokens
    }
}

fn step_tokens_for_display(step: &CompiledInputCommandStep) -> Vec<String> {
    step.tokens_for_display()
}

fn classify_token(token: &str) -> TokenKind {
    let raw = token.trim();
    if matches!(raw, "a" | "b" | "c" | "x" | "y" | "z") {
        return TokenKind::Button(format!("_{}", raw.to_ascii_uppercase()));
    }
    let key = token_key(token);
    match key.as_str() {
        "1" => TokenKind::Direction(1),
        "2" | "D" => TokenKind::Direction(2),
        "3" | "DF" => TokenKind::Direction(3),
        "4" | "B" => TokenKind::Direction(4),
        "5" => TokenKind::Direction(5),
        "6" | "F" => TokenKind::Direction(6),
        "7" | "UB" => TokenKind::Direction(7),
        "8" | "U" => TokenKind::Direction(8),
        "9" | "UF" => TokenKind::Direction(9),
        "DB" => TokenKind::Direction(1),
        "P" | "K" | "A" | "C" | "X" | "Y" | "Z" => TokenKind::Button(format!("_{}", key)),
        _ => TokenKind::Unsupported,
    }
}

fn display_token(token: &str) -> String {
    let raw = token.trim();
    if matches!(raw, "a" | "b" | "c" | "x" | "y" | "z") {
        return raw.to_ascii_uppercase();
    }
    match token_key(token).as_str() {
        "1" | "DB" => "↙".to_string(),
        "2" | "D" => "↓".to_string(),
        "3" | "DF" => "↘".to_string(),
        "4" | "B" => "←".to_string(),
        "5" => "•".to_string(),
        "6" | "F" => "→".to_string(),
        "7" | "UB" => "↖".to_string(),
        "8" | "U" => "↑".to_string(),
        "9" | "UF" => "↗".to_string(),
        "P" | "K" | "A" | "C" | "X" | "Y" | "Z" => token_key(token),
        _ => token.to_string(),
    }
}

fn token_key(token: &str) -> String {
    token.trim().trim_start_matches('_').to_ascii_uppercase()
}

fn strip_comment(line: &str) -> &str {
    let semicolon = line.find(';');
    let hash = line.find('#');
    let cut = match (semicolon, hash) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    };
    cut.map(|index| &line[..index]).unwrap_or(line)
}

fn unquote(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_separator = false;
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            previous_separator = false;
        } else if !previous_separator {
            slug.push('_');
            previous_separator = true;
        }
    }
    let slug = slug.trim_matches('_').to_string();
    if slug.is_empty() {
        "command".to_string()
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::parse_command_dat;

    #[test]
    fn parses_hadouken_numpad_command() {
        let commands = parse_command_dat(
            r#"
[Command]
name = "Hadouken"
command = _2, _3, _6, _P
time = 15
"#,
            "local-command.dat",
        );

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].id, "hadouken");
        assert_eq!(commands[0].display_name, "Hadouken");
        assert_eq!(commands[0].notation, "_2, _3, _6, _P");
        assert_eq!(commands[0].max_frames, 15);
        assert!(commands[0].unsupported_tokens.is_empty());
        assert_eq!(
            commands[0]
                .steps
                .iter()
                .map(|step| step.tokens.clone())
                .collect::<Vec<_>>(),
            vec![vec!["_2"], vec!["_3"], vec!["_6"], vec!["_P"]]
        );
    }

    #[test]
    fn parses_shoryuken_and_simultaneous_inputs() {
        let commands = parse_command_dat(
            r#"
[Command]
name = Shoryuken
command = _6, _2, _3+_P
time = 12
"#,
            "local-command.dat",
        );

        assert_eq!(commands[0].id, "shoryuken");
        assert_eq!(commands[0].steps[2].tokens, vec!["_3", "_P"]);
        assert!(commands[0].unsupported_tokens.is_empty());
    }

    #[test]
    fn unknown_tokens_block_runtime() {
        let commands = parse_command_dat(
            r#"
[Command]
name = Weird
command = ~30, _6, _P
time = 18
"#,
            "local-command.dat",
        );

        assert_eq!(commands[0].unsupported_tokens, vec!["~30"]);
    }
}
