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
  score_threshold: 0.65
  semantic_limit: 5

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
- 题名：1234
- 题名：5678
- 题名：深度学习研究进展
```

说明：
- **有 ID 的行**（如 `题名：1234`）：根据 ID 检索相关文章
- **无 ID 的行**（如 `题名：深度学习研究进展`）：直接使用题名检索

## 输出结果

```
output/
├── report_2026-03-24.md     # 运行报告
└── articles/
    ├── 1234_xxx.md          # 文章摘要
    └── 5678_yyy.md
```

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