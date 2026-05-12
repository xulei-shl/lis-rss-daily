from __future__ import annotations

import base64
import json
import re
from html import unescape
from html.parser import HTMLParser
from typing import Any, Iterable
from urllib.parse import parse_qs, urlsplit

from .dedupe import DOI_RE, normalize_doi
from .llm import LLMClient, LLMError
from .models import EmailMessage, PaperEntry


URL_RE = re.compile(r"https?://[^\s<>)\"']+", re.IGNORECASE)
BAD_LINK_TEXT = {
    "pdf",
    "html",
    "view article",
    "read more",
    "full text",
    "unsubscribe",
    "manage alerts",
    "settings",
    "click here",
    "view online",
    "read article",
    "send feedback",
    "customize your preferences",
    "stop all emails from acs publications",
    "switch off recommended reading email alerts",
    "visit our email preference center",
}


class _AnchorExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self.images: list[str] = []
        self._href_stack: list[str] = []
        self._text_stack: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {name.lower(): value or "" for name, value in attrs}
        if tag.lower() == "a":
            self._href_stack.append(attrs_dict.get("href", ""))
            self._text_stack.append([])
        elif tag.lower() == "img":
            src = attrs_dict.get("src", "")
            if src:
                self.images.append(src)

    def handle_data(self, data: str) -> None:
        if self._text_stack:
            self._text_stack[-1].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or not self._href_stack:
            return
        href = self._href_stack.pop()
        pieces = self._text_stack.pop()
        text = normalize_space(" ".join(pieces))
        if href and text:
            self.links.append((href, text))


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"style", "script", "noscript"}:
            self._ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"style", "script", "noscript"} and self._ignored_depth:
            self._ignored_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth and data.strip():
            self.parts.append(data.strip())


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", unescape(value or "")).strip()


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html or "")
    return normalize_space("\n".join(parser.parts))


def parse_emails(
    emails: Iterable[EmailMessage],
    *,
    llm: LLMClient | None = None,
    llm_structure_non_scholar: bool = False,
) -> list[PaperEntry]:
    entries: list[PaperEntry] = []
    for email in emails:
        if llm_structure_non_scholar and llm is not None and not _is_google_scholar_email(email):
            structured = _parse_non_scholar_email_with_llm(email, llm)
            if structured:
                entries.extend(structured)
                continue
        entries.extend(parse_email(email))
    return entries


def parse_email(email: EmailMessage) -> list[PaperEntry]:
    if email.html:
        entries = _parse_html_email(email)
    else:
        entries = []
    if email.text and not entries:
        entries.extend(_parse_text_email(email))
    elif not email.html and email.snippet:
        entries.extend(_parse_text_email(email))
    return _dedupe_within_email(entries)


def _parse_html_email(email: EmailMessage) -> list[PaperEntry]:
    extractor = _AnchorExtractor()
    extractor.feed(email.html)
    text = html_to_text(email.html)
    entries: list[PaperEntry] = []
    google_scholar = _is_google_scholar_email(email)
    image_refs = [] if google_scholar else _select_entry_images(
        list(email.image_paths) + list(extractor.images)
    )
    image_refs_by_doi = _images_by_doi(image_refs)

    for href, link_text in extractor.links:
        title = normalize_space(link_text)
        if not _is_likely_title(title, href):
            continue
        raw = _snippet_around(text, title)
        cleaned_url = _clean_url(href)
        doi = _extract_doi(cleaned_url + " " + raw)
        entries.append(
            PaperEntry(
                title=title,
                url=cleaned_url,
                abstract=raw,
                doi=doi,
                venue=_extract_venue(raw, title),
                source_email_id=email.id,
                source_subject=email.subject,
                source_sender=email.sender,
                image_paths=image_refs_by_doi.get(doi, image_refs[:1]),
                raw_text=raw,
            )
        )
    return entries


