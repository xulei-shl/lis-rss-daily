# LIS-RSS → LIS-WIKI 文献增量同步与历史补录脚本需求文档

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v1.2 |
| 编写日期 | 2026-11-25 |
| 文档状态 | 已与 LIS-WIKI 数据库设计 v2.0 对齐（含历史无 PDF 补录） |
| 交付对象 | LIS-RSS 项目（新增同步脚本） |
| 关联项目 | LIS-WIKI（下游消费方，同机部署） |
| 关联文档 | `docs/设计方案/初始需求.md`、`docs/设计方案/数据库设计.md`（v2.0） |

---

## 1. 背景与范围

### 1.1 现状

- LIS-RSS 每天早上定时下载**当日 3 篇**文献的 PDF，并回写 `ai_summary` 字段；元数据存于其自有 `articles.db`，PDF 存于其 PDF 目录。
- 同时，LIS-RSS 库内已积累一批**`ai_summary` 有值但尚未下载 PDF 的历史文献**（后续会有独立脚本补充下载 PDF）。
- 同步范围由 `scripts/lis-wiki/journals_list.yaml` 白名单定义：白名单期刊文章不论
  `ai_summary` 是否有值都同步；非白名单文章仅在 `ai_summary` 非空时同步。
- LIS-WIKI 与 LIS-RSS 部署在**同一台服务器**上；采用**上游主动推送模式**写入 `lis_wiki.db.article_tasks`，供 wiki 每 5 天的流水线消费。

### 1.2 本次范围

在 LIS-RSS 项目中**新增一个同步脚本**，同时支持两种运行模式：

1. **每日增量同步模式（默认）**：处理当日暂存 PDF 中符合同步集合的文献，复制 PDF 至 5 天周期目录并 UPSERT 元数据；
2. **历史全量补录模式（`--backfill-history`）**：扫描**白名单期刊文章 ∪ 非白名单但有 `ai_summary` 的文章**，以 **`articles.id`（转为字符串写入 `article_tasks.article_id`）唯一去重**，同步全部元数据；对暂无 PDF 的历史文献以 `status = 'awaiting_pdf'` 入库（不阻塞等待 PDF），对已有本地 PDF 的文献一并复制并标记 `status = 'pending'`；
3. **预留独立 PDF 补下载脚本接口契约**：供后续独立下载脚本补齐历史 PDF 后更新 `pdf_filename`、`source_sha256` 并推进状态为 `'pending'`。

### 1.3 非目标（明确不做）

- 不改动 LIS-RSS 现有的下载与 `ai_summary` 生成逻辑，仅在其后追加同步步骤；
- 不在本脚本中实现历史 PDF 的重新联网抓取（由后续独立补下载脚本负责）；
- 不承担 wiki 侧的 PDF 解析、L0 抽取、概念归并、正文生成、FTS5 同步与 SAG `.md` 导出；
- 不写入 `lis_wiki.db` 中除 `article_tasks` 以外的任何表（`sync_jobs`、`concepts`、`concept_mentions` 等由 wiki 独占）；
- 不覆写已有记录的流水线进度状态（`parsed` / `extracted` / `merged` / `failed`）。

---

## 2. 总体设计

### 2.1 数据流

```text
[LIS-RSS 每日下载任务] ──▶ ① 复制 PDF → WIKI_PDF_ROOT/<5天周期>/<article_id>.pdf
                       ──▶ ② 算 source_sha256 + ai_summary_sha256
                       ──▶ ③ UPSERT (status='pending') → article_tasks

[LIS-RSS 历史全量补录] ──▶ 查 articles WHERE 白名单命中 OR ai_summary 非空
                       ──▶ 按 articles.id 去重分批 UPSERT:
                           - 无 PDF: pdf_filename=NULL, source_sha256=NULL, status='awaiting_pdf'
                           - 有 PDF: 复制 PDF, status='pending'

[后续独立 PDF 补下载脚本] ──▶ 查 article_tasks WHERE status='awaiting_pdf' (或 pdf_filename IS NULL)
                           ──▶ 原子写 PDF → WIKI_PDF_ROOT/<目录>/<article_id>.pdf
                           ──▶ UPSERT 补写 pdf_filename/source_sha256，仅当原为 awaiting_pdf 时推进为 'pending'
                                │
                                ▼
[LIS-WIKI 每 5 天流水线]  跳过 awaiting_pdf；pending → parsed → extracted → merged → Web + SAG
```

