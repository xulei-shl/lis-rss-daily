已根据当前代码梳理出大模型相关逻辑与表关系，结论如下。

**1) llm.ts 的配置与系统提示词逻辑，以及 system_prompts 的关系**

- LLM 配置来源：优先从 `llm_configs` 取用户活跃配置（默认优先），取不到就回退到环境变量。实现位置：`src/llm.ts` + `src/api/llm-configs.ts`。  
  - 入口：`getUserLLMProvider(userId)` → `getActiveLLMConfig(userId)` → 组装配置 → 选择 provider。  
  - 回退：`getLLM()` 使用环境变量（`LLM_PROVIDER/OPENAI_* / GEMINI_*`）。  
  - 参考：`src/llm.ts`、`src/api/llm-configs.ts`、`src/config.ts`。

- 系统提示词来源：当前运行时 **已从 `system_prompts` 表读取并渲染**，没有对应模板时才回退硬编码。  
  - 摘要/关键词/翻译：`src/agent.ts` 按 `summary/keywords/translation` 类型读取模板并渲染变量；无模板或模板为空则回退内置提示词。  
  - 过滤阶段：`src/filter.ts` 按 `filter` 类型读取模板并渲染变量；无模板时回退动态拼装提示词。  
  - 参考：`src/agent.ts`、`src/filter.ts`、`src/api/system-prompts.ts`。

- `system_prompts` 表：数据库里存在且在 `sql/001_init.sql` 有默认模板插入，**运行时已接入**。  
  - 新增“初始化默认模板”能力，会在缺失时补齐 `filter/summary/keywords/translation` 四类模板并启用。  
  - 参考：`sql/001_init.sql`、`src/db.ts`、`src/api/system-prompts.ts`、`src/api/routes/system-prompts.routes.ts`。

结论：  
`system_prompts` 已接入运行时，实际调用优先使用模板，缺失时回退硬编码/动态拼装。

---

**2) RSS 新文献过滤的系统提示词是否来自 topic_domains/topic_keywords**

是的，**过滤提示词仍然从这两张表提取并拼装**，并作为 `system_prompts` 的默认回退内容。流程如下：

- `filterArticle()` → `llmFilter()`  
- `llmFilter()` 会拿到“命中的领域或全部领域”  
- `buildFilterSystemPrompt()` 把 `topic_domains` + `topic_keywords` 的信息拼进系统提示词（包括：领域ID/名称/描述/关键词/权重/关键词描述）  
- 然后构造 `system` + `user` 消息给 LLM  
- 参考：`src/filter.ts`

因此你提到的“系统提示词需要从 topic_domains 和 topic_keywords 表中提取数据构成”，**当前实现已满足**：  
- 优先使用 `system_prompts` 的 `filter` 模板（渲染变量）  
- 模板缺失时回退为 `filter.ts` 内部拼装

---

**3) 现阶段的大模型相关逻辑总览（按模块）**

- **LLM 客户端封装**：  
  - `src/llm.ts`  
  - 支持 OpenAI 兼容 / Gemini  
  - DB 配置优先，环境变量兜底

- **文章过滤（RSS 过滤）**：  
  - `src/filter.ts`  
  - 关键词预筛 → LLM 精筛（JSON 模式）→ 失败则关键词兜底  
  - 系统提示词：优先读取 `system_prompts(filter)` 并渲染变量；缺失时动态拼装（领域/关键词/权重/描述）  

- **文章分析（摘要/关键词/翻译）**：  
  - `src/agent.ts`  
  - 系统提示词：优先读取 `system_prompts(summary/keywords/translation)` 并渲染变量；缺失时回退硬编码  
  - 使用 `llm.chat`，JSON 模式用于关键词/翻译  

- **流程衔接**：  
  - `src/pipeline.ts` 在文章通过过滤后触发分析  
  - 关键词与翻译写回数据库  

