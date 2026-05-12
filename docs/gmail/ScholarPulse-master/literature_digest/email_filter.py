from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .models import EmailMessage


ACADEMIC_SIGNALS = (
    "doi",
    "journal",
    "article",
    "research",
    "publication",
    "google scholar",
    "scholar alert",
    "table of contents",
    "toc",
    "arxiv",
    "sciencedirect",
    "springer",
    "wiley",
    "acs",
    "rsc",
    "nature",
    "science",
    "elsevier",
    "mdpi",
)


@dataclass(slots=True)
class FilterDecision:
    skip: bool
    reason: str = ""


def classify_email(email: EmailMessage, config: dict[str, Any]) -> FilterDecision:
    filtering = config["filtering"]
    sender_lower = email.sender.lower()
    subject_lower = email.subject.lower()
    searchable = " ".join([sender_lower, subject_lower, email.snippet.lower(), email.text[:2000].lower()])

    for blocked in filtering.get("sender_blocklist", []):
        if blocked.lower() in sender_lower:
            return FilterDecision(True, f"sender blocklist: {blocked}")

    for allowed in filtering.get("academic_sender_allowlist", []):
        if allowed.lower() in sender_lower:
            return FilterDecision(False)

    if not filtering.get("skip_promotional", True):
        return FilterDecision(False)

    has_academic_signal = any(signal in searchable for signal in ACADEMIC_SIGNALS)
    matched_keywords = [
        keyword
        for keyword in filtering.get("promotional_keywords", [])
        if keyword.lower() in searchable
    ]

    if matched_keywords and not has_academic_signal:
        return FilterDecision(True, "promotional keywords: " + ", ".join(matched_keywords[:3]))

    if "unsubscribe" in searchable and any(word in searchable for word in ("coupon", "deal", "save", "buy now")):
        return FilterDecision(True, "marketing unsubscribe pattern")

    return FilterDecision(False)

