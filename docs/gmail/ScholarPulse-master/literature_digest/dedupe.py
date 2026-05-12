from __future__ import annotations

import re
from html import unescape
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .models import DeduplicationResult, PaperEntry


DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", re.IGNORECASE)
DROP_QUERY_PREFIXES = ("utm_",)
DROP_QUERY_KEYS = {"fbclid", "gclid", "cmpid", "cid", "ref", "source"}


def normalize_doi(value: str) -> str:
    match = DOI_RE.search(value or "")
    if not match:
        return ""
    return match.group(0).rstrip(".,;)").lower()


def canonicalize_url(url: str) -> str:
    if not url:
        return ""
    split = urlsplit(url.strip())
    if not split.scheme and not split.netloc:
        return url.strip().lower().rstrip("/")
    query = []
    for key, value in parse_qsl(split.query, keep_blank_values=True):
        lower_key = key.lower()
        if lower_key in DROP_QUERY_KEYS or lower_key.startswith(DROP_QUERY_PREFIXES):
            continue
        query.append((key, value))
    return urlunsplit(
        (
            split.scheme.lower(),
            split.netloc.lower(),
            split.path.rstrip("/"),
            urlencode(query, doseq=True),
            "",
        )
    )


def normalize_title(title: str) -> str:
    text = unescape(title or "").casefold()
    text = re.sub(r"[\W_]+", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def title_similarity(left: str, right: str) -> float:
    try:
        from rapidfuzz import fuzz

        return float(fuzz.token_set_ratio(left, right))
    except ImportError:
        from difflib import SequenceMatcher

        left_tokens = set(left.split())
        right_tokens = set(right.split())
        if not left_tokens or not right_tokens:
            return SequenceMatcher(None, left, right).ratio() * 100
        intersection = " ".join(sorted(left_tokens & right_tokens))
        left_combined = " ".join(sorted((left_tokens & right_tokens) | (left_tokens - right_tokens)))
        right_combined = " ".join(sorted((left_tokens & right_tokens) | (right_tokens - left_tokens)))
        return max(
            SequenceMatcher(None, left, right).ratio(),
            SequenceMatcher(None, intersection, left_combined).ratio(),
            SequenceMatcher(None, intersection, right_combined).ratio(),
            SequenceMatcher(None, left_combined, right_combined).ratio(),
        ) * 100


def deduplicate_entries(entries: list[PaperEntry], fuzzy_title_threshold: int = 92) -> DeduplicationResult:
    unique: list[PaperEntry] = []
    seen_dois: set[str] = set()
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    duplicates = 0

    for entry in entries:
        doi = normalize_doi(entry.doi or entry.url or entry.raw_text)
        url = canonicalize_url(entry.url)
        title = normalize_title(entry.title)

        duplicate = False
        if doi and doi in seen_dois:
            duplicate = True
        elif url and url in seen_urls:
            duplicate = True
        elif title and title in seen_titles:
            duplicate = True
        elif title:
            duplicate = any(
                title_similarity(title, normalize_title(existing.title)) >= fuzzy_title_threshold
                for existing in unique
                if existing.title
            )

        if duplicate:
            duplicates += 1
            continue

        if doi:
            entry.doi = doi
            seen_dois.add(doi)
        if url:
            entry.url = url
            seen_urls.add(url)
        if title:
            seen_titles.add(title)
        unique.append(entry)

    return DeduplicationResult(unique_entries=unique, duplicates_removed=duplicates)
