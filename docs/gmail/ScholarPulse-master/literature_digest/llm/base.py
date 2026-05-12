from __future__ import annotations

import json
import re
from typing import Any, Protocol


class LLMError(RuntimeError):
    pass


class LLMClient(Protocol):
    def complete(self, prompt: str) -> str:
        ...

    def complete_json(self, prompt: str) -> dict[str, Any]:
        ...


def redact_secrets(text: str) -> str:
    redacted = re.sub(r"sk-[A-Za-z0-9_-]{8,}", "sk-***REDACTED***", text)
    redacted = re.sub(
        r"(?i)(api[_-]?key[\"'\s:=]+)[A-Za-z0-9_\-\.]{12,}",
        r"\1***REDACTED***",
        redacted,
    )
    return redacted


def extract_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if fenced:
        return json.loads(fenced.group(1))

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start : end + 1])
    raise LLMError("LLM response did not contain a JSON object.")
