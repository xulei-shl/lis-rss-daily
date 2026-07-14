# Architecture

## Product boundary

Agent Pulse separates private operational state from public intelligence:

```text
Control plane (server-only)
  source lifecycle / source runs / signals / jobs / scout inbox / moderation
                           │
                           ▼ allowlist export
Public plane (static)
  timeline / published scout / tracks / actors / model resources / active view
```

The admin console is never exported to GitHub Pages.

## Data flow

```text
Source registry
  ├─ Tier 1: official facts
  ├─ Tier 2: professional verification
  ├─ Tier 3: expert interpretation
  ├─ Tier 4: social/community heat
  └─ Aggregators: discovery only
          │
          ▼
bounded runner -> policy-aware fetcher -> SourceAdapter -> CollectedSignal
       │              │
       │              └─ retry / conditional request / redirect SSRF / body limit
       └─ SourceRun + health reducer + lifecycle gate
          │
          ▼
dedupe -> time/title/entity clustering -> Event
          │
          ├─ confidence score
          ├─ heat score
          ├─ impact score
          └─ value score
          │
          ▼
review / curation / track + actor composition
          │
          ▼
privacy-safe static export -> GitHub Pages
```

## Module map

| Path | Responsibility |
| --- | --- |
| `src/collectors/` | Adapter contract, RSS/API/aggregator adapters, network safety |
| `src/domain/` | Pure URL, clustering and scoring rules |
| `src/db/` | Kysely schema, migrations, repositories and seed catalog |
| `src/pipeline/` | Collection, clustering and static export orchestration |
| `src/server/` | Fastify public/admin API and security headers |
| `web/public/` | Framework-free static intelligence site |
| `web/admin/` | Local/server-side control room |
| `tests/` | Unit and SQLite integration tests |

## Database portability

SQLite is the zero-config default and enables WAL, foreign keys and a busy timeout. MySQL uses the same Kysely repository and migration definitions. JSON is stored as validated text to avoid dialect-specific JSON behavior; booleans use `0/1`; timestamps use UTC ISO-8601 text.

## Event as the single fact node

Tracks, actor roles, audience types and views never duplicate event facts. They attach narratives to a shared event through junction tables. This makes it possible to compare the same event across agent software, capital, To B and global innovation perspectives without content drift.

## Failure model

- A failed source records health state but does not abort the batch.
- Duplicate URLs are skipped with a unique SHA-256 key.
- New automatic events enter `review`; they are not public by default.
- Manual score overrides are explicit and stop automatic rescoring.
- Static output is rebuilt from published rows only.

## Current maturity boundaries

- The live six-event dataset is curated seed/demo content, not proof of continuous cross-platform hotness detection.
- Source lifecycle, retries, bounded concurrency, conditional requests and run history are implemented as a Stage 2 foundation; scheduler, per-host bulkheads, circuit breaker half-open probes, replay fixtures and SLO rollups remain future work.
- Canonical URL uniqueness currently drops repeated observations of the same document across multiple discovery sources. A future `documents + source_observations` split is required before platform-breadth metrics are production-grade.
- View configuration is exported, but the public client does not yet consume every layout/filter/theme control.
- SQLite is tested in CI. MySQL shares Kysely definitions but is not yet backed by a real MySQL CI service.
