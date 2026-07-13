# 订阅源绑定主题领域

> 2026-07-13

## 背景

每个订阅源（RSS/期刊/关键词/邮件）可独立绑定一个主题领域，过滤时 LLM 只对该领域的主题词进行评估，不再对所有活跃领域逐一判断。

## 变更内容

### 数据库

- `rss_sources`、`journals`、`keyword_subscriptions`、`email_sources` 各新增 `domain_id INTEGER NOT NULL REFERENCES topic_domains(id)` 列
- 迁移脚本 `sql/037_add_domain_id_to_sources.sql`：已有行自动回填用户优先级最高的活跃领域 ID
- `sql/001_init.sql` 同步更新 `CREATE TABLE`

### 后端过滤逻辑 (`src/filter.ts`)

- `FilterInput` 新增可选 `sourceDomainId?: number`
- `llmFilter()` 改为**单领域评估**：
  - 优先使用传入的 `sourceDomainId`
  - 未传时通过 `getArticleSourceDomainId(articleId)` 反查源表获取
  - 不再有多领域遍历路径
- `buildDomainsInfo()` 新增可选 `domainId` 参数，只查单个领域

### 工具函数 (`src/api/topic-domains.ts`)

- 新增 `getArticleSourceDomainId(articleId)`：根据文章的 `source_origin` + 对应外键（`rss_source_id`/`journal_id`/`keyword_id`/`email_source_id`）反查源表的 `domain_id`

### 调度器

- `rss-scheduler.ts`：JOIN 查询 `domain_id` 传入
- `journal-scheduler.ts`：JOIN 查询 `domain_id` 传入
- `api/keywords.ts`：JOIN 查询 `domain_id` 传入
- `gmail/email-processor.ts`：读取 `source.domainId` 传入
- `api/article-process.ts`、`cleanup-unfiltered-articles.ts`：不传，`llmFilter` 内部反查

### 创建/更新接口

所有 4 种源的 create/update 路由和 service 层新增 `domainId` 入参：

| 路由 | 动作 |
|------|------|
| `POST /api/rss-sources` | + `domainId` |
| `PUT /api/rss-sources/:id` | + `domainId` |
| `POST /api/journals` | + `domainId` |
| `PUT /api/journals/:id` | + `domainId` |
| `POST /api/keywords` | + `domainId` |
| `PUT /api/keywords/:id` | + `domainId` |
| `POST /api/email-sources` | + `domainId` |
| `PUT /api/email-sources/:id` | + `domainId` |

未传 `domainId` 时，默认取用户优先级最高的活跃领域。

### 前端

- **列表页**：RSS/期刊/关键词/邮件 4 个列表各新增"领域"列
- **表单弹窗**：4 个新增/编辑弹窗各新增"主题领域"下拉框，数据从 `/api/topic-domains` 动态加载
- **全局函数**：`loadTopicDomains()`、`renderDomainSelect()`、`getDomainName()` 供所有表单共享

## 涉及文件

```
sql/037_add_domain_id_to_sources.sql          (新增)
sql/001_init.sql                                (修改)
scripts/migrate.ts                              (修改)
src/db.ts                                       (修改)
src/api/topic-domains.ts                        (修改)
src/api/prompt-variable-builder.ts              (修改)
src/filter.ts                                   (修改)
src/rss-scheduler.ts                            (修改)
src/journal-scheduler.ts                        (修改)
src/api/keywords.ts                             (修改)
src/gmail/types.ts                              (修改)
src/gmail-scheduler.ts                          (修改)
src/gmail/email-processor.ts                    (修改)
src/api/rss-sources.ts                          (修改)
src/api/journals.ts                             (修改)
src/api/gmail-sources.ts                        (修改)
src/api/routes/rss-sources.routes.ts            (修改)
src/api/routes/journals.routes.ts               (修改)
src/api/routes/keywords.routes.ts               (修改)
src/api/routes/gmail-sources.routes.ts          (修改)
src/views/settings/body.ejs                     (修改)
src/views/settings/panel-rss.ejs                (修改)
src/views/settings/panel-journals.ejs           (修改)
src/views/settings/panel-keywords.ejs           (修改)
src/views/settings/panel-gmail.ejs              (修改)
src/views/settings/modals.ejs                   (修改)
src/public/js/settings.js                       (修改)
```