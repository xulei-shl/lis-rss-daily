已根据当前代码梳理出大模型相关逻辑与表关系，结论如下（不涉及代码改动）。

**1) llm.ts 的配置与系统提示词逻辑，以及 system_prompts 的关系**

- LLM 配置来源：优先从 `llm_configs` 取用户活跃配置（默认优先），取不到就回退到环境变量。实现位置：`src/llm.ts` + `src/api/llm-configs.ts`。  
  - 入口：`getUserLLMProvider(userId)` → `getActiveLLMConfig(userId)` → 组装配置 → 选择 provider。  
  - 回退：`getLLM()` 使用环境变量（`LLM_PROVIDER/OPENAI_* / GEMINI_*`）。  
  - 参考：`src/llm.ts`、`src/api/llm-configs.ts`、`src/config.ts`。

- 系统提示词来源：当前实际运行中 **并未从 `system_prompts` 表读取**。  
  - 摘要/关键词/翻译的系统提示词 **写死在** `src/agent.ts`。  
  - 过滤阶段的系统提示词由 `src/filter.ts` 在运行时拼装（见第2点）。  
  - 参考：`src/agent.ts`、`src/filter.ts`。

- `system_prompts` 表：数据库里存在且在 `sql/001_init.sql` 有默认模板插入，但 **代码中没有任何读取/应用该表的逻辑**。  
  - 这意味着目前“系统提示词表”与实际调用逻辑是 **脱节** 的。  
  - 参考：`sql/001_init.sql`、`src/db.ts`。

结论：  
`system_prompts` 目前只是“可用但未接入”的设计，实际调用仍是硬编码提示词 + 动态拼装提示词。

---

**2) RSS 新文献过滤的系统提示词是否来自 topic_domains/topic_keywords**

是的，**当前过滤提示词就是从这两张表提取并拼装**，不经过 `system_prompts`。流程如下：

- `filterArticle()` → `llmFilter()`  
- `llmFilter()` 会拿到“命中的领域或全部领域”  
- `buildFilterSystemPrompt()` 把 `topic_domains` + `topic_keywords` 的信息拼进系统提示词（包括：领域ID/名称/描述/关键词/权重/关键词描述）  
- 然后构造 `system` + `user` 消息给 LLM  
- 参考：`src/filter.ts`

因此你提到的“系统提示词需要从 topic_domains 和 topic_keywords 表中提取数据构成”，**当前实现已满足**，但它是在 `filter.ts` 内部拼出来的，并不走 `system_prompts` 表。

---

**3) 现阶段的大模型相关逻辑总览（按模块）**

- **LLM 客户端封装**：  
  - `src/llm.ts`  
  - 支持 OpenAI 兼容 / Gemini  
  - DB 配置优先，环境变量兜底

- **文章过滤（RSS 过滤）**：  
  - `src/filter.ts`  
  - 关键词预筛 → LLM 精筛（JSON 模式）→ 失败则关键词兜底  
  - 系统提示词动态拼装（领域/关键词/权重/描述）  

- **文章分析（摘要/关键词/翻译）**：  
  - `src/agent.ts`  
  - 系统提示词硬编码  
  - 使用 `llm.chat`，JSON 模式用于关键词/翻译  

- **流程衔接**：  
  - `src/pipeline.ts` 在文章通过过滤后触发分析  
  - 关键词与翻译写回数据库  

- **LLM 配置表用途**：  
  - `llm_configs`：LLM/Embedding/Rerank 三类配置统一管理  
  - LLM：`getActiveLLMConfig` → `getUserLLMProvider`  
  - Embedding：`src/vector/embedding-client.ts`  
  - Rerank：`src/vector/reranker.ts`