def _parse_non_scholar_email_with_llm(email: EmailMessage, llm: LLMClient) -> list[PaperEntry]:
    if not (email.html or email.text or email.snippet):
        return []
    extractor = _AnchorExtractor()
    extractor.feed(email.html or "")
    text = html_to_text(email.html) if email.html else normalize_space(email.text or email.snippet)
    links = _candidate_links_for_llm(extractor.links)
    images = _candidate_images_for_llm(list(email.image_paths) + list(extractor.images))
    if not links and not text:
        return []

    prompt = f"""
EMAIL_PAPER_EXTRACTION_JSON

Extract academic paper entries from a publisher, journal, newsletter, or RSS-style academic email.
Return one valid JSON object only. Do not include Markdown or explanations.

Keep only real paper/article entries. Exclude navigation links, preference-center links, unsubscribe links, feedback links, social links, logos, ads, and generic buttons.

Schema:
{{
  "papers": [
    {{
      "title": "English paper title",
      "url": "https://paper-url",
      "doi": "10.xxxx/xxxxx",
      "venue": "Journal name",
      "authors": "Author list if available",
      "snippet": "Short source snippet if available",
      "image_index": 0
    }}
  ]
}}

Rules:
- `title` must be a specific academic paper/article title.
- `url` should point to the paper landing page or DOI page when available.
- `doi` should be empty if not present.
- `venue` should be journal/source name if visible.
- `image_index` should be the matching image index from CANDIDATE_IMAGES, or null if no useful article image exists.
- Do not include email management links or feedback/preference/unsubscribe entries.

EMAIL_SUBJECT:
{email.subject}

EMAIL_SENDER:
{email.sender}

CANDIDATE_LINKS_JSON:
{json.dumps(links[:80], ensure_ascii=False)}

CANDIDATE_IMAGES_JSON:
{json.dumps(images[:40], ensure_ascii=False)}

EMAIL_TEXT:
{text[:9000]}
""".strip()
    try:
        payload = llm.complete_json(prompt)
    except LLMError:
        return []
    return _paper_entries_from_llm_payload(payload, email, images)


def _parse_text_email(email: EmailMessage) -> list[PaperEntry]:
    text = email.text or email.snippet
    if not text:
        return []
    urls = URL_RE.findall(text)
    dois = DOI_RE.findall(text)
    candidates = _title_candidates_from_text(text)
    entries: list[PaperEntry] = []

    for idx, title in enumerate(candidates[:12]):
        url = urls[idx] if idx < len(urls) else (urls[0] if len(candidates) == 1 and urls else "")
        doi = dois[idx] if idx < len(dois) else (dois[0] if len(candidates) == 1 and dois else "")
        entries.append(
            PaperEntry(
                title=title,
                url=_clean_url(url),
                abstract=_snippet_around(text, title),
                doi=_extract_doi(doi),
                venue=_extract_venue(text, title),
                source_email_id=email.id,
                source_subject=email.subject,
                source_sender=email.sender,
                image_paths=list(email.image_paths),
                raw_text=text[:2000],
            )
        )
    return entries


def _candidate_links_for_llm(links: list[tuple[str, str]]) -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []
    for href, link_text in links:
        title = normalize_space(link_text)
        cleaned_url = _clean_url(href)
        if not title or not cleaned_url:
            continue
        if _is_obvious_non_paper_link(title, cleaned_url):
            continue
        candidates.append({"text": title, "url": cleaned_url})
    return candidates


def _candidate_images_for_llm(images: list[object]) -> list[dict[str, str | int]]:
    candidates: list[dict[str, str | int]] = []
    for image in images:
        src = str(image)
        if not _is_useful_image_src(src):
            continue
        candidates.append({"index": len(candidates), "url": src})
    return candidates


def _images_by_doi(images: list[object]) -> dict[str, list[object]]:
    result: dict[str, list[object]] = {}
    for image in images:
        doi = _extract_doi(str(image))
        if doi:
            result.setdefault(doi, []).append(image)
    return result