- **LLM 配置表用途**：  
  - `llm_configs`：LLM/Embedding/Rerank 三类配置统一管理  
  - LLM：`getActiveLLMConfig` → `getUserLLMProvider`  
  - Embedding：`src/vector/embedding-client.ts`  
  - Rerank：`src/vector/reranker.ts`

---

**4) 设置页与系统提示词管理更新（本次变更）**

- **设置页重构为 Tab**：  
  - 入口文件：`src/views/settings.ejs`  
  - 新增 Tab：`RSS 订阅源 / LLM 配置 / Chroma 设置 / 系统提示词`  
  - 默认停在“RSS 订阅源”，点击切换仅前端显示，不影响现有路由  

- **系统提示词 CRUD 与初始化（后端）**：  
  - 服务层：`src/api/system-prompts.ts`  
  - 路由层：`src/api/routes/system-prompts.routes.ts`  
  - 路由聚合：`src/api/routes.ts`  
  - 提供接口：  
    - `GET /api/system-prompts`  
    - `GET /api/system-prompts/:id`  
    - `POST /api/system-prompts`  
    - `PUT /api/system-prompts/:id`  
    - `DELETE /api/system-prompts/:id`  
    - `POST /api/system-prompts/bootstrap`  
  - `variables` 支持 JSON 字符串或对象，服务端校验 JSON 合法性  
  - `is_active` 支持启用/禁用切换  
  - `bootstrap`：当缺失时自动补齐四类默认模板并启用  

- **系统提示词管理 UI（前端）**：  
  - 表格字段：名称、类型、启用、更新时间、操作  
  - 弹窗字段：名称、类型、模板、变量(JSON)、启用  
  - 动态变量提示：按类型展示 `{{VAR}}` 占位符提示  
  - 新增按钮：初始化默认模板（仅补齐缺失类型，不覆盖已有模板）  

- **当前接入状态**：
  - 已完成系统提示词管理、持久化与运行时接入
  - 运行时按类型优先读取模板，缺失则回退硬编码/动态拼装

---

**5) 系统提示词变量定义统一管理（2025-02 优化）**

为了解决变量定义在多处硬编码、需手动同步维护的问题，引入了单一数据源（Single Source of Truth）机制：

- **统一变量定义文件**：
  - 位置：`src/config/system-prompt-variables.ts`
  - 定义了 `PROMPT_VARIABLES` 常量，按类型（filter/summary/keywords/translation）分组
  - 每个变量包含：
    - `description`：变量说明（中文）
    - `source`：数据来源说明（如 "articles.title" 或 "从 topic_domains 表动态构建"）
    - `required`：是否必需（布尔值）

- **后端改进**：
  - `src/api/system-prompts.ts`：默认模板初始化时使用 `variablesToJSON(type)` 从统一定义生成
  - `src/api/routes/system-prompts.routes.ts`：新增 `GET /api/system-prompts/variables` 接口返回变量定义

- **前端改进**：
  - `src/public/js/settings.js`：删除硬编码的 `promptVariableHints`，改为从 API 获取
  - UI 提示升级：不仅显示变量名，还显示说明和数据来源
  - 必需变量标注：带 `*必需` 标记

- **新增变量流程**：
  1. 在 `src/config/system-prompt-variables.ts` 添加变量定义
  2. 在 `src/filter.ts` 或 `src/agent.ts` 的 `resolveSystemPrompt()` 调用中传入变量值
  3. 前端自动显示新变量，无需修改前端代码

- **变量来源汇总**：
  | 变量 | 数据来源 | 涉及表 |
  |------|---------|-------|
  | `{{TOPIC_DOMAINS}}` | 运行时从数据库查询 + 格式化 | `topic_domains` + `topic_keywords` |
  | `{{ARTICLE_TITLE}}` | 直接读取 | `articles.title` |
  | `{{ARTICLE_URL}}` | 直接读取 | `articles.url` |
  | `{{ARTICLE_CONTENT}}` | 优先 Markdown，回退原始内容 | `articles.markdown_content \|\| articles.content` |
