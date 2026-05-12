from __future__ import annotations

from datetime import datetime, timezone

from .models import EmailMessage


def sample_emails() -> list[EmailMessage]:
    return [
        EmailMessage(
            id="sample-scholar-1",
            thread_id="sample-thread-1",
            subject="Google Scholar Alert - pentagonal COF thermal conductivity",
            sender="Google Scholar Alerts <scholaralerts-noreply@google.com>",
            date=datetime.now(timezone.utc),
            html="""
            <html><body>
              <h2>Google Scholar Alert</h2>
              <a href="https://example.org/penta-cof-nanotube-thermal">
                Machine-learning interatomic potentials for thermal transport in pentagonal COF nanotubes
              </a>
              <p>Authors A, B - Journal of Computational Materials, 2026</p>
              <p>This work studies phonon transport and thermal conductivity in framework nanotubes.</p>
              <a href="https://example.org/general-catalysis">
                High-throughput catalyst screening with graph neural networks
              </a>
              <p>Computational discovery of catalysts with AI models.</p>
            </body></html>
            """,
            text="",
            snippet="Scholar alert with two papers.",
        ),
        EmailMessage(
            id="sample-toc-1",
            thread_id="sample-thread-2",
            subject="Journal TOC: Computational Materials Research",
            sender="alerts@journal.example",
            date=datetime.now(timezone.utc),
            html="""
            <html><body>
              <h1>Table of Contents</h1>
              <img src="data/toc_images/sample/sample_toc.png" alt="TOC graphic">
              <a href="https://doi.org/10.1234/example.2026.001">
                Phonon-limited thermal conductivity in low-dimensional framework materials
              </a>
              <p>10.1234/example.2026.001</p>
            </body></html>
            """,
            text="",
            snippet="New issue table of contents.",
        ),
        EmailMessage(
            id="sample-promo-1",
            thread_id="sample-thread-3",
            subject="Limited time discount on lab software",
            sender="Marketing <promo@example.com>",
            date=datetime.now(timezone.utc),
            html="<html><body>Sale offer discount coupon. Unsubscribe here.</body></html>",
            text="Sale offer discount coupon. Unsubscribe here.",
            snippet="Discount offer.",
        ),
    ]

