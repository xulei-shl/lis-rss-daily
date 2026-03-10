# 企业微信推送功能实现计划

## Context

项目已有推送功能：
1. **Telegram 推送**支持2类：
   - 每日总结（通过的期刊总结 + 通过的资讯总结）
   - 新增文章推送
2. **数据库表 `daily_summaries** 存储总结历史**

用户希望新增企业微信推送功能，支持3类推送：
1. 每日总结（通过的期刊/资讯）
2. 每日全部期刊总结（所有今日新增期刊，无论是否通过）
3. 新增文章推送

每个 webhook 配置需要独立的推送类型开关。配置保存在 `config/wechat.yaml` 文件中。

---

## 实现方案

### Phase 1: 基础设施（配置管理）

#### 1.1 创建配置文件
**文件**: `config/wechat.yaml`
```yaml
# 企业微信推送配置
version: "1.0"

webhooks:
  - id: "webhook-001"
    name: "工作群"
    url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
    enabled: true
    # 推送类型开关
    push_types:
      daily_summary: true    # 每日总结（通过的期刊/资讯）
      journal_all: true      # 每日全部期刊总结
      new_articles: true     # 新增文章推送
    created_at: "2026-03-09T00:00:00Z"

metadata:
  created_at: "2026-03-09T00:00:00Z"
  updated_at: "2026-03-09T00:00:00Z"
  schema_version: "1.0"
```

#### 1.2 实现配置管理模块
**文件**: `src/config/wechat-config.ts`
- 参考 `src/config/types-config.ts` 的实现模式
- 提供 webhooks 的 CRUD 操作：
  - `getWeChatWebhooks()` - 获取所有 webhook
  - `getActiveWeChatWebhooks()` - 获取启用的 webhook
  - `addWeChatWebhook()` - 添加 webhook
  - `updateWeChatWebhook()` - 更新 webhook
  - `deleteWeChatWebhook()` - 删除 webhook
- 使用单例缓存优化性能
- 自动创建默认配置文件
- Webhook 配置包含 push_types 对象（3个推送类型的开关）

---

### Phase 2: 企业微信推送模块

#### 2.1 实现企业微信客户端
**文件**: `src/wechat/client.ts`
- 参考 `docs/企业微信/wechat_push-demo.py` 的实现
- 实现 `WeChatClient` 类：
  - `sendMarkdown(content: string): Promise<boolean>` - 发送 Markdown 消息
  - `testConnection(): Promise<boolean>` - 测试连接
- 使用 axios 发送 HTTP POST 请求
- Webhook URL 格式：`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx`
- 消息格式：`{ msgtype: "markdown", markdown: { content } }`
- 处理超时和错误情况

#### 2.2 实现消息格式化器
**文件**: `src/wechat/formatters.ts`
- 实现 `formatDailySummary(data)` - 每日总结格式化（通过的期刊/资讯）
- 实现 `formatJournalAllSummary(data)` - 全部期刊总结格式化
- 实现 `formatNewArticle(data)` - 新增文章通知格式化
- 共同特性：
  - 生成 Markdown 格式消息
  - 消息长度限制：4096 字节
  - 超长时自动截断

**每日总结格式**：
- 标题：`# 📅 每日总结`
- 统计：日期、通过的期刊数、资讯数
- 内容：LLM 生成的总结

**全部期刊总结格式**：
- 标题：`# 📚 期刊文章每日总结`
- 统计：日期、文章总数（包括未通过的）
- 内容：LLM 生成的总结
- 文章列表：最多 20 篇，包含标题、来源、链接

**新增文章格式**：
- 标题：`# 🆕 新增文章`
- 文章信息：标题、来源、链接
- 内容预览：markdown_content 或 summary

#### 2.3 实现通知器
**文件**: `src/wechat/index.ts`
- 参考 `src/telegram/index.ts` 的单例模式
- 实现 `WeChatNotifier` 类：
  - `sendDailySummary(userId, data)` - 发送每日总结（通过的期刊/资讯）
  - `sendJournalAllSummary(userId, data)` - 发送全部期刊总结
  - `sendNewArticle(userId, data)` - 发送新增文章通知