def _paper_entries_from_llm_payload(
    payload: dict[str, Any],
    email: EmailMessage,
    images: list[dict[str, str | int]],
) -> list[PaperEntry]:
    entries: list[PaperEntry] = []
    image_by_index = {int(item["index"]): str(item["url"]) for item in images if "index" in item and "url" in item}
    for item in payload.get("papers", []):
        if not isinstance(item, dict):
            continue
        title = normalize_space(str(item.get("title", "")))
        url = _clean_url(str(item.get("url", "")))
        if not _is_likely_title(title, url):
            continue
        if _is_obvious_non_paper_link(title, url):
            continue
        image_paths: list[str] = []
        image_index = item.get("image_index")
        try:
            if image_index is not None and int(image_index) in image_by_index:
                image_paths.append(image_by_index[int(image_index)])
        except (TypeError, ValueError):
            pass
        snippet = normalize_space(str(item.get("snippet", "")))
        doi = _extract_doi(str(item.get("doi", "")) or url or snippet)
        entries.append(
            PaperEntry(
                title=title,
                url=url,
                authors=normalize_space(str(item.get("authors", ""))),
                venue=normalize_space(str(item.get("venue", ""))),
                abstract=snippet,
                doi=doi,
                source_email_id=email.id,
                source_subject=email.subject,
                source_sender=email.sender,
                image_paths=image_paths,
                raw_text=snippet,
            )
        )
    return entries


def _title_candidates_from_text(text: str) -> list[str]:
    candidates: list[str] = []
    for raw_line in text.splitlines():
        line = normalize_space(raw_line)
        if not _is_likely_title(line, ""):
            continue
        candidates.append(line)
    if candidates:
        return candidates

    sentences = re.split(r"(?<=[.!?])\s+", normalize_space(text))
    return [sentence for sentence in sentences if _is_likely_title(sentence, "")][:8]


def _is_likely_title(text: str, href: str) -> bool:
    normalized = normalize_space(text)
    lower = normalized.lower()
    if len(normalized) < 16 or len(normalized) > 260:
        return False
    if lower in BAD_LINK_TEXT:
        return False
    if _is_obvious_non_paper_link(normalized, href):
        return False
    href_lower = href.lower()
    if any(token in href_lower for token in ("scholar_alerts", "citations?", "view_op=cancel_alert")):
        return False
    if "scholar.google." in href_lower and "scholar_url" not in href_lower:
        return False
    if lower.startswith("[") and lower.endswith("]") and "scholar.google." in href_lower:
        return False
    if lower.startswith(("http://", "https://", "doi:")):
        return False
    if href_lower.startswith(("mailto:", "#")):
        return False
    word_count = len(re.findall(r"[A-Za-z0-9\u4e00-\u9fff]+", normalized))
    return word_count >= 3


