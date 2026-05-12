from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from .base import extract_json_object


@dataclass(slots=True)
class OfflineStubClient:
    """Deterministic fallback for tests and no-credential sample dry-runs only."""

    def complete(self, prompt: str) -> str:
        if "INTEREST_PROFILE_JSON" in prompt:
            return json.dumps(
                {
                    "current_projects": [
                        "computational materials science",
                        "AI for materials",
                    ],
                    "material_systems": ["COF", "MOF", "pentagonal materials"],
                    "methods": ["machine-learning interatomic potentials", "phonons", "thermal transport"],
                    "properties": ["thermal conductivity", "phonon transport"],
                    "high_priority_topics": [
                        "pentagonal materials",
                        "COF/MOF",
                        "machine-learning interatomic potentials",
                        "thermal transport",
                    ],
                    "medium_priority_topics": ["AI for materials", "materials informatics"],
                    "deprioritized_topics": ["unrelated organic synthesis"],
                    "summary_zh": "当前研究聚焦于计算材料科学、AI for materials、COF/MOF、五边形材料、机器学习原子间势以及热输运。",
                },
                ensure_ascii=False,
            )
        if "RANK_PAPERS_JSON" in prompt:
            papers = _extract_papers(prompt)
            ranked = []
            for item in papers:
                text = f"{item.get('title', '')} {item.get('abstract', '')}".lower()
                score = 0.25
                if any(term in text for term in ["pentagonal", "penta", "cof", "mof"]):
                    score += 0.35
                if any(term in text for term in ["thermal", "phonon", "conductivity"]):
                    score += 0.25
                if any(term in text for term in ["machine learning", "interatomic potential", "nep"]):
                    score += 0.2
                relevance = "high" if score >= 0.75 else "medium" if score >= 0.45 else "low"
                ranked.append(
                    {
                        "index": item["index"],
                        "relevance": relevance,
                        "score": round(min(score, 1.0), 2),
                        "title_zh": f"论文：{item.get('title', '')}",
                        "summary_zh": "这是本地离线 stub 生成的中文摘要，用于测试和 dry-run。",
                        "reason_zh": "这是本地离线 stub 生成的中文推荐理由，用于测试和 dry-run。",
                        "matched_topics": ["pentagonal materials", "COF/MOF"] if relevance != "low" else [],
                    }
                )
            return json.dumps({"papers": ranked}, ensure_ascii=False)
        return "{}"

    def complete_json(self, prompt: str) -> dict[str, Any]:
        return extract_json_object(self.complete(prompt))


def _extract_papers(prompt: str) -> list[dict[str, Any]]:
    marker = "PAPERS_JSON:"
    start = prompt.find(marker)
    if start == -1:
        return []
    raw = prompt[start + len(marker) :].strip()
    match = re.search(r"(\[.*\])", raw, flags=re.DOTALL)
    if not match:
        return []
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []
