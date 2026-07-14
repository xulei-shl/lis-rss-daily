# LIS-RSS Literature Tracker — Handoff 文档索引

> 本目录是面向接手者（新工程师 / AI Agent）的**交接文档集**，所有内容均基于**实际源代码逐文件阅读**编写（分析时间：2026-07-13，主分支）。
>
> 与仓库根目录的 `项目技术报告-基于实际代码分析.md`（2026-05 版本）相比，本文档集**修正了大量已过时的描述**。凡是与旧报告冲突之处，**以本文档 + 实际代码为准**，每篇文档末尾都列有「与旧报告的差异」小节。

## 阅读方式

- 每篇文档聚焦一个功能模块，独立成篇，可单独交接。
- 关键结论均带 `文件:行号` 引用，便于直接跳转到源码核对。
- 引用的行号基于分析时的主分支快照，代码变动后可能有偏移，请以符号名（函数/类/常量名）为准。

## 项目一句话概述

自动从 **RSS / 期刊爬虫 / 关键词订阅 / Gmail 邮件** 四类来源抓取学术文献 → LLM **单领域**智能过滤 → 按需翻译 → 向量化（ChromaDB）→ 语义 / 关键词 / 混合 / 相关检索 → Telegram / 企业微信推送 + 每日总结 + 定期洞察报告。技术栈：Node.js 20 + TypeScript(ESM)、Express 5、better-sqlite3 + Kysely、ChromaDB、node-cron、EJS、Python 爬虫子进程。

## 系统数据流总览

```
[RSS] [期刊(Python)] [关键词(Python)] [Gmail(IMAP+LLM拆分)]
   │        │               │                │
   └────────┴───────┬───────┴────────────────┘
                    ▼  saveArticles() → articles 表 (source_origin=rss/journal/keyword/email)
                    ▼  每个源携带 domain_id（绑定单个主题领域）
             filterArticle(FilterInput)  ── Stage0 黑名单(YAML子串) → Stage1 LLM 单领域评估
                    │  passed?
        ┌───────────┴───────────┐
      rejected                passed
     (流程结束)                 ▼
                    processArticle() 4 阶段流水线
                    markdown → translate(仅英文,可重试) → vector(ChromaDB) → related
                    │  完成后 fire-and-forget:
                    │   • Telegram 新文章推送
                    │   • 相关文章增量刷新(topN=10,minScore=0.5)
                    ▼
   语义/关键词/混合/相关检索(search-service) + 每日总结 + 洞察报告 + DeepSearch
```

## 文档清单

| # | 文档 | 覆盖范围 | 关键源文件 |
|---|------|----------|-----------|
| 00 | 本文件 `README.md` | 索引 / 总览 / 数据流 | `src/index.ts` |
| 01 | [数据采集子系统](./01-data-collection.md) | RSS / 期刊 / 关键词 / Gmail 四源采集、Python 爬虫、去重、domain_id 绑定 | `rss-scheduler.ts` `journal-scheduler.ts` `keyword-scheduler.ts` `gmail-scheduler.ts` `spiders/` `gmail/` |
| 02 | [LLM 智能过滤子系统](./02-llm-filter.md) | 黑名单 + LLM 单领域评估、主题领域/关键词、系统提示词、过滤日志 | `filter.ts` `config/blacklist-*.ts` `api/topic-*.ts` `api/system-prompts.ts` `api/prompt-variable-builder.ts` |
| 03 | [文章处理流水线](./03-article-pipeline.md) | 4 阶段流水线、语言检测/翻译、重试、相关文章增量刷新、导出、抓取 | `pipeline.ts` `agent.ts` `api/articles-refresh.ts` `related-scheduler.ts` `scraper.ts` `export.ts` |
| 04 | [向量检索子系统](./04-vector-search.md) | ChromaDB 连接、embedding、索引队列、rerank、四种检索模式与融合 | `vector/*.ts`（`chroma-client` `embedding-client` `indexer` `reranker` `text-builder` `search-service`）|
| 05 | [LLM 抽象层与工具库](./05-llm-abstraction.md) | LLMProvider、故障转移、限流、加密、JSON 解析、config、任务类型 | `llm.ts` `llm-logger.ts` `api/llm-configs.ts` `utils/*.ts` `config.ts` |
| 06 | [通知与调度子系统](./06-notifications-scheduling.md) | Telegram Bot、企业微信、每日总结、洞察报告、调度器状态 | `telegram/*.ts` `wechat/*.ts` `daily-summary-scheduler.ts` `insights-scheduler.ts` `api/daily-summary.ts` |
| 07 | [Web/API、认证、数据库与前端](./07-web-api-auth-db-frontend.md) | Express 装配、路由表、JWT/角色、Kysely+SQLite 表结构、DeepSearch、EJS 前端 | `api/web.ts` `api/routes.ts` `middleware/auth.ts` `db.ts` `sql/001_init.sql` `views/` `public/` |
| 08 | [自动清理拒绝文章（规划文档）](./08-rejected-cleanup.md) | 归档表设计、调度器、源字段控制、迁移计划（尚未实现） | `rejected-cleanup-scheduler.ts` `sql/038_add_auto_cleanup_rejected.sql` `rejected_articles` 表 |

## 全局约定与要点（各模块通用）

- **多来源统一到 `articles` 单表**：四类来源分别通过 `rss_source_id / journal_id / keyword_id / email_source_id` 外键关联，`source_origin ∈ ('rss','journal','keyword','email')`。
- **`domain_id` 绑定（2026-07-13 变更）**：四张源表均新增 `domain_id NOT NULL REFERENCES topic_domains(id)`。过滤时**只评估该源绑定的单个领域**，不再遍历全部活跃领域。见文档 01 / 02。
- **多租户现状**：数据层带 `user_id`，但多处调度器（related / daily-summary / insights / telegram bot manager）**硬编码 `userId = 1`**（管理员），多租户尚未完全落地。⚠️ 例外：期刊 `JournalScheduler.triggerAutoFilter` 现已从查询结果取真实 `user_id`（不再硬编码 1）。
- **调度器基类化（2026-07-14）**：全部 8 个调度器（RSS / 期刊 / 关键词 / Gmail / 每日总结 / 洞察 / 相关文章 / 拒绝清理）均已继承 `src/utils/base-scheduler.ts` 的 `BaseScheduler`，统一了 `start()` / `stop()` / cron 校验 / 时区 / `pollWhile()` 等待逻辑，单例工厂模式保留在各子类。
- **API Key 加密**：`llm_configs.api_key_encrypted`、Gmail IMAP 密码均用 **AES-256-GCM** 加密，密钥来自 `config.llmEncryptionKey`（`LLM_ENCRYPTION_KEY`）。见文档 05。
- **默认账号**：`admin/admin123`（管理员，SHA256）、`guest/cc@7007`（只读）。生产必须改 `JWT_SECRET` 与 `LLM_ENCRYPTION_KEY`。
- **时区**：默认 `Asia/Shanghai`，所有 node-cron 调度器均显式指定。

## 已知遗留 / 待办（跨模块汇总）

以下均为**实际代码验证过**的偏差或未接线项，接手时请注意：

1. RSS 调度默认 cron 用的是 `config.rssFetchSchedule`（默认 `0 2 * * *`），`settings.rss_fetch_schedule`（默认 `0 9 * * *`）**未被调度器消费**。
2. 关键词源 `spider_type='cnki'` 校验通过并入库，但 `crawlKeyword` **始终调用 Google Scholar 爬虫**，CNKI 关键词路径未实现。
3. `scraper.ts`（Playwright + Defuddle 全文抓取）与 `export.ts`（Markdown 导出）**存在但未被流水线接线**（已加 `@deprecated` 注释标明死代码）。
4. ~~`agent.ts` 的 `TranslationResult` 回退路径引用了接口中不存在的 `titleZh` 字段（潜在小 bug）~~ **已修复（2026-07-14）**：`TranslationResult` 现声明 `titleZh?`，流水线 `runStageTranslate` 也落 `title_zh`（见文档 03 / 05）。`title_zh` 不再恒为 `null`。
5. ~~Google Scholar 爬虫路径 `google-scholar-spider.ts` **硬编码** `/opt/lis-rss-daily/src/spiders/google_scholar`~~ **已修复（2026-07-14）**：改为 `path.join(__dirname, 'google_scholar')`。⚠️ 残留：`python-spider-runner.ts:55` 的 Python 解释器候选路径仍硬编码 `/home/xulei/.pyenvs/env_camoufox/bin/python`（由 `resolvePythonPath` 动态解析兜底，非 cwd，优先级较低）。
6. `config.ts` **不含** chroma host/port 与检索权重字段。**部分缓解（2026-07-14）**：`config.ts` 现新增 `chromaHost`（`CHROMA_HOST`，默认 `127.0.0.1`）/ `chromaPort`（`CHROMA_PORT`，默认 `8000`），`getChromaSettings` 优先读 `settings` 表、回退到 `config`；检索权重仍在 `search-service.ts` 常量。
7. ~~`build-css.js` 输出 `main.bundle.css`，而 `layout.ejs` 开发态引用 `/css/main.css`，命名需核对~~ **已修复（2026-07-14）**：`layout.ejs` 现引用 `/css/main.bundle.css`（开发）与 `/css/main.bundle.min.css`（生产），与 `build-css.js` 产物对齐。
8. **已实现**：自动清理拒绝文章（`rejected-cleanup-scheduler.ts`）— 见文档 08，调度器现已继承 `BaseScheduler`。

> **近期重构（2026-07-14）**：依据 `docs/code-review-standards.md` 与 `docs/代码审查-实施计划.md` 完成了 5 个阶段重构（phase-0~4 + 收尾）。核心变更：**8 个调度器基类化（`BaseScheduler`）**、`sleep()`/EmailSourceConfig 映射/`serializeError` 统一、Telegram `sendToChats` 与微信 `sendToWebhooks`/`sendByPushType` 通知去重、`daily-summary.ts` 拆分为 generator/repository/facade 且推送逻辑移出生成函数、`bot.ts` 拆分为 callbacks/commands/facade、`runPipeline` 拆为 4 个 stage 方法、N+1 优化、`search-service.ts` 提取 `createArticlesQuery` 消除 Shotgun Surgery、Chroma host/port 配置化、`agent.ts` `titleZh` 修复。各模块 handoff 文档已同步更新「近期重构」差异小节。