- 每个方法会：
  1. 获取所有启用的 webhook
  2. 过滤出启用了对应推送类型的 webhook
  3. 格式化消息
  4. 逐个发送到 webhook
- 单例实例管理：`getWeChatNotifier()`
- 异步推送，失败时记录日志但不阻塞主流程

---

### Phase 3: 扩展每日总结服务

#### 3.1 扩展总结类型和数据库表结构
**文件**: `src/api/daily-summary.ts` 和 `src/db.ts`
- 在 `SummaryType` 中添加 `'journal_all'` 类型（全部期刊总结）
- 当前类型：`'journal' | 'blog_news' | 'all' | 'search' | 'journal_all'`
  - `journal_all` 新增，用于保存全部期刊总结到数据库
  - `wechat_journal` 不是数据库类型，仅用于推送区分
- 更新 `src/db.ts` 中的 `DailySummariesTable` 类型，将 `summary_type` 字段类型更新为包含 `'journal_all'`

#### 3.1.1 数据库存储说明
**表**: `daily_summaries`
- `summary_type`: 使用 `'journal_all'` 标识全部期刊总结
- `summary_content`: 存储 LLM 生成的总结内容（Markdown格式）
- `articles_data`: 存储期刊文章列表（JSON格式），结构为：
  ```json
  {"journal": [...期刊文章列表...], "blog": [], "news": []}
  ```
- 与现有 `journal` 类型的区别：`journal_all` 包含所有期刊文章（无论 `filter_status` 是否通过）

#### 3.2 实现获取所有期刊文章函数
**文件**: `src/api/daily-summary.ts`
- 新增 `getAllJournalArticles(userId, dateStr)` 函数
- 与 `getDailyPassedArticles()` 类似，但：
  - 不筛选 `filter_status`（包括未通过的文章）
  - 只获取 `source_origin` 为 'journal' 或 'keyword' 的文章
  - 或 RSS 源类型为 'journal' 的文章
- 限制最多 50 篇

#### 3.3 实现全部期刊总结生成函数（完全复用现有逻辑）
**文件**: `src/api/daily-summary.ts`
- 新增 `generateJournalAllSummary(userId, date?)` 函数
- **完全复用现有逻辑**，仅修改文章来源：
  1. 调用 `getAllJournalArticles()` 获取所有期刊文章（不筛选 filter_status）
  2. 按类型分组（复用现有逻辑）
  3. 调用 `buildArticlesListText()` 构建文章列表文本（复用）
  4. 调用 `resolveSystemPrompt()` 获取系统提示词（复用，不改）
     - 使用 `daily_summary` 类型
     - 传入变量：`{ ARTICLES_LIST: articlesText, DATE_RANGE: today }`
  5. 调用 `getUserLLMProvider()` 获取 LLM（复用）
  6. 调用 LLM 生成总结（复用 chat 方法）
  7. 调用 `saveDailySummary()` 保存到数据库（`journal_all` 类型）
  8. 异步调用 `getWeChatNotifier().sendJournalAllSummary()`
- **关键区别**：仅 `getAllJournalArticles()` 与 `getDailyPassedArticles()` 不同

#### 3.4 集成企业微信推送
**文件**: `src/api/daily-summary.ts`
- 修改 `generateDailySummary()` 函数：
  - 在推送到 Telegram 后，添加企业微信推送
  - 调用 `getWeChatNotifier().sendDailySummary()`
- 新增文章推送钩子（可能需要修改文章创建/更新流程）
  - 当新文章添加时，调用 `getWeChatNotifier().sendNewArticle()`

---

### Phase 4: API 路由

#### 4.1 创建企业微信 API 路由
**文件**: `src/api/routes/wechat.routes.ts`
- `GET /api/wechat/webhooks` - 获取所有 webhooks
- `POST /api/wechat/webhooks` - 添加 webhook（需要 admin 权限）
  - 验证：name、url 不能为空
  - 验证：URL 必须包含 `qyapi.weixin.qq.com/cgi-bin/webhook/send`
- `PUT /api/wechat/webhooks/:id` - 更新 webhook（需要 admin 权限）
- `DELETE /api/wechat/webhooks/:id` - 删除 webhook（需要 admin 权限）
- `POST /api/wechat/test` - 测试 webhook 发送（需要 admin 权限）

#### 4.2 注册路由
**文件**: `src/index.ts`（或主应用文件）
```typescript
import wechatRoutes from './api/routes/wechat.routes.js';
app.use('/api', wechatRoutes);
```

#### 4.3 更新 CLI 端点
**文件**: `src/api/routes/daily-summary.routes.ts`
- 在 `generateAll` 逻辑中添加 `'wechat_journal'` 类型
- 支持通过 CLI 触发新类型的总结生成

---

### Phase 5: 前端实现

#### 5.1 创建企业微信设置面板
**文件**: `src/views/settings/panel-wechat.ejs`
- 参考 `src/views/settings/panel-telegram.ejs` 的 UI 结构
- 组件：
  - Section Header：标题和帮助链接
  - Webhook 列表：显示已配置的 webhook
  - 添加 Webhook 按钮
- 每个 webhook 显示：
  - 名称（加粗）
  - URL（小字）
  - 推送类型标签：每日总结、全部期刊、新增文章
  - 操作按钮：测试、编辑、删除
  - 启用状态（视觉区分）
- 模态框：
  - 名称输入框
  - Webhook URL 输入框
  - **推送类型复选框**（3个）：
    - ☑ 接收每日总结
    - ☑ 接收全部期刊总结
    - ☑ 接收新增文章
  - 启用复选框
  - 保存/取消按钮

#### 5.2 创建前端 JavaScript
**文件**: `src/public/js/wechat-settings.js`
- 功能：
  - `loadWeChatWebhooks()` - 加载并渲染 webhook 列表
  - `renderWeChatWebhooks()` - 渲染列表 HTML
  - `openWeChatWebhookModal()` - 打开添加/编辑模态框
  - `closeWeChatWebhookModal()` - 关闭模态框
  - 添加/编辑 webhook 表单提交处理
  - `editWeChatWebhook()` - 编辑 webhook
  - `deleteWeChatWebhook()` - 删除 webhook（带确认）
  - `testWeChatWebhook()` - 测试 webhook
  - `escapeHtml()` - XSS 防护
- 页面加载时自动调用 `loadWeChatWebhooks()`

#### 5.3 更新设置页面
**文件**: `src/views/settings/body.ejs`
- 在 `<div class="settings-tabs">` 中添加：
  ```ejs
  <button class="settings-tab" data-tab="wechat">企业微信推送</button>
  ```
- 在面板包含区域添加：
  ```ejs
  <%- include('panel-wechat') %>
  ```
- 在 scripts 区域添加：
  ```ejs
  <script src="/js/wechat-settings.js"></script>
  ```

---

### Phase 6: 集成与测试

#### 6.1 在总结生成流程中集成推送
**文件**: `src/api/daily-summary.ts`
- 修改 `generateDailySummary()` 函数：
  - 在推送到 Telegram 后，添加企业微信推送
  - 调用 `getWeChatNotifier().sendDailySummary(userId, data)`
- 在 `generateJournalAllSummary()` 中：
  - 保存到数据库后，调用 `getWeChatNotifier().sendJournalAllSummary(userId, data)`
- 新增文章推送（可能需要修改文章创建流程）：
  - 找到触发新增文章推送的位置
  - 添加 `getWeChatNotifier().sendNewArticle(userId, data)` 调用

#### 6.2 验证配置文件读写
- 创建 `config/wechat.yaml` 文件
- 通过设置页面添加 webhook
- 验证文件内容正确保存
- 重启应用后验证配置正确加载

