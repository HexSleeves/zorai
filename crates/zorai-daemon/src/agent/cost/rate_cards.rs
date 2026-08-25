//! Provider rate cards for token-to-USD cost estimation.
//!
//! Each `RateCard` stores the per-million-token price for input (prompt) and
//! output (completion) tokens. `default_rate_cards` returns a baseline table
//! covering the most popular models; operators can override via `CostConfig`.
//! Unknown models fall back to `FALLBACK_RATE` so cost never stays at `None`
//! just because a new model id shipped in the frontend catalog.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Per-model pricing: input and output cost per 1 million tokens (USD).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateCard {
    pub input_per_million: f64,
    pub output_per_million: f64,
}

/// Generic fallback when no specific card matches. Cheap enough to avoid
/// scary numbers, expensive enough to notice.  ~ GPT-4o-mini class.
pub const FALLBACK_RATE: RateCard = RateCard {
    input_per_million: 2.0,
    output_per_million: 8.0,
};

fn insert(cards: &mut HashMap<String, RateCard>, id: &str, inp: f64, out: f64) {
    cards.insert(id.to_string(), RateCard { input_per_million: inp, output_per_million: out });
}

/// Returns default rate cards for popular models. Prices are per 1M tokens (USD).
pub fn default_rate_cards() -> HashMap<String, RateCard> {
    let mut cards = HashMap::new();
    // --- OpenAI GPT-4o / o1 era (kept for compat) ---
    insert(&mut cards, "gpt-4o", 2.50, 10.00);
    insert(&mut cards, "gpt-4o-mini", 0.15, 0.60);
    insert(&mut cards, "o1-mini", 3.00, 12.00);
    insert(&mut cards, "o1", 15.00, 60.00);
    insert(&mut cards, "o3", 10.00, 40.00);
    insert(&mut cards, "o4-mini", 1.10, 4.40);
    // --- GPT-5 family ---
    insert(&mut cards, "gpt-5", 2.50, 10.00);
    insert(&mut cards, "gpt-5-mini", 0.30, 1.20);
    insert(&mut cards, "gpt-5.1", 2.50, 10.00);
    insert(&mut cards, "gpt-5.2", 2.50, 10.00);
    insert(&mut cards, "gpt-5.4", 2.50, 10.00);
    insert(&mut cards, "gpt-5.4-mini", 0.50, 2.00);
    insert(&mut cards, "gpt-5.4-nano", 0.20, 0.80);
    insert(&mut cards, "gpt-5.5", 2.50, 10.00);
    insert(&mut cards, "gpt-5.6-sol", 3.00, 12.00);
    insert(&mut cards, "gpt-5.6-terra", 3.00, 12.00);
    insert(&mut cards, "gpt-5.6-luna", 3.00, 12.00);
    insert(&mut cards, "gpt-5-codex", 2.50, 10.00);
    insert(&mut cards, "gpt-5-codex-mini", 0.30, 1.20);
    insert(&mut cards, "gpt-5.1-codex", 2.50, 10.00);
    insert(&mut cards, "gpt-5.1-codex-mini", 0.30, 1.20);
    insert(&mut cards, "gpt-5.1-codex-max", 4.00, 16.00);
    insert(&mut cards, "gpt-5.2-codex", 2.50, 10.00);
    insert(&mut cards, "gpt-5.3-codex", 2.50, 10.00);
    insert(&mut cards, "gpt-5.3-codex-spark", 0.40, 1.60);
    insert(&mut cards, "codex-mini-latest", 0.30, 1.20);
    insert(&mut cards, "gpt-4.1", 2.00, 8.00);
    // --- Anthropic ---
    insert(&mut cards, "claude-3-haiku-20240307", 0.25, 1.25);
    insert(&mut cards, "claude-3-5-haiku-20241022", 0.80, 4.00);
    insert(&mut cards, "claude-haiku-4-5-20251001", 0.80, 4.00);
    insert(&mut cards, "claude-3-5-sonnet-20241022", 3.00, 15.00);
    insert(&mut cards, "claude-3-5-sonnet", 3.00, 15.00);
    insert(&mut cards, "claude-3-7-sonnet-20250219", 3.00, 15.00);
    insert(&mut cards, "claude-sonnet-4-20250514", 3.00, 15.00);
    insert(&mut cards, "claude-sonnet-4-5-20250929", 3.00, 15.00);
    insert(&mut cards, "claude-sonnet-4-6", 3.00, 15.00);
    insert(&mut cards, "claude-sonnet-4", 3.00, 15.00);
    insert(&mut cards, "claude-sonnet-4.5", 3.00, 15.00);
    insert(&mut cards, "claude-3-opus-20240229", 15.00, 75.00);
    insert(&mut cards, "claude-opus-4-20250514", 15.00, 75.00);
    insert(&mut cards, "claude-opus-4-1-20250805", 15.00, 75.00);
    insert(&mut cards, "claude-opus-4-5-20251101", 15.00, 75.00);
    insert(&mut cards, "claude-opus-4-6", 15.00, 75.00);
    insert(&mut cards, "claude-opus-4-7", 15.00, 75.00);
    insert(&mut cards, "claude-opus-4.5", 15.00, 75.00);
    insert(&mut cards, "claude-opus-4.6", 15.00, 75.00);
    // --- Google ---
    insert(&mut cards, "gemini-2.5-pro", 1.25, 10.00);
    insert(&mut cards, "gemini-3-flash-preview", 0.50, 2.00);
    insert(&mut cards, "gemini-3.1-pro-preview", 1.25, 10.00);
    // --- xAI ---
    insert(&mut cards, "grok-4", 3.00, 15.00);
    insert(&mut cards, "grok-4.3", 3.00, 15.00);
    insert(&mut cards, "grok-4.5", 3.00, 15.00);
    insert(&mut cards, "grok-4.6", 3.00, 15.00);
    insert(&mut cards, "grok-code-fast-1", 0.50, 2.00);
    insert(&mut cards, "grok-build-0.1", 2.00, 8.00);
    // --- DeepSeek / Qwen / Kimi / ZAI / MiniMax ---
    insert(&mut cards, "deepseek-v4-pro", 1.00, 2.00);
    insert(&mut cards, "deepseek-v4-flash", 0.30, 0.80);
    insert(&mut cards, "deepseek-v3.2", 0.80, 1.50);
    insert(&mut cards, "qwen-max", 1.20, 3.00);
    insert(&mut cards, "qwen-plus", 0.40, 1.20);
    insert(&mut cards, "qwen-turbo", 0.10, 0.30);
    insert(&mut cards, "qwen-long", 0.50, 1.50);
    insert(&mut cards, "qwen3.6-plus", 1.00, 3.00);
    insert(&mut cards, "qwen3.7-max", 1.20, 4.00);
    insert(&mut cards, "k3", 1.00, 3.00);
    insert(&mut cards, "kimi-for-coding", 1.00, 3.00);
    insert(&mut cards, "kimi-k2.5", 1.00, 3.00);
    insert(&mut cards, "kimi-k2.6", 1.00, 3.00);
    insert(&mut cards, "moonshot-v1-32k", 1.00, 3.00);
    insert(&mut cards, "moonshot-v1-8k", 0.80, 2.40);
    insert(&mut cards, "moonshot-v1-128k", 1.00, 3.00);
    insert(&mut cards, "glm-4-plus", 0.80, 2.40);
    insert(&mut cards, "glm-5", 1.00, 3.00);
    insert(&mut cards, "glm-5.3", 1.00, 3.00);
    insert(&mut cards, "glm-5.1", 1.00, 3.00);
    insert(&mut cards, "MiniMax-M2.5", 0.60, 1.80);
    insert(&mut cards, "MiniMax-M2.7", 0.60, 1.80);
    insert(&mut cards, "MiniMax-M3", 0.60, 1.80);
    insert(&mut cards, "trinity-large-thinking", 0.80, 2.40);
    insert(&mut cards, "poolside/laguna-m.1", 1.00, 3.00);
    insert(&mut cards, "nousresearch/hermes-4-70b", 0.60, 0.90);
    insert(&mut cards, "nousresearch/hermes-4-405b", 2.00, 3.00);
    // OpenRouter composite aliases (so openrouter/anthropic/... also hits)
    insert(&mut cards, "openrouter/anthropic/claude-sonnet-4", 3.00, 15.00);
    insert(&mut cards, "openrouter/anthropic/claude-opus-4", 15.00, 75.00);
    // openrouter meta Muse spark - your current subagent
    insert(&mut cards, "meta/muse-spark-1.2", 0.30, 0.90);
    insert(&mut cards, "muse-spark-1.2", 0.30, 0.90);
    insert(&mut cards, "meta/muse-spark-1.2-contributor", 0.30, 0.90);
    insert(&mut cards, "openrouter/meta/muse-spark-1.2", 0.30, 0.90);
    insert(&mut cards, "openrouter/meta/muse-spark-1.2-contributor", 0.30, 0.90);
    // Ollama / local - free, but give it 0 so it doesn't inflate
    insert(&mut cards, "llama3.1", 0.0, 0.0);
    insert(&mut cards, "qwen3:8b", 0.0, 0.0);
    cards
}

