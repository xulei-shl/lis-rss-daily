from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .base import LLMError, extract_json_object


@dataclass(slots=True)
class CodexCLIClient:
    model: str
    reasoning_effort: str
    timeout_seconds: int = 120
    executable: str = "codex"
    ephemeral: bool = True
    max_output_tokens: int | None = None
    extra_args: list[str] = field(default_factory=list)

    def complete(self, prompt: str) -> str:
        executable = _resolve_executable(self.executable)
        output_file = tempfile.NamedTemporaryFile(
            prefix="literature-digest-codex-",
            suffix=".txt",
            delete=False,
        )
        output_path = Path(output_file.name)
        output_file.close()
        args = [
            executable,
            "exec",
            "--skip-git-repo-check",
            "--output-last-message",
            str(output_path),
            "-m",
            self.model,
            "-c",
            f"model_reasoning_effort={self.reasoning_effort}",
        ]
        if self.ephemeral:
            args.append("--ephemeral")
        if self.max_output_tokens:
            args.extend(["-c", f"model_max_output_tokens={self.max_output_tokens}"])
        args.extend(self.extra_args)
        args.append(prompt)
        try:
            result = subprocess.run(
                args,
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                timeout=self.timeout_seconds,
                check=False,
            )
        except FileNotFoundError as exc:
            raise LLMError(
                f"Codex CLI executable not found: {self.executable}. "
                "Set llm.codex_cli.executable to the full path of codex.cmd or codex.exe."
            ) from exc
        except OSError as exc:
            raise LLMError(f"Codex CLI could not be started: {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            _cleanup_temp_file(output_path)
            raise LLMError(f"Codex CLI timed out after {self.timeout_seconds}s") from exc

        try:
            final_message = output_path.read_text(encoding="utf-8", errors="replace").strip()
        finally:
            _cleanup_temp_file(output_path)

        stdout = result.stdout.strip() if result.stdout else ""
        stderr = result.stderr.strip() if result.stderr else ""
        if result.returncode != 0:
            detail = (stderr or stdout or final_message).strip()
            raise LLMError(f"Codex CLI failed with exit code {result.returncode}: {detail}")
        return final_message or stdout

    def complete_json(self, prompt: str) -> dict[str, Any]:
        first_response = self.complete(prompt)
        try:
            return extract_json_object(first_response)
        except LLMError as first_error:
            retry_prompt = f"""
{prompt}

Your previous response could not be parsed as JSON.
Return ONLY one valid JSON object that follows the requested schema.
Do not include Markdown fences, explanations, status text, or any text before or after the JSON object.
""".strip()
            second_response = self.complete(retry_prompt)
            try:
                return extract_json_object(second_response)
            except LLMError as second_error:
                snippet = _shorten_for_error(second_response or first_response)
                raise LLMError(
                    "Codex CLI did not return a parseable JSON object after retry. "
                    f"Response preview: {snippet}"
                ) from second_error


def _resolve_executable(executable: str) -> str:
    configured = Path(executable).expanduser()
    if configured.is_absolute() and configured.exists():
        return str(configured)

    candidates = [executable]
    if executable.lower() == "codex":
        candidates.extend(["codex.cmd", "codex.exe", "codex.ps1"])

    for candidate in candidates:
        found = shutil.which(candidate)
        if found:
            return found

    if executable.lower() == "codex" and os.name == "nt":
        appdata = os.environ.get("APPDATA")
        localappdata = os.environ.get("LOCALAPPDATA")
        userprofile = os.environ.get("USERPROFILE")
        known_paths = []
        if appdata:
            known_paths.extend([
                Path(appdata) / "npm" / "codex.cmd",
                Path(appdata) / "npm" / "codex.ps1",
            ])
        if localappdata:
            known_paths.append(Path(localappdata) / "OpenAI" / "Codex" / "bin" / "codex.cmd")
        if userprofile:
            known_paths.append(Path(userprofile) / "AppData" / "Roaming" / "npm" / "codex.cmd")
        for path in known_paths:
            if path.exists():
                return str(path)

    return executable


def _cleanup_temp_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _shorten_for_error(text: str, limit: int = 800) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[:limit] + "..."
