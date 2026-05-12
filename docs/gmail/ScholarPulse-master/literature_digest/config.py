from __future__ import annotations

import copy
from pathlib import Path
from typing import Any


DEFAULT_CONFIG: dict[str, Any] = {
    "gmail": {
        "query": "is:unread",
        "max_emails_per_run": 50,
        "mark_as_read": False,
        "include_spam_trash": False,
        "credentials_path": "credentials.json",
        "token_path": "token.json",
    },
    "llm": {
        "provider": "codex_cli",
        "model": "gpt-5.4-mini",
        "reasoning_effort": "low",
        "timeout_seconds": 120,
        "max_output_tokens": 4000,
        "codex_cli": {"executable": "codex", "ephemeral": True, "extra_args": []},
        "openai_compatible": {
            "base_url": "",
            "api_key_env": "OPENAI_API_KEY",
            "model": "",
            "temperature": 0.2,
            "reasoning_effort": "",
            "response_format_json": True,
            "extra_body": {},
        },
    },
    "research_interests": {
        "path": "research_interests.md",
        "refresh_each_run": True,
    },
    "filtering": {
        "skip_promotional": True,
        "audit_skipped_emails": True,
        "academic_sender_allowlist": [],
        "sender_blocklist": [],
        "promotional_keywords": [
            "sale",
            "webinar",
            "discount",
            "offer",
            "unsubscribe",
            "sponsored",
            "marketing",
        ],
    },
    "parsing": {
        "save_toc_images": True,
        "toc_image_dir": "data/toc_images",
        "max_images_per_email": 20,
        "fuzzy_title_threshold": 92,
        "llm_structure_non_scholar": True,
    },
    "digest": {
        "output_dir": "outputs",
        "output_formats": ["md", "html"],
        "include_low_relevance": True,
        "language": "zh-CN",
        "max_high_relevance": 20,
        "max_medium_relevance": 30,
    },
    "safety": {
        "dry_run_default": True,
        "never_delete_emails": True,
        "redact_secrets_in_logs": True,
        "allow_sample_without_credentials": True,
        "allow_offline_llm_for_sample": True,
    },
    "progress": {
        "enabled": True,
        "show_timestamps": True,
    },
}


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    config = copy.deepcopy(DEFAULT_CONFIG)
    config_path = Path(path) if path else Path("config.local.yaml")
    if not config_path.exists():
        return config

    try:
        import yaml
    except ImportError as exc:  # pragma: no cover - depends on user env
        raise RuntimeError(
            "PyYAML is required to read YAML config files. Install dependencies with "
            "`python -m pip install -e .` or remove config.local.yaml to use defaults."
        ) from exc

    loaded = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    if not isinstance(loaded, dict):
        raise ValueError(f"Config file must contain a mapping: {config_path}")
    config = deep_merge(config, loaded)
    return _load_external_llm_config(config, config_path.parent, yaml)


def _load_external_llm_config(config: dict[str, Any], base_dir: Path, yaml_module: Any) -> dict[str, Any]:
    config_path_value = config.get("llm", {}).get("config_path")
    if not config_path_value:
        return config

    llm_config_path = Path(config_path_value)
    if not llm_config_path.is_absolute():
        llm_config_path = base_dir / llm_config_path
    if not llm_config_path.exists():
        raise FileNotFoundError(f"LLM config file not found: {llm_config_path}")

    loaded = yaml_module.safe_load(llm_config_path.read_text(encoding="utf-8")) or {}
    if not isinstance(loaded, dict):
        raise ValueError(f"LLM config file must contain a mapping: {llm_config_path}")

    provider_config = loaded.get("llm", loaded)
    if not isinstance(provider_config, dict):
        raise ValueError(f"LLM config file must contain a mapping: {llm_config_path}")
    config["llm"] = deep_merge(config["llm"], provider_config)
    config["llm"]["config_path"] = str(config_path_value)
    return config


def resolve_path(value: str | Path, base_dir: Path | None = None) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return (base_dir or Path.cwd()) / path