def _snippet_around(text: str, title: str, radius: int = 500) -> str:
    collapsed = normalize_space(text)
    idx = collapsed.lower().find(title.lower())
    if idx == -1:
        return collapsed[:radius]
    start = max(0, idx - radius // 3)
    end = min(len(collapsed), idx + len(title) + radius)
    return collapsed[start:end]


def _clean_url(url: str) -> str:
    cleaned = unescape(url or "").rstrip(".,;)\"'")
    split = urlsplit(cleaned)
    if split.netloc.endswith("scholar.google.com") and split.path.endswith("/scholar_url"):
        target = parse_qs(split.query).get("url", [""])[0]
        if target:
            return target
    query = parse_qs(split.query)
    target = query.get("elqTarget", [""])[0]
    decoded = _decode_tracking_target(target)
    if decoded:
        return decoded
    return cleaned


def _decode_tracking_target(value: str) -> str:
    if not value:
        return ""
    for trim in range(0, min(4, len(value))):
        candidate = value[: len(value) - trim] if trim else value
        padded = candidate + "=" * (-len(candidate) % 4)
        for decoder in (base64.urlsafe_b64decode, base64.b64decode):
            try:
                decoded = decoder(padded.encode("ascii")).decode("utf-8", errors="replace")
            except Exception:
                continue
            if decoded.startswith(("http://", "https://")):
                return decoded
    return ""


def _extract_doi(value: str) -> str:
    split = urlsplit(value or "")
    path = split.path
    for marker in ("/doi/", "/cms/"):
        if marker not in path:
            continue
        tail = path.split(marker, 1)[1].strip("/")
        pieces = tail.split("/")
        if len(pieces) >= 2 and pieces[0].startswith("10."):
            return f"{pieces[0]}/{pieces[1]}".lower().rstrip(".,;)")
    doi = normalize_doi(value)
    for marker in ("/asset", "/images", "/medium", "/full"):
        if marker in doi:
            doi = doi.split(marker, 1)[0]
    return doi


def _extract_venue(text: str, title: str) -> str:
    compact = normalize_space(text)
    title_index = compact.lower().find(title.lower())
    if title_index != -1:
        compact = compact[title_index + len(title) :]
    window = compact[:500]
    patterns = [
        r"\s-\s(?P<venue>[^,。…]+(?:,\s*\d{4})?)",
        r"\.\s*(?P<venue>[A-Z][A-Za-z&:\- ]+(?:,\s*\d{4}))",
    ]
    for pattern in patterns:
        match = re.search(pattern, window)
        if not match:
            continue
        venue = normalize_space(match.group("venue"))
        venue = venue.strip(" .;:-")
        if _is_valid_venue(venue):
            return venue
    return ""


def _is_valid_venue(value: str) -> bool:
    lower = value.lower()
    if not value or len(value) > 120:
        return False
    if any(token in lower for token in ("google scholar", "this message", "cancel alert", "unsubscribe")):
        return False
    if not re.search(r"[A-Za-z]", value):
        return False
    return True


def _is_useful_image_src(src: str) -> bool:
    lower = str(src).lower().strip()
    if not lower:
        return False
    blocked_tokens = (
        "spacer",
        "tracking",
        "pixel",
        "logo",
        "icon",
        "save-",
        "tw-",
        "twitter",
        "facebook",
        "linkedin",
        "/intl/",
        "/scholar/images/",
        "share",
        "social",
        "avatar",
        "profile",
        "open_in_new",
        "footerimage",
        "footerimages",
        "/footerimages/",
        "/e/footerimages/",
        "eloquaimages",
        "arrow",
    )
    if any(token in lower for token in blocked_tokens):
        return False
    return lower.startswith(("http://", "https://", "data/", "data:image", "./", "../")) or "." in lower


def _is_obvious_non_paper_link(text: str, href: str) -> bool:
    lower = normalize_space(text).lower()
    href_lower = (href or "").lower()
    blocked_text_tokens = (
        "unsubscribe",
        "privacy policy",
        "manage alert",
        "view online",
        "send feedback",
        "preference center",
        "preferences",
        "customize your preferences",
        "switch off",
        "stop all emails",
        "follow us",
        "read article",
    )
    blocked_href_tokens = (
        "unsubscribe",
        "preferences.",
        "preference",
        "privacy",
        "email_marketing_footer",
        "footer_unfollow",
        "viewonline",
    )
    return any(token in lower for token in blocked_text_tokens) or any(
        token in href_lower for token in blocked_href_tokens
    )


def _select_entry_images(images: list[object]) -> list[object]:
    useful = [image for image in images if _is_useful_image_src(str(image))]
    return useful[:20]


def _is_google_scholar_email(email: EmailMessage) -> bool:
    searchable = " ".join([email.sender, email.subject, email.html[:2000], email.text[:1000]]).lower()
    return (
        "scholaralerts-noreply@google.com" in searchable
        or "google scholar" in searchable
        or "google 学术" in searchable
        or "google 學術" in searchable
        or "scholar.google." in searchable
    )


def _dedupe_within_email(entries: list[PaperEntry]) -> list[PaperEntry]:
    seen: set[tuple[str, str]] = set()
    result: list[PaperEntry] = []
    for entry in entries:
        key = (entry.title.lower(), entry.url.lower())
        if key in seen:
            continue
        seen.add(key)
        result.append(entry)
    return result
