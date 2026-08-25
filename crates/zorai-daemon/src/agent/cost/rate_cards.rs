//! Operator-supplied token pricing.
//!
//! Zorai has no built-in price catalog. Provider prices are volatile and may
//! depend on account tier, routing, caching, subscription, or negotiated terms.
//! A rate is used only when the operator explicitly configures it.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Explicit operator-configured pricing per one million tokens (USD).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateCard {
    pub input_per_million: f64,
    pub output_per_million: f64,
}

/// Resolve an explicitly configured rate by model, date-normalized model, or
/// provider/model key. An empty map always yields `None`.
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

/// Strips a trailing date suffix such as `-20241022` for an explicitly
/// configured family-level rate.
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

    fn card(input_per_million: f64, output_per_million: f64) -> RateCard {
        RateCard {
            input_per_million,
            output_per_million,
        }
    }

    #[test]
    fn empty_configuration_has_no_rate() {
        let cards = HashMap::new();
        assert!(lookup_rate(&cards, "openai", "gpt-anything").is_none());
    }

    #[test]
    fn resolves_explicit_model_rate() {
        let cards = HashMap::from([("model-a".to_string(), card(1.0, 2.0))]);
        let rate = lookup_rate(&cards, "provider-a", "model-a").expect("configured rate");
        assert_eq!(rate.input_per_million, 1.0);
        assert_eq!(rate.output_per_million, 2.0);
    }

    #[test]
    fn resolves_explicit_provider_model_rate() {
        let cards = HashMap::from([("provider-a/model-a".to_string(), card(3.0, 4.0))]);
        assert!(lookup_rate(&cards, "provider-a", "model-a").is_some());
        assert!(lookup_rate(&cards, "provider-b", "model-a").is_none());
    }

    #[test]
    fn resolves_explicit_date_normalized_rate() {
        let cards = HashMap::from([("model-family".to_string(), card(5.0, 6.0))]);
        assert!(lookup_rate(&cards, "provider-a", "model-family-20241022").is_some());
    }
}