#### 6.3 测试企业微信推送
- 在设置页面添加有效的 webhook URL
- 点击"测试"按钮
- 在企业微信群中验证收到测试消息
- 验证 Markdown 格式正确渲染

#### 6.4 测试每日总结推送
- 手动触发每日总结（journal/blog_news/all）
- 验证企业微信收到推送消息
- 验证消息包含：
  - 日期、统计信息（通过的期刊数、资讯数）
  - LLM 生成的总结内容

#### 6.5 测试全部期刊总结推送
- 手动触发 `journal_all` 类型总结
- 验证总结包含所有期刊文章（包括未通过的）
- 验证企业微信收到推送消息
- 验证消息包含：
  - 日期、统计信息（文章总数）
  - LLM 生成的总结内容
  - 文章列表（最多 20 篇）

#### 6.6 测试新增文章推送
- 创建新文章（或触发文章添加事件）
- 验证企业微信收到新增文章通知
- 验证消息包含：
  - 文章标题、来源
  - 文章链接
  - 内容预览

#### 6.7 测试推送类型过滤
- 创建多个 webhook，配置不同的推送类型组合
- Webhook A：仅启用"每日总结"
- Webhook B：仅启用"全部期刊总结"
- Webhook C：仅启用"新增文章"
- Webhook D：全部启用
- 触发各类推送，验证每个 webhook 只收到启用的类型

#### 6.8 测试边界情况
- 无 webhook 配置时不应报错
- 所有 webhook 禁用时不应发送消息
- 消息超过 4096 字节时应截断
- 网络错误时应记录日志但不影响主流程
- webhook URL 格式不正确时应拒绝保存

---

## 关键文件路径

### 新增文件
- `config/wechat.yaml` - 企业微信配置文件
- `src/config/wechat-config.ts` - 配置管理模块
- `src/wechat/client.ts` - 企业微信 HTTP 客户端
- `src/wechat/formatters.ts` - 消息格式化器
- `src/wechat/index.ts` - 企业微信通知器
- `src/api/routes/wechat.routes.ts` - API 路由
- `src/views/settings/panel-wechat.ejs` - 设置页面面板
- `src/public/js/wechat-settings.js` - 前端 JavaScript

### 修改文件
- `src/api/daily-summary.ts` - 添加新的总结类型和函数
- `src/api/routes/daily-summary.routes.ts` - 更新 CLI 支持
- `src/views/settings/body.ejs` - 添加新 tab
- `src/index.ts`（或主应用文件）- 注册路由

### 参考文件
- `src/config/types-config.ts` - 配置管理模式参考
- `src/telegram/index.ts` - 通知器模式参考
- `src/views/settings/panel-telegram.ejs` - UI 结构参考
- `docs/企业微信/wechat_push-demo.py` - API 调用参考

---

## 实施步骤

1. 创建 `config/wechat.yaml` 配置文件（包含 push_types 字段）
2. 实现 `src/config/wechat-config.ts` 配置管理模块（支持推送类型开关）
3. 实现 `src/wechat/client.ts` HTTP 客户端
4. 实现 `src/wechat/formatters.ts` 消息格式化器（3种格式）
5. 实现 `src/wechat/index.ts` 通知器（3个推送方法）
6. 扩展 `src/api/daily-summary.ts`：
   - 添加 `journal_all` 总结类型
   - 实现 `getAllJournalArticles()` 函数
   - 实现 `generateJournalAllSummary()` 函数
   - 集成企业微信推送到现有流程
7. 创建 `src/api/routes/wechat.routes.ts` API 路由
8. 注册路由到主应用
9. 创建 `src/views/settings/panel-wechat.ejs` 设置页面（含推送类型复选框）
10. 创建 `src/public/js/wechat-settings.js` 前端逻辑
11. 更新 `src/views/settings/body.ejs` 添加 tab
12. 测试配置管理功能
13. 测试3种类型的推送功能
14. 测试推送类型过滤（每个 webhook 的独立开关）
15. 验证边界情况处理
