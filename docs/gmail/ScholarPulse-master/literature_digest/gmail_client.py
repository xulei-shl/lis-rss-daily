from __future__ import annotations

import base64
import re
from datetime import datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

from .models import EmailMessage


GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]


class GmailDependencyError(RuntimeError):
    pass


class GmailClient:
    def __init__(self, config: dict[str, Any], *, base_dir: Path | None = None) -> None:
        self.config = config
        self.base_dir = base_dir or Path.cwd()
        self.gmail_config = config["gmail"]
        self.parsing_config = config["parsing"]
        self._service = None

    @property
    def credentials_path(self) -> Path:
        return self._resolve(self.gmail_config.get("credentials_path", "credentials.json"))

    @property
    def token_path(self) -> Path:
        return self._resolve(self.gmail_config.get("token_path", "token.json"))

    def fetch_unread_emails(self, *, max_results: int | None = None) -> list[EmailMessage]:
        service = self._get_service()
        query = self.gmail_config.get("query", "is:unread")
        limit = max_results or int(self.gmail_config.get("max_emails_per_run", 50))
        include_spam_trash = bool(self.gmail_config.get("include_spam_trash", False))
        response = (
            service.users()
            .messages()
            .list(
                userId="me",
                q=query,
                maxResults=limit,
                includeSpamTrash=include_spam_trash,
            )
            .execute()
        )
        messages = response.get("messages", [])
        return [self.fetch_email(message["id"]) for message in messages]

    def fetch_email(self, message_id: str) -> EmailMessage:
        service = self._get_service()
        message = (
            service.users()
            .messages()
            .get(userId="me", id=message_id, format="full")
            .execute()
        )
        headers = {
            header["name"].lower(): header.get("value", "")
            for header in message.get("payload", {}).get("headers", [])
        }
        html_parts: list[str] = []
        text_parts: list[str] = []
        image_paths: list[Path] = []
        cid_map: dict[str, Path] = {}
        save_images = not _is_google_scholar_headers(
            headers.get("from", ""),
            headers.get("subject", ""),
        )
        self._walk_parts(
            message_id=message_id,
            part=message.get("payload", {}),
            html_parts=html_parts,
            text_parts=text_parts,
            image_paths=image_paths,
            cid_map=cid_map,
            save_images=save_images,
        )
        html = "\n".join(html_parts)
        for cid, path in cid_map.items():
            html = html.replace(f"cid:{cid}", str(path))
            html = html.replace(f"cid:<{cid}>", str(path))
        return EmailMessage(
            id=message_id,
            thread_id=message.get("threadId", ""),
            subject=headers.get("subject", ""),
            sender=headers.get("from", ""),
            date=_parse_email_date(headers.get("date", "")),
            html=html,
            text="\n".join(text_parts),
            snippet=message.get("snippet", ""),
            labels=list(message.get("labelIds", [])),
            image_paths=image_paths,
        )

    def mark_as_read(self, message_ids: list[str]) -> None:
        if not message_ids:
            return
        service = self._get_service()
        for message_id in message_ids:
            service.users().messages().modify(
                userId="me",
                id=message_id,
                body={"removeLabelIds": ["UNREAD"]},
            ).execute()

    def _get_service(self):
        if self._service is not None:
            return self._service
        try:
            from google.auth.transport.requests import Request
            from google.oauth2.credentials import Credentials
            from google_auth_oauthlib.flow import InstalledAppFlow
            from googleapiclient.discovery import build
        except ImportError as exc:  # pragma: no cover - depends on user env
            raise GmailDependencyError(
                "Google Gmail dependencies are missing. Install with `python -m pip install -e .`."
            ) from exc

        creds = None
        if self.token_path.exists():
            creds = Credentials.from_authorized_user_file(str(self.token_path), GMAIL_SCOPES)
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                if not self.credentials_path.exists():
                    raise FileNotFoundError(f"Gmail credentials not found: {self.credentials_path}")
                flow = InstalledAppFlow.from_client_secrets_file(str(self.credentials_path), GMAIL_SCOPES)
                creds = flow.run_local_server(port=0)
            self.token_path.write_text(creds.to_json(), encoding="utf-8")
        self._service = build("gmail", "v1", credentials=creds)
        return self._service

    def _walk_parts(
        self,
        *,
        message_id: str,
        part: dict[str, Any],
        html_parts: list[str],
        text_parts: list[str],
        image_paths: list[Path],
        cid_map: dict[str, Path],
        save_images: bool,
    ) -> None:
        mime_type = part.get("mimeType", "")
        filename = part.get("filename", "")
        body = part.get("body", {})
        headers = {
            header["name"].lower(): header.get("value", "")
            for header in part.get("headers", [])
        }

        if "parts" in part:
            for child in part["parts"]:
                self._walk_parts(
                    message_id=message_id,
                    part=child,
                    html_parts=html_parts,
                    text_parts=text_parts,
                    image_paths=image_paths,
                    cid_map=cid_map,
                    save_images=save_images,
                )
            return

        if mime_type == "text/html":
            html_parts.append(_decode_body_data(body.get("data", "")))
        elif mime_type == "text/plain":
            text_parts.append(_decode_body_data(body.get("data", "")))
        elif save_images and mime_type.startswith("image/") and self.parsing_config.get("save_toc_images", True):
            if not _is_likely_toc_image(filename, headers):
                return
            if len(image_paths) >= int(self.parsing_config.get("max_images_per_email", 20)):
                return
            data = self._read_part_bytes(message_id, body)
            if not data:
                return
            suffix = _image_suffix(mime_type, filename)
            safe_name = _safe_filename(filename) or f"{message_id}_{len(image_paths) + 1}{suffix}"
            target_dir = self._image_dir()
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / safe_name
            target.write_bytes(data)
            image_paths.append(target)
            content_id = headers.get("content-id", "").strip("<>")
            if content_id:
                cid_map[content_id] = target

    def _read_part_bytes(self, message_id: str, body: dict[str, Any]) -> bytes:
        if body.get("data"):
            return _decode_body_bytes(body["data"])
        attachment_id = body.get("attachmentId")
        if not attachment_id:
            return b""
        service = self._get_service()
        attachment = (
            service.users()
            .messages()
            .attachments()
            .get(userId="me", messageId=message_id, id=attachment_id)
            .execute()
        )
        return _decode_body_bytes(attachment.get("data", ""))

    def _image_dir(self) -> Path:
        root = self._resolve(self.parsing_config.get("toc_image_dir", "data/toc_images"))
        return root / datetime.now().strftime("%Y-%m-%d")

    def _resolve(self, value: str | Path) -> Path:
        path = Path(value)
        if path.is_absolute():
            return path
        return self.base_dir / path


