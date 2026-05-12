from __future__ import annotations

from typing import Any

from .base import LLMError
from .codex_cli import CodexCLIClient
from .offline_stub import OfflineStubClient
from .openai_compatible import OpenAICompatibleClient


def build_llm_client(config: dict[str, Any], *, sample_mode: bool = False):
    llm_config = config["llm"]
    provider = llm_config.get("provider", "codex_cli")
    if sample_mode and config["safety"].get("allow_offline_llm_for_sample", False):
        return OfflineStubClient()
    if provider == "codex_cli":
        codex_config = llm_config.get("codex_cli", {})
        return CodexCLIClient(
            model=llm_config["model"],
            reasoning_effort=llm_config["reasoning_effort"],
            timeout_seconds=int(llm_config.get("timeout_seconds", 120)),
            executable=codex_config.get("executable", "codex"),
            ephemeral=bool(codex_config.get("ephemeral", True)),
            max_output_tokens=llm_config.get("max_output_tokens"),
            extra_args=list(codex_config.get("extra_args", [])),
        )
    if provider == "openai_compatible":
        api_config = llm_config.get("openai_compatible", {})
        return OpenAICompatibleClient(
            base_url=api_config.get("base_url", ""),
            api_key_env=api_config.get("api_key_env", "OPENAI_API_KEY"),
            model=api_config.get("model") or llm_config.get("model", ""),
            timeout_seconds=int(llm_config.get("timeout_seconds", 120)),
            max_output_tokens=llm_config.get("max_output_tokens"),
            temperature=api_config.get("temperature", 0.2),
            reasoning_effort=api_config.get("reasoning_effort", ""),
            response_format_json=bool(api_config.get("response_format_json", True)),
            extra_body=dict(api_config.get("extra_body", {})),
        )
    if provider == "offline_stub":
        return OfflineStubClient()
    raise LLMError(f"Unsupported LLM provider: {provider}")
