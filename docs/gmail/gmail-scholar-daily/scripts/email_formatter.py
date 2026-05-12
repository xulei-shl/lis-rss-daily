#!/usr/bin/env python3
"""
Gmail Email Formatter - Format Gmail email JSON to readable Markdown.

Specialized for Google Scholar Alerts with full paper details:
- Title with PDF/HTML markers
- Authors
- Source/Journal
- Snippet/Abstract

Usage:
    python email_formatter.py INPUT_FILE [--output OUTPUT_FILE]

    # Format from JSON output of gmail_skill.py read command
    python email_formatter.py emails.json

    # Specify output file
    python email_formatter.py emails.json --output summary.md
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from html import unescape
from pathlib import Path


def parse_authors_source(html_content: str) -> tuple:
    """Extract authors and source from Scholar Alert HTML.

    Returns:
        tuple: (authors_str, source_str, snippet_str)
    """
    # Pattern to find the metadata div containing authors and source
    # Usually in format: <div>Author1, Author2 - Source, Year</div>
    # Then followed by snippet div

    authors = ""
    source = ""
    snippet = ""

    # Find all paper blocks
    paper_pattern = r'<h3[^>]*>.*?</h3>\s*<div[^>]*>(.*?)</div>'
    for match in re.finditer(paper_pattern, html_content, re.DOTALL):
        metadata = match.group(1)
        # Clean up HTML entities and tags
        metadata = unescape(re.sub(r'<[^>]+>', ' ', metadata))
        metadata = ' '.join(metadata.split())

        # Split by dash separator (Author - Source)
        if ' - ' in metadata:
            parts = metadata.split(' - ', 1)
            authors = parts[0].strip()
            source = parts[1].strip() if len(parts) > 1 else ""
        else:
            authors = metadata.strip()

        break  # Get first match

    # Extract snippet (usually after the source, contains "Abstract:" or similar)
    snippet_pattern = r'<div[^>]*class="[^"]*gse_alrt_sni[^"]*"[^>]*>(.*?)</div>'
    for match in re.finditer(snippet_pattern, html_content, re.DOTALL):
        snippet_html = match.group(1)
        # Clean HTML but keep text
        snippet = unescape(re.sub(r'<[^>]+>', ' ', snippet_html))
        snippet = ' '.join(snippet.split())
        # Limit snippet length
        if len(snippet) > 300:
            snippet = snippet[:300].rstrip() + '…'
        break

    return authors, source, snippet


def parse_scholar_alert_paper(entry_html: str) -> dict:
    """Parse a single paper entry from Scholar Alert HTML.

    Args:
        entry_html: HTML fragment for one paper entry

    Returns:
        dict with keys: title, authors, source, snippet, has_pdf, has_html
    """
    paper = {
        "title": "",
        "authors": "",
        "source": "",
        "snippet": "",
        "has_pdf": False,
        "has_html": False,
    }

    # Check for PDF/HTML markers (usually in <span> before <a>)
    pdf_match = re.search(r'<span[^>]*>\[PDF\]</span>', entry_html)
    html_match = re.search(r'<span[^>]*>\[HTML\]</span>', entry_html)
    paper["has_pdf"] = bool(pdf_match)
    paper["has_html"] = bool(html_match)

    # Extract title from <a class="gse_alrt_title">
    title_pattern = r'<a[^>]*class="gse_alrt_title"[^>]*>(.*?)</a>'
    title_match = re.search(title_pattern, entry_html, re.DOTALL)
    if title_match:
        title_html = title_match.group(1)
        # Remove <font> tags but keep content (these highlight keywords)
        title = re.sub(r'<font[^>]*>([^<]+)</font>', r'\1', title_html)
        # Remove any remaining HTML tags
        title = unescape(re.sub(r'<[^>]+>', '', title))
        title = ' '.join(title.split())
        paper["title"] = title

    # Extract authors, source, and snippet
    authors, source, snippet = parse_authors_source(entry_html)
    paper["authors"] = authors
    paper["source"] = source
    paper["snippet"] = snippet

    return paper


def parse_scholar_alerts(body_html: str) -> list:
    """Parse all papers from Google Scholar Alert email HTML.

    Args:
        body_html: Full HTML body of the email

    Returns:
        list of dict, each containing paper details
    """
    papers = []

    # Google Scholar Alert structure: each paper is wrapped in <h3>...</h3>
    # followed by metadata div(s). Find all h3 blocks.
    h3_pattern = r'<h3[^>]*>.*?</h3>'
    h3_matches = list(re.finditer(h3_pattern, body_html, re.DOTALL))

    for i, h3_match in enumerate(h3_matches):
        start_pos = h3_match.start()
        # End position is start of next h3, or end of string
        end_pos = h3_matches[i + 1].start() if i + 1 < len(h3_matches) else len(body_html)
        entry_html = body_html[start_pos:end_pos]

        paper = parse_scholar_alert_paper(entry_html)
        if paper["title"]:  # Only include if we got a title
            papers.append(paper)

    return papers


def clean_email_address(email_str: str) -> str:
    """Clean email address string."""
    # Extract name from "Name <email@address>" format
    match = re.match(r'"?([^"]+)"?\s*<([^>]+)>', email_str)
    if match:
        name = match.group(1).strip()
        return name
    return email_str.strip()


def format_date(date_str: str) -> str:
    """Format date string to readable format."""
    try:
        # Parse RFC 2822 date
        # Example: "Sat, 31 Jan 2026 12:09:16 -0800"
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(date_str)
        return dt.strftime("%Y年%-m月%-d日 %H:%M:%S %z")
    except:
        return date_str


def format_labels(labels: list) -> str:
    """Format label list for display."""
    label_map = {
        "UNREAD": "UNREAD",
        "CATEGORY_UPDATES": "CATEGORY_UPDATES",
        "INBOX": "INBOX",
        "STARRED": "STARRED",
        "IMPORTANT": "IMPORTANT",
        "SENT": "SENT",
        "DRAFT": "DRAFT",
        "SPAM": "SPAM",
        "TRASH": "TRASH",
    }
    formatted = []
    for label in labels:
        name = label_map.get(label, label)
        formatted.append(name)
    return ", ".join(formatted)


def format_email_to_markdown(email: dict, email_index: int, total_emails: int) -> str:
    """Convert a single Gmail email JSON to Markdown format.

    Args:
        email: Email dict from gmail_skill.py read output
        email_index: Index of this email in the batch
        total_emails: Total number of emails being formatted

    Returns:
        Markdown formatted string
    """
    md_lines = []

    # Header section (only for first email if batch)
    if email_index == 1:
        # Extract date from first email for header
        date_str = email.get("date", "")
        from_str = email.get("from", "")

        md_lines.append("# Google Scholar Alerts - " + datetime.now().strftime("%Y-%m-%d"))
        md_lines.append("")
        md_lines.append(f"**Date**: {format_date(date_str)}")
        md_lines.append(f"**From**: {clean_email_address(from_str)}")
        md_lines.append(f"**Total Emails**: {total_emails}")
        md_lines.append("")
        md_lines.append("---")
        md_lines.append("")

    # Email section
    subject = email.get("subject", "No Subject")
    email_id = email.get("id", "")
    labels = email.get("labels", [])
    date_str = email.get("date", "")

    md_lines.append(f"## {email_index}. {subject}")
    md_lines.append("")
    md_lines.append(f"**Email ID**: `{email_id}`")

    if labels:
        md_lines.append(f"**Labels**: {format_labels(labels)}")

    md_lines.append("")

    # Parse and format papers
    body = email.get("body", "")
    papers = parse_scholar_alerts(body)

    if papers:
        md_lines.append("### Papers:")
        md_lines.append("")

        for i, paper in enumerate(papers, 1):
            # Build title line with markers
            markers = []
            if paper["has_pdf"]:
                markers.append("[PDF]")
            if paper["has_html"]:
                markers.append("[HTML]")

            title = paper["title"]
            if markers:
                title = f"**{title}** {' '.join(markers)}"
            else:
                title = f"**{title}**"

            md_lines.append(f"{i}. {title}")

            # Authors
            if paper["authors"]:
                md_lines.append(f"   - Authors: {paper['authors']}")

            # Source
            if paper["source"]:
                md_lines.append(f"   - Source: {paper['source']}")

            # Snippet
            if paper["snippet"]:
                snippet = paper["snippet"]
                if len(snippet) > 200:
                    snippet = snippet[:200].rstrip() + '…'
                md_lines.append(f"   - Snippet: {snippet}")

            md_lines.append("")

    md_lines.append("---")
    md_lines.append("")

    return "\n".join(md_lines)


def parse_input_file(input_file: str) -> list:
    """Parse input file containing email JSON(s).

    Handles two formats:
    1. Single JSON object
    2. Multiple JSON objects (one per line, or concatenated)

    Args:
        input_file: Path to input file

    Returns:
        list of email dicts
    """
    emails = []

    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Try parsing as JSON array first
    try:
        data = json.loads(content)
        if isinstance(data, list):
            return data
        elif isinstance(data, dict):
            return [data]
    except json.JSONDecodeError:
        pass

    # Try parsing as concatenated JSON objects (gmail_skill.py output)
    depth = 0
    current = ""
    for char in content:
        current += char
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0 and current.strip():
                try:
                    data = json.loads(current.strip())
                    if isinstance(data, dict) and "id" in data:
                        emails.append(data)
                    current = ""
                except json.JSONDecodeError:
                    current = ""

    return emails


def main():
    parser = argparse.ArgumentParser(
        description="Format Gmail email JSON to readable Markdown.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Format from file
    python email_formatter.py emails.json

    # Specify output file
    python email_formatter.py emails.json --output summary.md

    # Read from stdin (useful for piping)
    python gmail_skill.py read EMAIL_ID | python email_formatter.py -
        """
    )
    parser.add_argument("input", help="Input file path, or '-' for stdin")
    parser.add_argument("--output", "-o", help="Output file path (default: auto-generated)")
    parser.add_argument("--output-dir", default="outputs/emails",
                        help="Output directory for auto-generated files (default: outputs/emails)")
    parser.add_argument("--json-output", help="Output JSON file path for parsed papers (optional)")

    args = parser.parse_args()

    # Read input
    if args.input == '-':
        content = sys.stdin.read()
        # Parse concatenated JSON objects from stdin
        emails = []
        depth = 0
        current = ""
        for char in content:
            current += char
            if char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0 and current.strip():
                    try:
                        data = json.loads(current.strip())
                        if isinstance(data, dict) and "id" in data:
                            emails.append(data)
                        current = ""
                    except json.JSONDecodeError:
                        current = ""
    else:
        emails = parse_input_file(args.input)

    if not emails:
        print("Error: No valid email data found in input.", file=sys.stderr)
        sys.exit(1)

    # Parse all papers for JSON output
    all_papers = []
    for email in emails:
        body = email.get("body", "")
        papers = parse_scholar_alerts(body)
        for paper in papers:
            paper_data = {
                "email_id": email.get("id", ""),
                "email_subject": email.get("subject", ""),
                "title": paper["title"],
                "authors": paper["authors"],
                "source": paper["source"],
                "snippet": paper["snippet"],
                "has_pdf": paper["has_pdf"],
                "has_html": paper["has_html"]
            }
            all_papers.append(paper_data)

    # Output JSON if requested
    if args.json_output:
        json_output_path = Path(args.json_output)
        json_output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(json_output_path, 'w', encoding='utf-8') as f:
            json.dump(all_papers, f, ensure_ascii=False, indent=2)
        print(f"JSON output: {json_output_path}")

    # Generate Markdown
    md_sections = []
    for i, email in enumerate(emails, 1):
        md_sections.append(format_email_to_markdown(email, i, len(emails)))

    # Add footer
    md_sections.append("\n*This document was auto-generated by the gmail-skill*\n")

    full_markdown = "\n".join(md_sections)

    # Determine output path
    if args.output:
        output_path = args.output
    else:
        # Auto-generate filename based on date
        output_dir = Path(args.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        date_str = datetime.now().strftime("%Y-%m-%d")
        # Check if it's Scholar Alerts
        first_subject = emails[0].get("subject", "")
        if "scholar" in first_subject.lower() or "alert" in first_subject.lower():
            output_path = output_dir / f"{date_str}-google-scholar-alerts.md"
        else:
            output_path = output_dir / f"{date_str}-email-summary.md"

    # Write output
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(full_markdown)

    print(f"Formatted {len(emails)} email(s)")
    print(f"Output: {output_path}")
    result = {
        "emails_processed": len(emails),
        "output_file": str(output_path),
    }
    if args.json_output:
        result["json_output_file"] = str(args.json_output)
        result["total_papers"] = len(all_papers)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
