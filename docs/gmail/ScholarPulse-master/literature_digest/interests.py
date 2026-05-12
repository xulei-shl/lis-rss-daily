from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .llm import LLMClient, LLMError
from .models import InterestProfile


def read_research_interests(path: str | Path) -> str:
    interests_path = Path(path)
    if not interests_path.exists():
        raise FileNotFoundError(f"Research interests file not found: {interests_path}")
    return interests_path.read_text(encoding="utf-8").strip()


def analyze_research_interests(text: str, llm: LLMClient) -> InterestProfile:
    prompt = f"""
INTEREST_PROFILE_JSON

Read the research-interest note below and return STRICT JSON only.

Schema:
{{
  "current_projects": ["..."],
  "material_systems": ["..."],
  "methods": ["..."],
  "properties": ["..."],
  "high_priority_topics": ["..."],
  "medium_priority_topics": ["..."],
  "deprioritized_topics": ["..."],
  "summary_zh": "..."
}}

Rules:
- Return only a single JSON object. No markdown fences, no commentary.
- Keep values concise and specific.
- `summary_zh` should be a short Chinese summary of the research interests.
- Put the strongest matching topics into `high_priority_topics`.
- Put related but weaker topics into `medium_priority_topics`.
- Put clearly out-of-scope topics into `deprioritized_topics`.
- If the note is brief or ambiguous, infer a compact profile that is still useful for ranking.

Research-interest note:
{text}
""".strip()
    try:
        payload = llm.complete_json(prompt)
    except LLMError:
        return fallback_interest_profile(text)
    return profile_from_payload(payload)


def fallback_interest_profile(text: str) -> InterestProfile:
    """Create a lightweight profile without calling an LLM."""

    summary = re.sub(r"\s+", " ", text).strip()
    if len(summary) > 220:
        summary = summary[:220].rstrip() + "..."
    topics = _extract_topic_phrases(text)
    payload = {
        "current_projects": [summary] if summary else [],
        "material_systems": _terms_present(
            text,
            [
                "COF",
                "MOF",
                "HOF",
                "pentagonal",
                "pentagon",
                "framework",
                "porous",
            ],
        ),
        "methods": _terms_present(text, ["machine learning", "MLIP", "neural network", "phonon"]),
        "properties": _terms_present(text, ["thermal conductivity", "phonon", "heat transport", "diffusivity"]),
        "high_priority_topics": topics,
        "medium_priority_topics": [],
        "deprioritized_topics": [],
        "summary_zh": summary or "研究兴趣摘要为空，使用默认回退配置。",
    }
    return profile_from_payload(payload)


def profile_from_payload(payload: dict[str, Any]) -> InterestProfile:
    return InterestProfile(
        current_projects=_string_list(payload.get("current_projects")),
        material_systems=_string_list(payload.get("material_systems")),
        methods=_string_list(payload.get("methods")),
        properties=_string_list(payload.get("properties")),
        high_priority_topics=_string_list(payload.get("high_priority_topics")),
        medium_priority_topics=_string_list(payload.get("medium_priority_topics")),
        deprioritized_topics=_string_list(payload.get("deprioritized_topics")),
        summary_zh=str(payload.get("summary_zh", "")).strip(),
        raw=payload,
    )


def profile_to_json(profile: InterestProfile) -> str:
    return json.dumps(
        profile.raw
        or {
            "current_projects": profile.current_projects,
            "material_systems": profile.material_systems,
            "methods": profile.methods,
            "properties": profile.properties,
            "high_priority_topics": profile.high_priority_topics,
            "medium_priority_topics": profile.medium_priority_topics,
            "deprioritized_topics": profile.deprioritized_topics,
            "summary_zh": profile.summary_zh,
        },
        ensure_ascii=False,
        indent=2,
    )


def _extract_topic_phrases(text: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", text)
    parts = re.split(r"[;,\n/\\]+", normalized)
    topics = [part.strip(" .:") for part in parts if 4 <= len(part.strip()) <= 60]
    return topics[:8]


def _terms_present(text: str, terms: list[str]) -> list[str]:
    lower_text = text.lower()
    result: list[str] = []
    for term in terms:
        if term.lower() in lower_text:
            result.append(term)
    return result


def _string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []
