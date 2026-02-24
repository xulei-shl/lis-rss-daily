# Plan: Unified Process Logs Page

## Context

The current filter-logs page displays two types of logs:
1. **Filter logs** (`article_filter_logs` table) - Article filtering results
2. **Crawl logs** (`journal_crawl_logs` table) - Journal spider execution results

However, the system has more processes that aren't properly logged:
- RSS subscription fetching (manual & scheduled) - only in-memory tracking
- Article processing stages (vectorization, translation) - only final state in JSON

The user wants a unified view showing ALL process logs with a default 30-day filter.

---

## Proposed Approach

### 1. Database Changes

Create two new log tables to capture missing processes:

#### A. `rss_fetch_logs` Table
Track RSS subscription fetching (both manual and scheduled):

```sql
CREATE TABLE rss_fetch_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rss_source_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'partial')),
  articles_count INTEGER DEFAULT 0,
  new_articles_count INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  is_scheduled INTEGER DEFAULT 0,  -- 0=manual, 1=scheduled
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rss_source_id) REFERENCES rss_sources(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_rss_fetch_logs_rss_source_id ON rss_fetch_logs(rss_source_id);
CREATE INDEX idx_rss_fetch_logs_user_id ON rss_fetch_logs(user_id);
CREATE INDEX idx_rss_fetch_logs_created_at ON rss_fetch_logs(created_at);
CREATE INDEX idx_rss_fetch_logs_status ON rss_fetch_logs(status);
```

#### B. `article_process_logs` Table
Track article processing stages (markdown, translate, vector, related):
- **Per-article logging** - each stage completion for each article creates a log entry
- Frontend can aggregate (e.g., "50 articles translated in last 30 days")

```sql
CREATE TABLE article_process_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('markdown', 'translate', 'vector', 'related', 'pipeline_complete')),
  status TEXT NOT NULL CHECK(status IN ('processing', 'completed', 'failed', 'skipped')),
  duration_ms INTEGER,
  error_message TEXT,
  details TEXT,  -- JSON for stage-specific info (e.g., vector embedding dimensions)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_article_process_logs_article_id ON article_process_logs(article_id);
CREATE INDEX idx_article_process_logs_user_id ON article_process_logs(user_id);
CREATE INDEX idx_article_process_logs_stage ON article_process_logs(stage);
CREATE INDEX idx_article_process_logs_created_at ON article_process_logs(created_at);
```

### 2. Database Migration

**File**: `sql/003_add_unified_logs.sql`

Create migration script for the new tables.

### 3. TypeScript Model Updates

**File**: `src/db.ts`

Add new interfaces:
- `RssFetchLogsTable`
- `ArticleProcessLogsTable`

### 4. Service Layer Changes

#### A. RSS Fetch Logging

**File**: `src/rss-scheduler.ts`

Modify `executeFetchTask()` to write logs to database after each fetch completes.

#### B. Article Process Logging

**File**: `src/pipeline.ts`

Add logging calls at key points:
- `updateProcessStage()` - write to `article_process_logs`
- Pipeline complete entry

### 5. API Layer

**File**: `src/api/routes/logs.routes.ts`

Add new endpoints:

```typescript
// RSS fetch logs
GET /api/logs/rss-fetch?page=1&limit=20&fromDate=2025-01-24&toDate=2025-02-24&status=success

// Article process logs
GET /api/logs/process?page=1&limit=20&fromDate=2025-01-24&toDate=2025-02-24&stage=translate

// Unified/aggregate logs (combined view)
GET /api/logs/unified?page=1&limit=50&fromDate=2025-01-24&types=rss,crawl,filter,process
```

**Files**:
- `src/api/rss-fetch-logs.ts` (new)
- `src/api/process-logs.ts` (new)

### 6. Frontend Changes

**File**: `src/views/filter-logs.ejs`

Redesign as a unified logs page:

1. **Rename/Reconcept**: "Process Logs" instead of "Filter Logs"

2. **Tab Structure**:
   - "全部" (All) - **Grouped display** by log type, showing summary counts per type
   - "RSS抓取" (RSS Fetch) - RSS subscription fetch logs
   - "期刊爬取" (Journal Crawl) - Existing crawl logs
   - "过滤" (Filter) - Existing filter logs with expand details (preserve LLM response view)
   - "后处理" (Process) - Vectorization, translation, related articles

3. **Date Filter** (default to 30 days):
   - Quick select: 最近7天, 最近30天 (default), 最近90天, 全部
   - Custom date range picker

4. **Status Filters**: Varies by tab type

5. **Display by Tab**:
   - **全部**: Grouped sections showing counts, expand to see individual logs
   - **RSS抓取**: Source name, status, articles count, new articles, duration, timestamp
   - **期刊爬取**: Journal name, year/volume/issue, status, new articles count, duration, timestamp
   - **过滤**: Article title, domain, passed/rejected, relevance score, reason, timestamp
     - Preserve expand functionality for LLM response view
   - **后处理**: Article title, stage (translate/vector/related), status, duration, timestamp

### 7. Critical Files to Modify

| File | Change |
|------|--------|
| `sql/003_add_unified_logs.sql` | New migration file |
| `src/db.ts` | Add TypeScript interfaces for new tables |
| `src/rss-scheduler.ts` | Add RSS fetch logging to database |
| `src/pipeline.ts` | Add process stage logging to database |
| `src/api/rss-fetch-logs.ts` | New: RSS fetch log service |
| `src/api/process-logs.ts` | New: Process log service |
| `src/api/routes/logs.routes.ts` | Add new endpoints |
| `src/views/filter-logs.ejs` | Redesign as unified logs page |

### 8. Verification

1. Run migration: `npm run migrate`
2. Check tables created: `.schema rss_fetch_logs`, `.schema article_process_logs`
3. Trigger manual RSS fetch → verify log entry
4. Trigger manual journal crawl → verify log entry
5. Test auto-filter → verify process logs created
6. Load page, verify all tabs display correctly
7. Test date filtering (default 30 days)
8. Test status filters on each tab

---

## Notes

- Reuses existing `article_filter_logs` and `journal_crawl_logs` tables
- Adds minimal new logging where gaps exist
- Unified API endpoint can combine data from all sources
- Default 30-day filter improves performance for larger datasets
