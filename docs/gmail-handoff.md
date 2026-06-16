# Gmail 邮件订阅源模块 Handoff 文档

> 交接范围：从初始 commit 到最新提交的完整演进。
> 关键提交：
> - `7089f3d` — 基础框架：IMAP + AppPassword、CRUD API、Scheduler、Config、DB Migration、前端面板
> - `28135e4` — 单个邮件源手动触发抓取接口
> - `62b6225` — LLM 拆分解析：email_parse 任务类型、邮件拆多篇、完整推入 Article Pipeline
> - `156be39` — 修复 markAndDelete 只删已获取 UID，不再删除 INBOX 全部邮件
> - `41a98d1` — 移除 GMAIL_FETCH_HOURS_LOOKBACK 时间过滤，改为仅按 GMAIL_MAX_EMAILS 取最新邮件
> - `618406b` — 修复 resolveSystemPrompt 无 DB 配置时 fallback 到默认提示词，保证 LLM 能正常运行

---

## 1. 模块总览

功能：允许管理员通过 Gmail IMAP（应用专用密码）订阅邮件列表，定时拉取并自动将邮件内容解析为文章存入 `articles` 表，参与常规过滤、翻译等流水线。

入口点：`src/gmail/` 目录 + `src/gmail-scheduler.ts` + API `src/api/routes/gmail-sources.routes.ts`。

---

## 2. 文件结构

```
src/gmail/
  types.ts           — EmailSourceConfig / ParsedEmail / EmailFetchResult 三个核心类型
  imap-client.ts     — 三方库：ImapFlow + mailparser；封装 fetchEmails / markAndDelete / testConnection
  email-processor.ts — 核心流程编排：抓取 → LLM 拆分 → 去重插入 → 异步过滤 → 标记删除

src/gmail-scheduler.ts     — cron 调度器（node-cron），单例，start/stop/fetchAllNow/fetchOneNow
src/api/gmail-sources.ts   — Service 层：CRUD + encryptPassword + testConnection
src/api/routes/gmail-sources.routes.ts — Express 路由：6 个 endpoint
src/api/prompt-variable-builder.ts    — 新增 buildEmailParseVariables(EmailContext)
src/api/system-prompts.ts            — resolveSystemPrompt 支持 email_parse type
src/config/default-prompts/email_parse.md — LLM 默认拆分提示词
src/config.ts                        — gmailFetchEnabled / gmailFetchSchedule / gmailMaxEmails
sql/034_add_email_sources.sql        — 创建 email_sources / email_fetch_logs / 重建 articles + email_source_id 外键
src/views/settings/panel-gmail.ejs   — 前端设置面板（模态框、表格、测试连接按钮、手动触发按钮）
```

---

## 3. 核心流程

1.  kicking off：`GmailScheduler.start()` 按 cron 触发 `runScheduledFetch()`，遍历 `email_sources WHERE status = 'active'`。
2.  单源抓取：`processEmailSource(source)`：
    - IMAP 连接（支持 HTTP 代理 `EMAIL_PROXY_URL` 或 `config.httpProxy`）
    - `buildSearchQuery(targetSenders)` 构造 FROM 过滤器，空 senders 则取全 INBOX
    - 列全 UID，取尾部 `GMAIL_MAX_EMAILS` 个（按 IMAP UID 递增，即最新邮件）
    - 逐封调用 `parseEmailContent(email, userId)` 进行 LLM 拆分；
      若提示词配置缺失，则直接整封作为单篇（降级策略）
    - 对拆分出的每篇文章：
      - 计算 `title_normalized` 去重（基于 `generateNormalizedTitle` 防止 DB 重复）
      - insert 到 `articles`，source_origin='email'
      - 通过 `process.nextTick` 异步启动 `filterArticle` → 若 passed，再 `processArticle`（含翻译/向量化）
    - 收集已处理邮件的 `uid`，完成后调用 `markAndDelete`，仅将这些 uid 加 `\\Deleted` 并关闭邮箱
3.  手动触发：`POST /api/email-sources/:id/fetch`（指定源）与 `POST /api/email-sources/fetch-now`（全量）

---

## 4. 接口清单

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | /api/email-sources | requireAuth | 当前用户全部邮件源 |
| GET | /api/email-sources/:id | requireAuth | 单个邮件源 |
| POST | /api/email-sources | requireAuth + requireAdmin | 创建新的邮件源（密码明文传输，服务端加密） |
| PUT | /api/email-sources/:id | requireAuth + requireAdmin | 更新。密码为空字符串时跳过 |
| DELETE | /api/email-sources/:id | requireAuth + requireAdmin | 删除 |
| POST | /api/email-sources/test | requireAuth | 测试 IMAP 连接 |
| POST | /api/email-sources/:id/fetch | requireAuth + requireAdmin | 手动触发单源 |
| POST | /api/email-sources/fetch-now | requireAuth + requireAdmin | 手动触发全部 |

---

## 5. 数据结构

### email_sources

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | |
| user_id | INTEGER FK users | |
| name | TEXT | 显示名称，如 "Scholar Alerts" |
| email_address | TEXT | 完整的 Gmail 地址 |
| imap_password_encrypted | TEXT | 16 位应用专用密码，加密存储 (llmEncryptionKey) |
| target_senders | TEXT (JSON array) | 只拉取这些发件人。空则为全 INBOX |
| status | TEXT CHECK('active'/'inactive') | |
| last_fetched_at / last_error | DATETIME/TEXT | 状态字段，失败时 writes last_error |

### email_fetch_logs

| 字段 | 说明 |
|------|------|
| email_source_id | 记录归属 |
| status | success / failed |
| emails_found / emails_new | 找到 N 封、新增文章 N 篇（拆分后文章数） |
| error_message / duration_ms | 失败原因、耗时 |

### articles 新增字段

- `email_source_id`（FK email_sources, ON DELETE CASCADE）
- `source_origin` 新增 `'email'` 枚举值，每日总结自动归入 `blog_news` 类别（`src/api/daily-summary.ts` 中已适配，注意 `email` 的 Label 映射）

---

## 6. 配置项

### 环境变量（`.env.example`）

| 名称 | 默认值 | 说明 |
|------|------|------|
| GMAIL_FETCH_ENABLED | true | 全局开关 |
| GMAIL_FETCH_SCHEDULE | '0 4 * * *' | cron，时区 Asia/Shanghai |
| GMAIL_MAX_EMAILS | 20 | 每源每次最多拉取邮件数 |
| GMAIL_PROXY_URL | undefined | IMAP 用的 HTTP CONNECT 代理（与 Telegram 共用） |
| LLM_ENCRYPTION_KEY | **必填** | 用于加密/解密 IMAP 密码的密钥 |

### 任务类型

- `email_parse` 已注册进 `config/types.yaml`，LLM 配置表中若不存在则 `resolveSystemPrompt` 回退至 `email_parse.md` 默认文件，保证即使 admin 未在 DB 初始化 LLM 也能正常调用。

---

## 7. LLM 拆分解析（Commit 62b6225）

- 提示词：`EMAIL_SUBJECT` + `EMAIL_CONTENT`（截断 30000 字符）+ `EMAIL_FROM`
- 返回 JSON：`{"articles": [{"title","summary","content","url","author"}]}`
- 解析失败（JSON 格式校验失败、网络错误等）时的降级：整封邮件作为单篇文章入表。
- 通过 LLM 获取可用（`getUserLLMProvider(userId, 'email_parse')`），这会回退到用户默认 LLM 配置。
- LLM 调用参数：`jsonMode: true`、`temperature: 0.1`。

---

## 8. 已知风险 / 待交接人注意事项

1. **加密密钥一致性**：imap password 用 `llmEncryptionKey` 加密，密钥变更后所有历史邮件源密码失效并需用户重新配置。建议在 `DB 切换密钥` 流程文档中加一节。
2. **邮件去重**：`title_normalized` = `generateNormalizedTitle(title)`，它去除会影响判断的字符并做 Unicode 归一化。若未来改了这个函数，将影响去重边界。
3. **删除邮件语义**：`markAndDelete` 仅删除本轮 `deletedUids`（commit `156be39` 修复），不再涉及 INBOX 其他邮件。开发阶段如果看到"未读全部消失"，应立即检查 UID 是否侵犯了约束。
4. **时间过滤已移除**：已从 `imap-client.ts` 中移除 GMAIL_FETCH_HOURS_LOOKBACK 逻辑，依赖 UID 截断 + MAX_EMAILS 控制。
5. **降级保证**：`resolveSystemPrompt` 没有 DB 配置时总是能 fallback 到 `email_parse.md` 文件的文本（`src/gmail/email-processor.ts:22-28`）。在迁移或 LLM 配置变更时需要确保文件路径不变。
6. **异步处理**：每篇文章的 `filterArticle` → `processArticle` 均在 `process.nextTick` 中运行，纤程内错误做 try-catch 吞掉（只 warn），失败不会影响后续文章。
7. **每日总结关联**：`email` origin 映射到 `blog_news` 源标签，需要 `src/api/daily-summary.ts` 按照 `SOURCE_TYPE_LABELS` 去补充新类型。
8. **Gmail 操作限制**：Gmail IMAP 访问需要在账号开启"允许安全性较低的应用"或生成 **应用专用密码 (App Password)** *两段验证*，否则 IMAP 登录失败。

---

## 9. 测试 / 观察要点

- 新建邮件源：IMAP 连接超时 = 120 秒，可在开发环境里调小（或直接开代理）。
- 拆分解析失败：将实效降级为单篇文章，便于 debugging。
- 日志：
  - `module: 'gmail-imap'` → 连接、搜索 UID 数、解析单封邮件 500ms 级耗时
  - `module: 'gmail-processor'` → 每篇文章的 insert 结果、async filter 错误、最后汇总 success/failed
  - `module: 'gmail-scheduler'` → start/stop、按源遍历结果
  - `module: 'api-routes/gmail-sources'` → 测试/手动触发结果

---

## 10. 关联的其他代码

- `src/constants/source-types.ts`：需确保 `SourceType` 中包含 'email'，且 `SOURCE_TYPE_LABELS['email']` 已配置（日报映射字段应同步更新）。
- `src/api/daily-summary.ts`：自动把 email origin 的文章放入 `blog_news` 类型。
- `src/telegram/` + `src/wechat/`：formatters 内的 `email_count` 字段需要关注显示逻辑。
- `src/middleware/auth.ts`：`requireAdmin` 是部分 endpoint 的权限守门人——非管理员无法执行 POST/PUT/DELETE。

---

## 11. 常见故障排查索引

| 现象 | 排查位置 |
|------|---------|
| "Failed to connect" | `imap-client.ts:119-139`，检查密码 / 代理 |
| 拿到 0 封邮件 | `email-processor.ts:115-121`，COMMIT 41a98d1 后只看 sender 过滤 |
| 邮件出现在 INBOX 依然可见 | markAndDelete 需先 `client.mailboxClose()` 再 unlock，顺序在 `imap-client.ts:104-107` |
| LLM 调用报 500 / 提示词为空 | `email-processor.ts:67-76`，检查 `resolveSystemPrompt` fallback 路径 |
| 邮件插入重复（标题重复）| 确认 `title_normalized` 生成逻辑是否符合预期，否则考虑增加 `UNIQUE(url, user_id)` 复合约束 |
| 邮件内容被截断 | prompt builder 在 `email_parse` 类型中对 content 截断 30000 字符 (`email-processor.ts:64`) |

---

## 12. 交接人应理解的演进顺序

1. **v0（7089f3d）**：建立骨架，IMAP 拉取，Basic CRUD，数据库，定时调度，前端面板，打通 RSS+文章流水线，Telegram/微信通知。
2. **v1（28135e4）**：在 Web UI 补充"手动抓取"按钮，加 API 接口，用户不需要等 cron 就能马上生效。
3. **v2（62b6225）**：核心能力升级，一封邮件变成 n 篇文章，通过 LLM 完成结构化，全部进入自动过滤/翻译流水线。
4. **v3（156be39）**：安全性修复，防止误删其他邮件，只操作本轮拿到 UID 的邮件。
5. **v4（41a98d1）**：简化逻辑，去掉时间区间约束，依赖 UID 截断 + maxEmails 均衡控制。
6. **v5（618406b）**：韧性增强，即使 LLM 配置还没写入 DB，也能 fallback 到文件级默认提示词，不会一开工就崩。

---

*Document generated from commit history + source code walkthrough on 2026-06-16.*
