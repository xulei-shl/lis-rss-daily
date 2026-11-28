# LIS-RSS → LIS-WIKI 同步脚本

把 LIS-RSS 中符合同步集合的文献（元数据 + PDF）增量写入 LIS-WIKI 的
`lis_wiki.db.article_tasks`，供 wiki 每 5 天流水线消费。

同步集合按 `article_id` 取并集，天然不会重复：

- **无条件白名单期刊文章**：命中 `scripts/lis-wiki/journals_list.yaml`，不论
  `ai_summary` 是否有值；
- **摘要白名单期刊文章**：命中 `scripts/lis-wiki/journals_summary_list.yaml`，
  **且** `ai_summary` 非空时才同步。

设计契约见 `docs/lis-wiki-脚本/LIS-RSS同步脚本需求.md`。本脚本只写
`article_tasks`，不写 `sync_jobs`、`concepts` 等其它表。

## 数据来源与边界

```
paper-pdf-summary/pdf_staging/
├── daily/2026-11-26/12345.pdf   # 每日 cron 自动产生，会进入 wiki
├── history/12346.pdf            # 可选，历史 PDF 补下载脚本可放这里
└── manual/...                   # 手动/API 路径，明确忽略
```

- **只有每日 cron 的文献进入 LIS-WIKI**。手动 `--title`、API `/process` 的 PDF
  在摘要成功后由 `paper-pdf-summary` 直接删除，不会写入暂存区。
- 每日 cron 只有在 LIS-RSS 数据库提交成功（`ai_summary` 已落库）后，才把 PDF
  移入 `pdf_staging/daily/<YYYY-MM-DD>/<article_id>.pdf`。
- 期刊白名单分为两份：无条件白名单 `scripts/lis-wiki/journals_list.yaml`（命中即同步，
  不论 `ai_summary`）；摘要白名单 `scripts/lis-wiki/journals_summary_list.yaml`
  （命中且 `ai_summary` 非空才同步）。
- 每日同步仍以暂存 PDF 为驱动；如果某篇 PDF 既不在无条件白名单，又不满足
  「摘要白名单 + `ai_summary` 非空」，会跳过并保留源文件，计入 `out_of_scope`，
  不会误删。
- 同步脚本按 `str(articles.id).strip()` 作为 `article_tasks.article_id`，不截断、
  不改写前导字符。
- PDF 先复制到 wiki 目标目录的临时文件，校验大小和 SHA-256 后 `os.replace`
  原子落盘，再提交数据库；数据库提交成功后才删除暂存源文件。

## 目录规则

以 `SYNC_ANCHOR_DATE=1970-01-01` 为锚点，每 5 天一个周期：

```
period_index = (date - anchor).days // 5
period_start = anchor + timedelta(days=period_index * 5)
folder       = period_start.strftime("%Y-%m-%d")
```

例如 `2026-11-26` 落在 `2026-11-23/`。目标文件为
`<WIKI_PDF_ROOT>/<folder>/<safe_article_id>.pdf`，数据库中保存相对路径
`<folder>/<safe_article_id>.pdf`。

历史补录时，如果 PDF 来自 `pdf_staging/history/`，目标目录使用
`<WIKI_PDF_ROOT>/history/`，相对路径为 `history/<safe_article_id>.pdf`。

## 配置

```bash
cd /opt/lis-rss-daily/scripts/lis-wiki
cp .env.example .env
```

关键项：

| 变量 | 说明 |
| --- | --- |
| `LIS_RSS_DB_PATH` | 上游 `rss-tracker.db`，只读打开 |
| `WIKI_DB_PATH` | 下游 `lis_wiki.db` |
| `WIKI_PDF_ROOT` | 必须与 LIS-WIKI 的 `SOURCE_PDF_DIR` 一致 |
| `SYNC_STAGING_ROOT` | 默认 `scripts/paper-pdf-summary/pdf_staging` |
| `JOURNALS_LIST_PATH` | 无条件白名单，默认 `scripts/lis-wiki/journals_list.yaml` |
| `SUMMARY_JOURNALS_LIST_PATH` | 摘要白名单，默认 `scripts/lis-wiki/journals_summary_list.yaml` |
| `SYNC_ANCHOR_DATE` | 5 天周期锚点，上线后不要修改 |
| `SYNC_BATCH_SIZE` | 每个 daily 日期目录每轮最多写入的篇数，默认 3 |
| `BACKFILL_BATCH_SIZE` | 历史补录单批条数，默认 200 |
| `SYNC_DELETE_SOURCE_AFTER_SUCCESS` | 提交成功后删除暂存 PDF，默认 `true` |

环境变量优先于 `.env`。

## 使用

### 每日增量（默认）