### 2.2 职责边界与去重契约（关键）

- **唯一去重键**：`article_tasks.article_id`（`TEXT PRIMARY KEY`）直接保存上游 `articles.id` 字符串（需注意严格 `str(row.id).strip()`，不要截断或改写前导字符）。无论是每日增量、历史补录、重复执行还是独立补下载，均以此主键执行 `ON CONFLICT(article_id)` 去重。
- **字段所有权划分**：

  | 字段组 | 字段 | 所有权 | 同步/补录/补下载行为 |
  | --- | --- | --- | --- |
  | 元数据组 | `article_id`、`title`、`url`、`ai_summary`、`ai_summary_sha256`、`published_date`（可选）、`source_name`（可选） | **LIS-RSS 写** | INSERT / UPDATE |
  | PDF 定位组 | `pdf_filename`、`source_sha256` | **LIS-RSS / 补下载脚本写** | 无 PDF 时置 `NULL`；UPDATE 时用 `COALESCE(excluded.*, article_tasks.*)`，**禁止无 PDF 更新擦除已有 PDF** |
  | 流水线组 | `status`、`parser_version`、`parsed_md_path`、`parsed_at`、`extract_prompt_version`、`extracted_source_sha256`、`extracted_summary_sha256`、`raw_extracted_json`、`error_msg` | **LIS-WIKI 独占** | 新插有 PDF 设 `'pending'`，无 PDF 设 `'awaiting_pdf'`；**仅允许从 `'awaiting_pdf'` 在首次补齐 PDF 时自动升为 `'pending'`**，禁止覆盖其它任何状态或缓存列 |
  | 时间戳 | `created_at`、`updated_at` | 双方 | 统一写入**部署所在地时区** `'YYYY-MM-DD HH:MM:SS'`（SQLite `datetime('now', 'localtime')`）；插入时均写，更新时仅写 `updated_at` |

### 2.3 调度与时序依赖

- **每日增量**：推荐由下载任务成功后直接调用（传入当日 `article_id` 列表），或作为独立定时任务晚于下载任务 +30 分钟启动。
- **历史全量补录**：支持手动执行一次（或按需重跑幂等补差），分批提交事务（建议每批 200~500 篇），避免长事务阻塞并发读。

---

## 3. 目录与文件规范

### 3.1 根目录

- `WIKI_PDF_ROOT`：指向 LIS-WIKI 的 PDF 存放根目录（与 wiki `.env` 中 `SOURCE_PDF_DIR` 一致）。
- `WIKI_DB_PATH`：指向 `lis_wiki.db` 绝对路径。

### 3.2 5 天周期文件夹规则

以可配置锚点日期 `SYNC_ANCHOR_DATE`（默认 `1970-01-01`）为基准，按自然日计算周期：

```python
period_index = (today - ANCHOR_DATE).days // 5
period_start = ANCHOR_DATE + timedelta(days=period_index * 5)
folder_name  = period_start.strftime("%Y-%m-%d")   # 文件夹名 = 周期起始日期
target_dir   = Path(WIKI_PDF_ROOT) / folder_name
```

- **历史 PDF 补下载目录约定**：独立下载脚本下载历史 PDF 时，可放入**下载当日对应的 5 天周期文件夹**（`<YYYY-MM-DD>/<safe_article_id>.pdf`），也可放入 `history/<safe_article_id>.pdf`；因为 `article_tasks.pdf_filename` 存的是相对 `SOURCE_PDF_DIR` 的路径，下游 `LIS-WIKI` 均可无差别读取。

