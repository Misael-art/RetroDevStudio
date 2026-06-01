fn normalize_token(token: &str) -> String {
    let lower = token.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return lower;
    }

    if let Some(register_family) = lower.strip_prefix('d').or_else(|| lower.strip_prefix('a')) {
        if register_family
            .chars()
            .all(|character| character.is_ascii_digit())
        {
            return format!("{}n", &lower[..1]);
        }
    }

    if lower.starts_with('$') || lower.chars().all(|character| character.is_ascii_hexdigit()) {
        return "#imm".to_string();
    }

    lower
}

fn normalize_line(line: &str) -> String {
    line.split(|character: char| {
        character.is_whitespace() || matches!(character, ',' | '(' | ')' | '[' | ']')
    })
    .filter(|token| !token.trim().is_empty())
    .map(normalize_token)
    .collect::<Vec<_>>()
    .join(" ")
}

#[derive(Debug, Default, Clone, Copy)]
pub struct BinaryDiffScorer;

impl BinaryDiffScorer {
    pub fn score(&self, extracted_asm: &str, compiled_asm: &str) -> f32 {
        let left = extracted_asm
            .lines()
            .map(normalize_line)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>();
        let right = compiled_asm
            .lines()
            .map(normalize_line)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>();

        if left.is_empty() && right.is_empty() {
            return 1.0;
        }
        if left.is_empty() || right.is_empty() {
            return 0.0;
        }

        let matches = left
            .iter()
            .zip(right.iter())
            .filter(|(left_line, right_line)| left_line == right_line)
            .count();
        matches as f32 / left.len().max(right.len()) as f32
    }
}

#[cfg(test)]
mod tests {
    use super::BinaryDiffScorer;

    #[test]
    fn binary_diff_scorer_ignores_register_number_differences() {
        let scorer = BinaryDiffScorer;
        let left = "moveq #1, d0\njsr $000100\nrts";
        let right = "moveq #1, d1\njsr $000100\nrts";

        let score = scorer.score(left, right);
        assert!(score >= 0.9, "expected high structural match, got {score}");
    }
}