def _decode_body_data(value: str) -> str:
    return _decode_body_bytes(value).decode("utf-8", errors="replace")


def _decode_body_bytes(value: str) -> bytes:
    if not value:
        return b""
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _parse_email_date(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value or "").strip("._")
    return cleaned[:120]


def _image_suffix(mime_type: str, filename: str) -> str:
    if "." in filename:
        return ""
    return {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
    }.get(mime_type.lower(), ".img")


def _is_google_scholar_headers(sender: str, subject: str) -> bool:
    searchable = f"{sender} {subject}".lower()
    return (
        "scholaralerts-noreply@google.com" in searchable
        or "google scholar" in searchable
        or "google 学术" in searchable
        or "google 學術" in searchable
    )


def _is_likely_toc_image(filename: str, headers: dict[str, str]) -> bool:
    searchable = " ".join([filename, headers.get("content-id", ""), headers.get("content-description", "")]).lower()
    blocked = (
        "logo",
        "icon",
        "social",
        "twitter",
        "facebook",
        "linkedin",
        "tracking",
        "pixel",
        "spacer",
        "avatar",
        "profile",
    )
    if any(token in searchable for token in blocked):
        return False
    if any(token in searchable for token in ("toc", "graphical", "abstract", "figure", "image", "ga", "scheme")):
        return True
    return not filename