### 3.3 文件命名与路径回写（已与 LIS-WIKI 确认）

- 有 PDF 时文件名统一为 `<safe_article_id>.pdf`（仅替换 `/`、`:` 等非法路径字符为 `_`；**数据库 `article_id` 列必须保留上游原始 `articles.id`**）。
- `article_tasks.pdf_filename` 存含子目录的相对路径（`<folder_name>/<safe_article_id>.pdf`）；无 PDF 历史记录存 `NULL`。

### 3.4 复制的原子性

- 先复制到同目录下的临时文件 `<safe_article_id>.pdf.<tmp>`；
- 校验文件大小 > 0 且计算 SHA-256 成功后，用 `os.replace()` 原子重命名为目标文件名；
- 禁止 wiki 侧读到半成品文件。

---

## 4. 功能需求

### FR-1 运行模式与命令行触发

- **每日模式**：`python sync_to_wiki.py --date 2026-11-25`（默认当日）。
- **历史全量补录模式**：`python sync_to_wiki.py --backfill-history [--batch-size 200]`。
  - 扫描同步集合：白名单期刊文章（不论 `ai_summary`）∪ 非白名单但有 `ai_summary` 的文章（不限制时间、不要求 PDF 存在）。
  - 若上游本地恰好已有 PDF 文件则顺便复制并按 `'pending'` 入库；若无 PDF 则仅同步元数据并以 `'awaiting_pdf'` 入库。

### FR-2 待同步集合的确定

同步集合按 `article_id` 取并集，天然不会重复：

```text
白名单命中（rss_sources.name 或 journals.name 在 journals_list.yaml 中）
OR (ai_summary IS NOT NULL AND TRIM(ai_summary) != '')
```

1. **每日模式**：扫描当日 `pdf_staging/daily/<date>/` 的 PDF，只处理命中同步集合的文章；`SYNC_BATCH_SIZE` 只对命中集合的候选计数。白名单文章有 PDF 时即使 `ai_summary` 为空也同步；非白名单且无摘要的 PDF 跳过并保留源文件。
2. **历史全量补录模式**：按 `id ASC` 分页游标扫描同步集合（与每日模式共用同一个 UPSERT 与去重逻辑）。

### FR-3 PDF 复制与哈希计算

- 若源 PDF 存在：按 3.2 建目录 → 按 3.4 原子复制（目标已存在且 SHA-256 一致则复用）→ 输出 `pdf_filename` 与 `source_sha256`；
- 若源 PDF 不存在：
  - **每日模式**：记录 `error` 日志并隔离跳过该篇（每日任务必须带 PDF）；
  - **历史全量补录模式**：允许无 PDF，`pdf_filename = None`、`source_sha256 = None`、`target_status = 'awaiting_pdf'`，继续入库元数据。
- 对非空 `ai_summary` 原文计算 UTF-8 SHA-256 十六进制字符串 `ai_summary_sha256`；`ai_summary` 为空时写 `NULL`。

### FR-4 元数据写入 `lis_wiki.db`

字段映射表（`articles` → `article_tasks`）：

| `article_tasks` 字段 | 来源 / 取值 | 说明 |
| --- | --- | --- |
| `article_id` | `str(articles.id).strip()` | **主键，严格用上游 ID 去重** |
| `title` | `articles.title` | `NOT NULL`，为空则跳过该篇并记错 |
| `url` | `articles.url` | 可为 `NULL` |
| `ai_summary` | `articles.ai_summary` | **写入完整原文**，不截断；白名单文章可为 `NULL` |
| `ai_summary_sha256` | 非空摘要的 SHA-256 | `ai_summary` 为空时为 `NULL`，配合 wiki 四段式缓存校验 |
| `pdf_filename` | `<folder_name>/<safe_id>.pdf` 或 `NULL` | 历史无 PDF 时为 `NULL` |
| `source_sha256` | PDF SHA-256 或 `NULL` | 历史无 PDF 时为 `NULL` |
| `published_date` | `articles.published_at` / 发布日 | 可选，供 Web 溯源排序与展示 |
| `source_name` | `articles.source` / 期刊名 | 可选，供 Web 溯源展示 |
| `status` | `'pending'`（有 PDF）或 `'awaiting_pdf'`（无 PDF） | 见下方冲突合并规则 |
| `created_at` / `updated_at` | `datetime('now', 'localtime')` | 统一部署所在地时区 `'YYYY-MM-DD HH:MM:SS'` |

