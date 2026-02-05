# QMD 集成实现说明

## 概述

本项目集成了 QMD（本地离线搜索引擎）作为语义检索的后端。QMD 通过本地运行的 GGUF 模型实现向量嵌入和语义搜索，无需调用远程 API。

## 项目中 QMD 的实现

### 1. QMD 集成模块 ([`src/qmd.ts`](src/qmd.ts))

该模块负责 QMD 集合的初始化和文件管理：

| 函数 | 功能 |
|------|------|
| [`initQmdCollection()`](src/qmd.ts:27) | 初始化 QMD 集合目录 `data/qmd/articles` |
| [`linkFileToQmdCollection()`](src/qmd.ts:45) | 将导出的 Markdown 文件链接到 QMD 集合（Unix 用符号链接，Windows 用复制） |
| [`unlinkFileFromQmdCollection()`](src/qmd.ts:97) | 从 QMD 集合移除文件 |
| [`initQmdCollectionConfig()`](src/qmd.ts:120) | 调用 `qmd collection add` 添加集合到 QMD 配置 |
| [`isQmdAvailable()`](src/qmd.ts:165) | 检查 QMD 是否已安装 |

**关键配置**：
- `QMD_COLLECTION_PATH`：QMD 集合路径（默认 `./data/qmd`）
- `QMD_ARTICLES_COLLECTION`：文章集合名称（默认 `articles`）

### 2. 搜索模块 ([`src/search.ts`](src/search.ts))

该模块提供两种搜索方式：

| 函数 | 功能 |
|------|------|
| [`searchHistoricalArticles()`](src/search.ts:35) | SQLite LIKE 关键词搜索 |
| [`searchArticlesWithQMD()`](src/search.ts:177) | QMD 语义搜索（失败时回退到关键词搜索） |
| [`qmdVsearchWithRetry()`](src/search.ts:125) | 执行 `qmd vsearch` 命令，带 `SQLITE_BUSY` 重试机制 |

**重试机制**：
- 最大重试次数：3 次
- 退避策略：指数退避（1s, 2s, 4s）
- 仅对 `SQLITE_BUSY` 错误重试

### 3. 导出模块 ([`src/export.ts`](src/export.ts))

该模块负责文章导出和 QMD 索引更新：

| 函数 | 功能 |
|------|------|
| [`exportArticleMarkdown()`](src/export.ts:165) | 导出文章为 Markdown 文件，并触发 QMD 索引更新 |
| [`QmdIndexQueue`](src/export.ts:264) | 索引队列类，序列化 `qmd update` + `qmd embed` 调用 |

**QmdIndexQueue 特性**：
- 防止并发索引更新导致的 `SQLITE_BUSY` 错误
- 合并多个并发请求为单次更新
- 执行流程：`qmd update` → `qmd embed`

### 4. 主入口 ([`src/index.ts`](src/index.ts))

该模块负责启动 QMD 相关服务：

| 函数 | 功能 |
|------|------|
| [`startQmdAutoEmbedWatcher()`](src/index.ts:25) | 启动目录监听器，监听 QMD 集合目录变化 |

**目录监听机制**：
- 监听目录：`data/qmd/articles`
- 触发条件：检测到 `.md` 文件新增或修改
- 防抖时间：默认 30 秒（可通过 `QMD_AUTO_EMBED_DEBOUNCE_MS` 配置）
- 执行方式：调用 `qmdIndexQueue.requestUpdate()`

**启动流程**：
1. 初始化 QMD 集合目录
2. 配置 QMD 集合（`qmd collection add`）
3. 启动目录监听器

### 5. API 路由 ([`src/api/routes/search.routes.ts`](src/api/routes/search.routes.ts))

该模块提供搜索 API 接口：

**接口**：`GET /api/search`

**参数**：
- `q`：搜索查询（必需）
- `mode`：搜索模式（`semantic` | `keyword` | `mixed`，默认 `mixed`）
- `page`：页码（默认 1）
- `limit`：每页结果数（默认 10）

**搜索模式**：

| 模式 | 说明 |
|------|------|
| `semantic` | 纯 QMD 语义搜索 |
| `keyword` | 纯 SQLite LIKE 关键词搜索 |
| `mixed` | 混合搜索（语义 60% + 关键词 40%） |

**混合搜索实现**：
1. 并行执行关键词搜索和 QMD 语义搜索
2. 合并结果（按 articleId 去重）
3. 计算综合得分：`combinedScore = normalizedSemantic * 0.6 + relevance * 0.4`
4. 按综合得分排序

## QMD 自身的处理逻辑

### 设计定位

QMD 是专门设计的**本地离线搜索引擎**，所有向量处理都在本地完成，无需调用远程 API。

### 使用的本地模型

QMD 通过 `node-llama-cpp` 运行三个本地 GGUF 模型：

| 模型 | 用途 | 大小 |
|------|------|------|
| `embeddinggemma-300M-Q8_0` | 向量嵌入生成 | ~300MB |
| `qwen3-reranker-0.6b-q8_0` | 重排序 | ~640MB |
| `qmd-query-expansion-1.7B-q4_k_m` | 查询扩展 | ~1.1GB |

