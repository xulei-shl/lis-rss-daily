# ScholarPulse：把学术邮件整理成中文文献摘要

ScholarPulse 是一个轻量级本地 Python 工作流，用来从 Google Scholar alerts、期刊目录提醒、出版社推荐邮件和 RSS 邮件中提取论文条目，去重、排序、翻译并生成中文 Markdown 与 HTML 摘要。

它适合希望用成熟邮件订阅源跟踪文献，而不想维护个人爬虫或复杂数据库的科研用户。

## 核心功能

- 读取专用 Gmail 学术邮箱中的未读提醒邮件。
- 解析 Google Scholar 关键词提醒、作者提醒、期刊目录邮件、RSS 邮件和通用学术推荐邮件。
- 按 DOI、URL、规范化标题和模糊标题相似度去重。
- 根据 `research_interests.md` 中的自然语言研究兴趣动态判断相关性。
- 调用 Codex CLI、DeepSeek 或其他 OpenAI-compatible API 生成中文标题、摘要和推荐理由。
- 同时输出 Markdown 与 HTML；HTML 支持浏览器阅读、图片展示、搜索和相关性筛选。
- 默认 dry-run，不删除邮件，不标记已读，适合先安全试跑。

👉 [点击此处查看真实案例：输出的 HTML （建议右键新窗口打开查看） ](https://htmlpreview.github.io/?https://github.com/FemiSphere/ScholarPulse/blob/master/2026-04-30-digest.html)

## 快速开始

### 1. 安装依赖

```powershell
python -m pip install -e ".[dev]"
```

### 2. 准备本地配置

```powershell
Copy-Item config.example.yaml config.local.yaml
```

只修改 `config.local.yaml`。该文件已被 `.gitignore` 忽略，不应提交到 Git。

### 3. 配置 Gmail OAuth

在 Google Cloud Console 中启用 Gmail API，创建 Desktop App 类型 OAuth Client，下载凭据并命名为：

```text
credentials.json
```

放到项目根目录。第一次读取 Gmail 时，程序会打开浏览器完成授权，并生成 `token.json`。

不要提交 `credentials.json`、`token.json`、`.env`、`config.local.yaml` 或 `config/llm/*.local.yaml`。

### 4. 写研究兴趣

编辑：

```text
research_interests.md
```

可以直接写自然语言，例如：

```markdown
我近期关注计算材料科学与 AI for materials，特别是框架材料、二维材料、机器学习势函数、声子输运、热导率预测，以及可能启发材料设计的新计算方法。
```

程序会让 LLM 从这段文字中提炼结构化兴趣画像，再用于论文排序。

### 5. 先运行样例

```powershell
python -m literature_digest --dry-run --sample
```

### 6. 小批量读取真实 Gmail

```powershell
python -m literature_digest --dry-run --max-emails 5
```

输出文件会生成到：

```text
outputs/
```

确认效果稳定后，再逐步提高 `--max-emails`。

## LLM 配置

主配置中只选择后端：

```yaml
llm:
  provider: "openai_compatible"
  config_path: "config/llm/deepseek.local.yaml"
```

DeepSeek 示例配置可参考：

```text
config/llm/deepseek.example.yaml
```

复制为本地文件：

```powershell
Copy-Item config/llm/deepseek.example.yaml config/llm/deepseek.local.yaml
```

API key 建议写入 `.env`：

```text
DEEPSEEK_API_KEY=your_deepseek_api_key
```

低成本快速处理可优先选择 `deepseek-v4-flash`。更详细说明见 [docs/deepseek-api-guide.md](docs/deepseek-api-guide.md)。

如果使用 Codex CLI，可参考：

```text
config/llm/codex_cli.example.yaml
```

## 常用命令

```powershell
# 样例数据，不需要 Gmail 凭据
python -m literature_digest --dry-run --sample

# 读取最多 10 封未读邮件
python -m literature_digest --dry-run --max-emails 10

# 静默运行
python -m literature_digest --dry-run --max-emails 50 --quiet

# 明确使用本地配置
python -m literature_digest --config config.local.yaml --dry-run --max-emails 20
```

正式运行时如需标记已读，需要同时满足：

- `config.local.yaml` 中 `gmail.mark_as_read: true`
- 命令行使用 `--no-dry-run`

项目不会删除邮件。

## 自动化与一键运行

Windows 一键运行脚本：

```text
scripts/run_digest.bat
scripts/run_digest.ps1
```

双击 `scripts/run_digest.bat` 会自动定位项目根目录，运行摘要任务，并把日志写入 `logs/`。

定时运行和桌面快捷方式说明见：

```text
docs/automation-and-shortcuts.md
```

## 安全约定

已忽略的本地敏感文件包括：

- `.env`
- `config.local.yaml`
- `config/llm/*.local.yaml`
- `credentials.json`
- `token.json`
- `data/`
- `outputs/`
- `logs/`

日志和异常信息不应打印 API key、OAuth token、refresh token 或邮箱凭据。

## 测试

```powershell
python -m pytest
```

建议在提交前同时运行：

```powershell
python -m literature_digest --dry-run --sample
```

## 项目状态

这是一个面向个人科研工作流的早期项目。它的目标不是替代完整论文阅读，而是把散落在邮箱中的学术提醒整理成更容易浏览、筛选和追踪的中文摘要。
