# DeepSearch - 深度检索工具

根据用户提供的 MD 文件，检索相关文章并生成摘要。

## 功能特性

- **第一步：检索相关文章** - 迭代检索 + 语义搜索
- **第二步：PDF 总结** - 调用 paper-pdf-summary API 生成摘要
- 支持命令行和 API 两种调用方式
- 错误容忍：PDF 总结失败时跳过并记录
- 报告输出：每一步执行结果追加写入 MD 文档

## 目录结构

```
scripts/deepsearch/
├── config/
│   └── config.yaml          # 配置文件
├── prompts/
│   └── default.md           # 提示词模板
├── types.ts                 # TypeScript 类型
├── config.ts                # 配置加载
├── database.ts              # 数据库访问
├── llm.ts                   # LLM 调用
├── search.ts                # 检索服务
├── pdf-api.ts               # PDF API 客户端
├── report.ts                # 报告生成
├── md-parser.ts             # MD 解析器
├── deepsearch.ts            # 主服务
├── cli.ts                   # CLI 入口
├── api.py                   # FastAPI 服务
└── package.json             # 依赖
```

## 配置说明

编辑 `config/config.yaml`：

```yaml
# 用户配置
user:
  userId: 1

# 数据库配置
database:
  path: "/opt/lis-rss-daily/data/rss-tracker.db"

# LLM 配置
llm:
  task_type: null
  temperature: 0.3
  max_tokens: 2000

# 检索配置
search:
  iteration_rounds: 1
  score_threshold: 0.78
  semantic_limit: 5
  max_final_articles: 10

# PDF 总结配置
pdf_summary:
  api_url: "http://localhost:8081"
  timeout: 300
  max_retries: 2

# 输出配置
output:
  report_dir: "./output"
  articles_dir: "./output/articles"
```

## 迭代检索说明

检索按“每篇种子文献”独立执行，再全局合并。

### 迭代逻辑

以 `iteration_rounds: 1` 为例：

- **ID检索（仅对有 ID 种子）**
  - 第0轮：种子ID → related 检索
  - 第1轮：第0轮返回文章ID → related 检索
- **语义检索（对每篇种子都执行）**
  - 使用 `题名` 或 `题名+content` + 提示词生成检索条件
  - 每个检索条件都执行语义检索

```
种子(ID=1234)
  ├─ ID第0轮 related(limit=5) => A(5)
  ├─ ID第1轮 对A逐篇 related(limit=5) => B(最多25)
  └─ 语义检索：term1/term2/... 各自 semantic(limit=5)

单种子结果：ID结果 + 语义结果 => 去重排序
全局结果：所有种子结果合并 => 去重排序 => 取 top max_final_articles
```

### 配置示例

- `iteration_rounds: 0`：仅种子文章直接检索
- `iteration_rounds: 1`：种子检索 + 1轮扩展检索
- `iteration_rounds: 3`：种子检索 + 3轮扩展检索（第1轮→第2轮→第3轮）

### 相关参数

- `semantic_limit`：每次检索的返回数量上限，作用于：
  - 每一次 `ID -> related` 检索
  - 每一个检索词的语义检索
- `score_threshold`：每次检索结果都会按该阈值过滤（related 与 semantic 都生效）
- `max_final_articles`：所有种子文献全部检索完成后，全局去重排序取前 N（`0` 表示不限制）

### 多种子文献检索逻辑

当 MD 文件中包含多篇种子文献时：

1. 每篇种子文献先执行 ID 检索链（有 ID 才执行）。
2. 每篇种子文献再执行语义检索链（每个检索条件都执行）。
3. 每篇种子文献内部合并去重并排序。
4. 所有种子结果再全局合并去重排序，取 `max_final_articles`。

```
种子1: [ID链 + 语义链] -> 去重
种子2: [ID链 + 语义链] -> 去重
...
全部种子结果 -> 全局去重排序 -> top N
```

## 使用方式

### CLI

```bash
# 基本用法
node cli.ts -i input.md

# 指定参数
node cli.ts -i input.md -r 2 -t 0.7 -l 10

# 指定配置文件
node cli.ts -i input.md -c ./custom-config.yaml
```

参数说明：
- `-i, --input` - 输入 MD 文件路径（必填）
- `-c, --config` - 配置文件路径（可选）
- `-r, --rounds` - 迭代检索轮次（可选）
- `-t, --threshold` - 相关性分数阈值（可选）
- `-l, --limit` - 语义检索返回数量（可选）
- `-m, --maxFinal` - 最终结果保留数量（可选）
- `-o, --output` - 输出目录（可选）

### API

```bash
# 启动 API 服务
python api.py

# 调用示例
curl -X POST http://localhost:8082/process \
  -H "Content-Type: application/json" \
  -d '{
    "input_md": "- 题名：1234",
    "input_type": "content",
    "rounds": 1
  }'
```

API 端点：
- `POST /process` - 启动处理任务
- `GET /task/{task_id}` - 查询任务状态
- `GET /task/{task_id}/download` - 下载结果压缩包
- `GET /health` - 健康检查

## 输入格式

MD 文件格式：

```markdown
- 从替代到协同：AIGC赋能图书馆人智协同咨询服务模式研究@405
- 计算扎根理论的方法演进及其在数字人文研究中的应用：1234
- 深度学习研究进展
```

说明：
- **有 ID 的行（推荐）**：`- 标题@ID`
- **有 ID 的兼容格式**：`- 标题：ID` 或 `- 标题:ID`
  - 例如题名中有冒号时，`- 从替代到协同：AIGC赋能图书馆人智协同咨询服务模式研究@405` 更清晰
- **无 ID 的行**（如 `深度学习研究进展`）：直接使用题名检索
- 解析优先级：先识别 `@ID`，再识别 `：ID` / `:ID`

## 输出结果

```
output/
└── run_xxx/
    ├── report.md            # 运行报告
    └── articles/            # 逐篇文章 md（包含种子文献）
        ├── 1234_xxx.md
        └── xxx.md
```

说明：
- 最终执行 PDF 总结与导出的集合为：`top max_final_articles` + `种子文献`（去重后）
- 对每篇文章都执行 PDF 总结；若数据库已有 `ai_summary` 则跳过调用
- 无 ID 的种子文献不会写回数据库，但会把总结结果写入本次任务输出的 md 文件

## 依赖

- Node.js 18+
- Python 3.9+ (for API)
- better-sqlite3
- js-yaml
- openai
- fastapi (Python)

## 注意事项

1. 首次使用需确保 `config.yaml` 正确配置 `user.userId`、`database.path` 等参数
2. PDF API 需确保 paper-pdf-summary 服务（端口 8081）正常运行
3. LLM 配置从主项目数据库获取，与主项目共享配置
4. 检索依赖 Chroma 向量服务