/// Look up a rate card for the given provider/model combination.
///
/// Tries in order:
/// 1. Exact model match (e.g. `"claude-3-5-sonnet-20241022"`)
/// 2. Model with date suffix stripped (e.g. `"claude-3-5-sonnet"`)
/// 3. `"provider/model"` composite key
pub fn lookup_rate<'a>(
    rate_cards: &'a HashMap<String, RateCard>,
    provider: &str,
    model: &str,
) -> Option<&'a RateCard> {
    if let Some(card) = rate_cards.get(model) {
        return Some(card);
    }

    let stripped = strip_date_suffix(model);
    if stripped != model {
        if let Some(card) = rate_cards.get(stripped) {
            return Some(card);
        }
    }

    let composite = format!("{provider}/{model}");
    rate_cards.get(&composite)
}

/// Strips a trailing date suffix like `-20241022` from a model name.
/// Returns the original string if no date suffix is found.
fn strip_date_suffix(model: &str) -> &str {
    if let Some(pos) = model.rfind('-') {
        let suffix = &model[pos + 1..];
        if suffix.len() >= 8 && suffix.chars().all(|c| c.is_ascii_digit()) {
            return &model[..pos];
        }
    }
    model
}

#[cfg(test)]
mod tests {
    use super::*;
    use zorai_shared::providers::{PROVIDER_ID_ANTHROPIC, PROVIDER_ID_OPENAI};

