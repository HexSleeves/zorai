use anyhow::Result;

/// Attempt to repair malformed JSON from LLM output using the jsonrepair crate.
pub(crate) fn repair_json(raw: &str) -> String {
    jsonrepair::repair_json(raw, &jsonrepair::Options::default())
        .unwrap_or_else(|_| raw.to_string())
}

/// JSON schema for structured output - forces the API to produce valid GoalPlanResponse.
#[cfg(test)]
pub(crate) fn goal_plan_json_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "title": { "type": "string" },
            "summary": { "type": "string" },
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string" },
                        "instructions": { "type": "string" },
                        "kind": { "type": "string", "enum": ["reason", "command", "research", "memory", "skill", "divergent", "debate"] },
                        "success_criteria": { "type": "string" },
                        "execution_binding": { "type": ["string", "null"] },
                        "verification_binding": { "type": ["string", "null"] },
                        "proof_checks": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": { "type": "string" },
                                    "title": { "type": "string" },
                                    "summary": { "type": ["string", "null"] }
                                },
                                "required": ["id", "title", "summary"],
                                "additionalProperties": false
                            }
                        },
                        "session_id": { "type": ["string", "null"] },
                        "llm_confidence": { "type": ["string", "null"] },
                        "llm_confidence_rationale": { "type": ["string", "null"] }
                    },
                    "required": [
                        "title",
                        "instructions",
                        "kind",
                        "success_criteria",
                        "execution_binding",
                        "verification_binding",
                        "proof_checks",
                        "session_id",
                        "llm_confidence",
                        "llm_confidence_rationale"
                    ],
                    "additionalProperties": false
                }
            },
            "rejected_alternatives": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Alternative approaches you considered but rejected, each with a brief reason. Keep the list short."
            }
        },
        "required": ["title", "summary", "steps", "rejected_alternatives"],
        "additionalProperties": false
    })
}

pub(crate) fn parse_json_block<T: serde::de::DeserializeOwned>(raw: &str) -> Result<T> {
    let trimmed = raw.trim();
    if let Ok(parsed) = serde_json::from_str::<T>(trimmed) {
        return Ok(parsed);
    }

    let without_fence = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .map(str::trim)
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(trimmed);

    if let Ok(parsed) = serde_json::from_str::<T>(without_fence) {
        return Ok(parsed);
    }

    let object_candidate = without_fence
        .find('{')
        .zip(without_fence.rfind('}'))
        .and_then(|(start, end)| (start < end).then_some(&without_fence[start..=end]));
    if let Some(candidate) = object_candidate {
        if let Ok(parsed) = serde_json::from_str::<T>(candidate) {
            return Ok(parsed);
        }
    }

    if let Some(candidate) = object_candidate {
        if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(candidate) {
            if let Some(inner) = wrapper.get("answer").and_then(|v| v.as_str()) {
                if let Ok(parsed) = serde_json::from_str::<T>(inner) {
                    tracing::info!("parsed JSON after unwrapping answer wrapper");
                    return Ok(parsed);
                }
                let inner_repaired = repair_json(inner);
                if let Ok(parsed) = serde_json::from_str::<T>(&inner_repaired) {
                    tracing::info!("parsed JSON after unwrapping + repairing answer wrapper");
                    return Ok(parsed);
                }
            }
        }
    }

    let repaired = repair_json(without_fence);
    if let Ok(parsed) = serde_json::from_str::<T>(&repaired) {
        tracing::info!("parsed JSON after jsonrepair");
        return Ok(parsed);
    }

    tracing::warn!(raw_len = raw.len(), raw_output = %raw, "failed to parse structured JSON from model output");
    anyhow::bail!("failed to parse structured JSON from model output")
}