写入 SQL（与 `docs/设计方案/数据库设计.md` v2.0 完全一致）：

```sql
INSERT INTO article_tasks (
    article_id, title, url, ai_summary, ai_summary_sha256,
    pdf_filename, source_sha256, published_date, source_name,
    status, created_at, updated_at
) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, datetime('now', 'localtime'), datetime('now', 'localtime')
)
ON CONFLICT(article_id) DO UPDATE SET
    title             = excluded.title,
    url               = excluded.url,
    ai_summary        = excluded.ai_summary,
    ai_summary_sha256 = excluded.ai_summary_sha256,
    pdf_filename      = COALESCE(excluded.pdf_filename, article_tasks.pdf_filename),
    source_sha256     = COALESCE(excluded.source_sha256, article_tasks.source_sha256),
    published_date    = COALESCE(excluded.published_date, article_tasks.published_date),
    source_name       = COALESCE(excluded.source_name, article_tasks.source_name),
    status            = CASE
                            WHEN article_tasks.status = 'awaiting_pdf'
                             AND excluded.pdf_filename IS NOT NULL
                             AND excluded.source_sha256 IS NOT NULL
                            THEN 'pending'
                            ELSE article_tasks.status
                        END,
    updated_at        = datetime('now', 'localtime');
```

### FR-5 变更检测、去重与补下载保护

- **按 `article_id`（上游 `articles.id`）幂等去重**：
  - 记录不存在：执行 INSERT，有 PDF 置 `'pending'`，无 PDF 置 `'awaiting_pdf'`；
  - 记录已存在且核心值无变化：应用层比对（元数据无变更，且“并非从无 PDF 变成有 PDF”），直接**跳过 UPDATE**（`stats["skipped"] += 1`），不产生无意义的 `updated_at` 刷新；
  - 记录已存在且元数据变化或首次补齐 PDF：执行上述 UPSERT 的 `DO UPDATE` 分支：
    - 借助 `COALESCE(excluded.pdf_filename, article_tasks.pdf_filename)`，**重跑无 PDF 历史补录绝不会覆盖已被独立脚本下载好的 PDF**；
    - 借助 `CASE WHEN article_tasks.status = 'awaiting_pdf' AND ... THEN 'pending'`，**独立脚本补齐 PDF 后状态自动推进为 `'pending'`**，而 `parsed` / `extracted` / `merged` / `failed` 状态与缓存列绝不被同步脚本篡改。

### FR-6 并发与一致性

- 打开 `lis_wiki.db` 时依次执行 `PRAGMA journal_mode = WAL;`、`PRAGMA foreign_keys = ON;`、`PRAGMA busy_timeout = 5000;`。
- 历史全量补录按每批 200~500 条分短事务提交，事务内不做文件复制或网络请求。
- 有 PDF 时严格遵守**先原子复制并校验 PDF → 再写 db**。
- 所有时间列由 SQLite `datetime('now', 'localtime')` 生成服务器部署所在地时区 `'YYYY-MM-DD HH:MM:SS'`。

### FR-7 异常处理与故障隔离

- 单篇异常（`title` 为空、每日模式下 PDF 缺失、IO 异常）仅记录 `error` 并跳过该篇，不阻断同批其他记录；
- 禁止删除 wiki 侧任何文件或数据库记录。

### FR-8 日志与可观测性