```bash
/opt/lis-rss-daily/lis-rss/bin/python sync_to_wiki.py
```

不带 `--date` 时（定时任务的默认调用方式）先补扫 `pdf_staging/daily/` 下所有
仍有 PDF 的历史日期目录，再处理今天；每个日期目录按文件名顺序最多处理
`SYNC_BATCH_SIZE` 个需要写入的 PDF（已同步无变化的文件不占配额）。这样某天
超过单次上限、或 12:00 之后才落盘的 PDF 会在后续运行中继续消化，不会永久留在
当天目录。只处理今天可加 `--no-catch-up`。

无条件白名单文章有 PDF 时会正常入库，即使 `ai_summary` 为空；摘要白名单文章
需 `ai_summary` 非空才入库；不满足任一条件的 PDF 会跳过并保留源文件。

手动补某一天：

```bash
/opt/lis-rss-daily/lis-rss/bin/python sync_to_wiki.py --date 2026-11-26
```

`--date` 只处理该日期目录，不会补扫其它日期。

只同步指定 ID（仍从 `--date` 对应的 daily 目录读取）：

```bash
/opt/lis-rss-daily/lis-rss/bin/python sync_to_wiki.py --date 2026-11-26 --ids 12345,12346
```

### 历史全量补录

先 dry-run 检查，再正式执行：

```bash
/opt/lis-rss-daily/lis-rss/bin/python sync_to_wiki.py --backfill-history --dry-run
/opt/lis-rss-daily/lis-rss/bin/python sync_to_wiki.py --backfill-history
```

扫描同步集合（无条件白名单 ∪（摘要白名单 ∩ 有摘要））：

- 无条件白名单文章：不论 `ai_summary` 是否有值都纳入；
- 摘要白名单文章：只有 `ai_summary` 非空才纳入；
- 两份名单都不命中、或命中摘要白名单但无摘要的文章：不纳入；
- 有暂存 PDF：复制并按 `status='pending'` 入库；
- 无 PDF：`pdf_filename=NULL`、`source_sha256=NULL`、`status='awaiting_pdf'`。

可调整单批条数：

```bash
/opt/lis-rss-daily/lis-rss/bin/python sync_to_wiki.py --backfill-history --batch-size 500
```

`--backfill-history` 会写 `WIKI_PDF_ROOT/history/`；请避免与 LIS-WIKI 的 `download_history_pdfs.py` 同时运行（两者没有共享锁，重叠时同一目标文件可能被覆盖）。

### 调试

```bash
# 不写文件、不写数据库、不删除源文件
... sync_to_wiki.py --dry-run

# 正常写入，但保留暂存 PDF
... sync_to_wiki.py --keep-source

# 详细日志
... sync_to_wiki.py --verbose
```

## 定时任务

每日摘要任务 07:00 启动，`max_runtime_minutes=180`，最后一篇可能到 10:15 左右
结束。建议 10:30 同步一次，12:00 再兜底一次：

```cron
30 10 * * * cd /opt/lis-rss-daily/scripts/lis-wiki && /opt/lis-rss-daily/lis-rss/bin/python sync_to_wiki.py >> sync.log 2>&1
0 12 * * * cd /opt/lis-rss-daily/scripts/lis-wiki && /opt/lis-rss-daily/lis-rss/bin/python sync_to_wiki.py >> sync.log 2>&1
```

12:00 的重复执行是幂等的，并会继续补扫当天以及之前仍未清空的 daily 目录。

## 状态与字段保护

UPSERT 严格使用需求文档的 `COALESCE` + `CASE`：

- `pdf_filename`、`source_sha256` 为空时不会擦除已有 PDF 信息；
- `ai_summary` 允许为 `NULL`；无条件白名单文章没有摘要时按 `NULL` 写入，`ai_summary_sha256` 也为 `NULL`；
- 仅当原状态为 `awaiting_pdf` 且本次补齐 PDF 时，才自动推进为 `pending`；
- 绝不覆盖 `parsed`、`extracted`、`merged`、`failed` 状态；
- 绝不写 `parser_version`、`parsed_md_path`、`raw_extracted_json` 等流水线缓存列；
- 元数据无变化且不是首次补 PDF 时跳过 UPDATE，不刷新 `updated_at`。

## 退出码

- `0`：本次没有失败（允许无文件、允许跳过无变化记录）；
- `1`：至少一篇失败（源文件保留，便于重跑）；
- `2`：配置或参数错误。

## 测试

```bash
cd /opt/lis-rss-daily
/opt/lis-rss-daily/lis-rss/bin/python -m unittest discover -s scripts/lis-wiki/tests -v
```

测试使用临时目录和临时 SQLite 数据库，不会触碰生产库。