    #[test]
    fn cost_default_rate_cards_includes_expected_models() {
        let cards = default_rate_cards();
        assert!(cards.contains_key("gpt-4o"), "missing gpt-4o");
        assert!(cards.contains_key("gpt-4o-mini"), "missing gpt-4o-mini");
        assert!(
            cards.contains_key("claude-sonnet-4-20250514"),
            "missing claude-sonnet-4-20250514"
        );
        assert!(
            cards.contains_key("claude-3-5-sonnet-20241022"),
            "missing claude-3-5-sonnet"
        );
        assert!(
            cards.contains_key("claude-3-haiku-20240307"),
            "missing claude-3-haiku"
        );
        assert!(
            cards.contains_key("claude-3-opus-20240229"),
            "missing claude-3-opus"
        );
        assert!(cards.contains_key("o1-mini"), "missing o1-mini");
    }

    #[test]
    fn cost_lookup_rate_exact_match() {
        let cards = default_rate_cards();
        let rate = lookup_rate(&cards, PROVIDER_ID_OPENAI, "gpt-4o");
        assert!(rate.is_some());
        let r = rate.unwrap();
        assert!((r.input_per_million - 2.50).abs() < f64::EPSILON);
        assert!((r.output_per_million - 10.00).abs() < f64::EPSILON);
    }

    #[test]
    fn cost_lookup_rate_strips_date_suffix() {
        let mut cards = HashMap::new();
        cards.insert(
            "claude-3-5-sonnet".to_string(),
            RateCard {
                input_per_million: 3.0,
                output_per_million: 15.0,
            },
        );
        let rate = lookup_rate(&cards, PROVIDER_ID_ANTHROPIC, "claude-3-5-sonnet-20241022");
        assert!(rate.is_some(), "should match after stripping date suffix");
    }

    #[test]
    fn cost_lookup_rate_returns_none_for_unknown() {
        // lookup_rate itself still returns None for unknown; CostTracker
        // now falls back to FALLBACK_RATE so cost is never stuck at None.
        let cards = HashMap::new();
        let rate = lookup_rate(&cards, "unknown", "totally-fake-model");
        assert!(rate.is_none());
        // default set covers current frontend catalog, including muse
        let defaults = default_rate_cards();
        assert!(defaults.contains_key("meta/muse-spark-1.2"));
        assert!(defaults.contains_key("gpt-5.5"));
    }

    #[test]
    fn cost_strip_date_suffix_works() {
        assert_eq!(
            strip_date_suffix("claude-3-5-sonnet-20241022"),
            "claude-3-5-sonnet"
        );
        assert_eq!(strip_date_suffix("gpt-4o"), "gpt-4o");
        assert_eq!(strip_date_suffix("o1-mini"), "o1-mini");
    }
}