- 结构化日志区分运行模式（`daily` / `backfill`）、总扫描数、新增 `pending` 数、新增 `awaiting_pdf` 数、更新数、跳过（无变化）数、失败数及耗时；
- 历史全量补录不修改每日水位线文件（除非用户显式指定同步水位线），两者互不干扰；均不写入 wiki 的 `sync_jobs` 表。

### FR-9 配置项

```env
WIKI_DB_PATH=/path/to/lis-wiki/data/lis_wiki.db
WIKI_PDF_ROOT=/path/to/lis-wiki/data/pdfs   # 必须与 wiki 的 SOURCE_PDF_DIR 一致
JOURNALS_LIST_PATH=/path/to/lis-rss-daily/scripts/lis-wiki/journals_list.yaml
SYNC_ANCHOR_DATE=1970-01-01                 # 5天周期锚点
SYNC_BATCH_SIZE=3                           # 每日同步上限
BACKFILL_BATCH_SIZE=200                     # 历史全量同步单事务批大小
SYNC_ENABLED=true
```

---

## 5. 执行流程（伪代码）

```python
def sync_articles(articles: Iterable[ArticleRow], *, allow_missing_pdf: bool, folder: str, batch_size: int = 200):
    stats = {"inserted_or_updated": 0, "awaiting_pdf": 0, "skipped": 0, "failed": 0}
    staged = []

    for row in articles:
        try:
            aid = str(row.id).strip()
            if not aid or not row.title or not row.title.strip():
                raise ValueError("id/title 为空")

            src_pdf = find_local_pdf(aid)
            if src_pdf is not None:
                safe_id = safe_name(aid)
                target_dir = Path(WIKI_PDF_ROOT) / folder
                target_dir.mkdir(parents=True, exist_ok=True)
                rel = f"{folder}/{safe_id}.pdf"
                sha = atomic_copy_and_hash(src_pdf, target_dir / f"{safe_id}.pdf")
                target_status = "pending"
            elif allow_missing_pdf:
                rel, sha = None, None
                target_status = "awaiting_pdf"
            else:
                raise FileNotFoundError(f"每日同步缺少 PDF: {aid}")

            summary = row.ai_summary if row.ai_summary and row.ai_summary.strip() else None
            staged.append({
                "article_id": aid,                   # 严格用上游 articles.id 去重
                "title": row.title,
                "url": row.url,
                "ai_summary": summary,
                "ai_summary_sha256": sha256_text(summary) if summary else None,
                "pdf_filename": rel,
                "source_sha256": sha,
                "published_date": row.published_date,
                "source_name": row.source_name,
                "target_status": target_status,
            })
        except Exception as e:
            log_error(getattr(row, "id", "?"), e)
            stats["failed"] += 1

    with sqlite3.connect(WIKI_DB_PATH, timeout=5) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        for chunk in chunks(staged, batch_size):
            with conn:
                for item in chunk:
                    changed = upsert_if_changed(conn, item)  # 见 FR-4 / FR-5
                    if not changed:
                        stats["skipped"] += 1
                    elif item["target_status"] == "awaiting_pdf":
                        stats["awaiting_pdf"] += 1
                    else:
                        stats["inserted_or_updated"] += 1
    return stats
```

---

## 6. 验收标准