### 向量生成流程

```
文档 → 切分(800 tokens/块, 15% 重叠) → 格式化("title | text") → node-llama-cpp → 存储向量
```

- 文档被切分成 800 token 的块（15% 重叠）
- 每个块格式化为 `"title | text"` 格式
- 调用 `node-llama-cpp` 的 `embedBatch()` 方法生成向量
- 向量存储在 SQLite 的 `content_vectors` 和 `vectors_vec` 表中

### 关键命令说明

| 命令 | 功能 |
|------|------|
| `qmd collection add <path> --name <name>` | 添加集合到 QMD 配置 |
| `qmd update` | 索引新增/修改的文件 |
| `qmd embed` | 调用本地 EmbeddingGemma 模型为所有文档生成向量索引 |
| `qmd vsearch <query> --json -n <n>` | 使用已生成的向量进行语义搜索（余弦相似度） |
| `qmd query <query>` | 混合搜索（BM25 + 向量 + 查询扩展 + LLM 重排序） |

### 为什么不支持远程向量 API？

1. **隐私保护**：所有数据在本地处理，不发送到外部服务
2. **离线可用**：无需网络连接即可使用
3. **零成本**：无需支付 API 调用费用
4. **低延迟**：本地推理避免网络延迟
5. **自动下载**：模型首次使用时自动从 HuggingFace 下载并缓存到 `~/.cache/qmd/models/`

### 模型配置

在 QMD 源码中配置（参考 QMD 项目）：
```typescript
const DEFAULT_EMBED_MODEL = "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";
const DEFAULT_RERANK_MODEL = "hf:ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/qwen3-reranker-0.6b-q8_0.gguf";
const DEFAULT_GENERATE_MODEL = "hf:tobil/qmd-query-expansion-1.7B-gguf/qmd-query-expansion-1.7B-q4_k_m.gguf";
```

## 数据流

### 文章导出流程

```
文章处理完成 → exportArticleMarkdown()
  ↓
生成 Markdown 文件到 data/exports/
  ↓
linkFileToQmdCollection() → 链接到 data/qmd/articles/
  ↓
qmdIndexQueue.requestUpdate() → 触发索引更新
  ↓
qmd update → qmd embed → 生成向量索引
```

### 搜索流程

```
用户搜索请求 → /api/search
  ↓
根据 mode 选择搜索方式
  ↓
┌─────────────┬─────────────┬─────────────┐
│  semantic   │   keyword   │    mixed    │
└─────────────┴─────────────┴─────────────┘
  ↓              ↓              ↓
qmd vsearch   SQLite LIKE   并行执行两者
  ↓              ↓              ↓
返回结果      返回结果      合并并排序
```

### 目录监听流程

```
启动应用 → startQmdAutoEmbedWatcher()
  ↓
监听 data/qmd/articles/ 目录
  ↓
检测到 .md 文件变化
  ↓
防抖 30 秒
  ↓
qmdIndexQueue.requestUpdate()
  ↓
qmd update → qmd embed
```

## 可配置项

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `QMD_ENABLED` | 是否启用 QMD | `true` |
| `QMD_COLLECTION_PATH` | QMD 集合路径 | `./data/qmd` |
| `QMD_ARTICLES_COLLECTION` | 文章集合名称 | `articles` |
| `QMD_AUTO_EMBED_DEBOUNCE_MS` | 目录监听防抖时间（毫秒） | `30000` |

## 安装 QMD

```bash
# 使用 Bun 安装（推荐）
bun install -g github:tobi/qmd

# 或使用 npm
npm install -g github:tobi/qmd
```

## 故障排查

### 语义搜索返回空结果

**可能原因**：
1. QMD 未安装或未配置
2. 向量索引未生成（未运行 `qmd embed`）
3. 文件未链接到 QMD 集合

**排查步骤**：
1. 检查 QMD 是否安装：`qmd --version`
2. 检查集合是否配置：`qmd collection list`
3. 检查向量索引是否存在：`qmd vsearch "test" --json -n 1`
4. 检查日志中的错误信息

### SQLITE_BUSY 错误

**原因**：多个进程同时访问 QMD 数据库

**解决方案**：
- 项目已实现重试机制（`qmdVsearchWithRetry`）
- 项目已实现索引队列（`QmdIndexQueue`）防止并发索引更新
- 如仍频繁出现，可增加重试次数或调整防抖时间

## 总结

QMD 的本地方案（300MB EmbeddingGemma 模型）对于大多数用例已经足够。项目通过以下机制确保 QMD 的稳定运行：

1. **自动索引更新**：导出文章时自动触发索引更新
2. **目录监听**：监听 QMD 集合目录变化，覆盖手动新增/外部同步场景
3. **防抖机制**：避免频繁索引更新
4. **重试机制**：处理 `SQLITE_BUSY` 错误
5. **队列管理**：防止并发索引更新冲突
6. **回退机制**：QMD 不可用时自动回退到关键词搜索