| 编号 | 场景 | 预期结果 |
| --- | --- | --- |
| AC-1 | 正常日同步 3 篇 | PDF 落入正确周期文件夹；`article_tasks` 新增 3 条 `status='pending'` 记录，`article_id` 为上游 `articles.id` |
| AC-2 | 历史全量补录（无 PDF） | 同步集合（白名单文章 ∪ 非白名单有摘要文章）分批写入 `article_tasks`，`pdf_filename`/`source_sha256` 为 `NULL`，`status='awaiting_pdf'` |
| AC-3 | 重复执行每日同步或历史补录 | 按 `article_id`（`articles.id`）严格去重，无变化记录跳过 DB 更新、不产生重复行或重复文件 |
| AC-4 | 上游仅更新 `ai_summary` | `ai_summary`、`ai_summary_sha256`、`updated_at` 更新；既有 `status`、`raw_extracted_json`、`parsed_md_path` 保持不变 |
| AC-5 | 上游更新已有文章 PDF | `source_sha256`（及可能变化的 `pdf_filename`）、`updated_at` 更新；既有 `parsed`/`extracted`/`merged` 流水线字段不被覆盖 |
| AC-6 | 独立脚本后续为历史记录补下载 PDF | 原 `status='awaiting_pdf'` 记录写入 `pdf_filename`、`source_sha256` 后自动推进为 `status='pending'` |
| AC-7 | 补下载完成后再次重跑历史补录（无 PDF） | `COALESCE` 保护生效，**不会抹除**已下载的 `pdf_filename`、`source_sha256` 与已有 `status` |
| AC-8 | 白名单文章 `ai_summary` 为空 | 仍正常迁移：有 PDF 记 `pending`，无 PDF 记 `awaiting_pdf`；`ai_summary`/`ai_summary_sha256` 写 `NULL` |
| AC-9 | 与 wiki 流水线并发读写 | 无 `database is locked` 异常，wiki 正常跳过 `awaiting_pdf` 并只消费 `pending` |
| AC-10 | 手动补数 `--date` | 文件落入指定日期对应周期文件夹，数据正确 |
| AC-11 | 文章同时命中白名单和有摘要 | 只产生一条 `article_tasks` 记录，不重复计数、不重复复制 PDF |
| AC-12 | 非白名单且 `ai_summary` 为空 | 不迁移；每日暂存 PDF 保留，计入 `out_of_scope` |

---

## 7. 风险提示

- **跨库契约变更风险**：`article_tasks` 是唯一交界表，两项目修改该表元数据列定义或命名时需同步更新 `docs/设计方案/数据库设计.md` 与本文档。
- **`articles.id` 格式一致性**：上游读取 `articles.id` 转为字符串时须确保每日任务、历史补录、独立补下载三处转换规则完全一致（如统一 `str(int_id)`），否则会破坏去重。
- **周期边界漂移**：若锚点日期变更，历史文件夹命名规则失效；锚点一经上线不得修改。
- **白名单匹配风险**：白名单按 `rss_sources.name` / `journals.name` 精确匹配，不用子串匹配；名单变更只影响后续迁移，不会删除 wiki 已有记录。`email` / `web` / `keyword` 来源且没有 `rss_source_id`、`journal_id` 的文章只能通过“`ai_summary` 非空”规则纳入。
- **历史补下载磁盘占用**：补齐全量历史 PDF 前需预先评估磁盘空间。

---

## 8. 确认状态与上游待确认事项

| 序号 | 事项 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| 1 | `pdf_filename` 含子目录 & 可为空 | ✅ 已确认 | 支持每日周期路径 `<YYYY-MM-DD>/<id>.pdf`，历史无 PDF 时允许为 `NULL`（`status='awaiting_pdf'`） |
| 2 | 去重键与变更检测隔离 | ✅ 已确认 | 以 `articles.id`（`article_id` 主键）唯一去重；采用四段式哈希检测 + `COALESCE` 保护已下载 PDF |
| 3 | 周期锚点日期 | ⏳ 上游待确认 | 5 天周期锚点取 `1970-01-01` 还是上线日；历史补下载 PDF 存放周期目录还是 `history/` 子目录 |
| 4 | 上游 `articles` 实际列名 | ⏳ 上游待确认 | 需由 LIS-RSS 仓库对照 `articles` 表确认标题、URL、发表日期、期刊/源名称、更新时间字段名 |
| 5 | 调度集成方式 | ⏳ 上游待确认 | 每日模式采用"下载任务直接调用"还是"独立定时任务" |
| 6 | 同步范围 | ✅ 已确认 | 白名单 `scripts/lis-wiki/journals_list.yaml` 文章不论 `ai_summary` 均同步；非白名单文章仅在 `ai_summary` 非空时同步；按 `article_id` 并集去重 |
