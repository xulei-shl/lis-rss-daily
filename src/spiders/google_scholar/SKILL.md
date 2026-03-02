---
name: google-scholar-search
description: 使用 Camoufox 执行 Google Scholar 学术检索，支持关键词搜索、年份筛选、结果批量获取。当用户需要进行学术文献检索、查询论文、搜索学术资料时使用。
allowed-tools: Bash, Write, Edit, Task
---

# Google Scholar Search

使用 Camoufox 浏览器自动化框架执行 Google Scholar 学术检索，支持关键词搜索、年份筛选和结果批量获取。

## 触发条件

当用户请求以下内容时使用本 Skill：

| 触发场景 | 示例 |
|----------|------|
| 学术文献检索 | "搜索关于深度学习的论文" |
| 查询论文信息 | "找一下 ResNet 的原始论文" |
| 搜索学术资料 | "查查 2024 年关于 LLM 的研究" |
| 作者作品检索 | "搜索 Geoffrey Hinton 的论文" |
| 期刊/会议论文 | "找 NeurIPS 2023 的相关论文" |

## 关键特性

| 特性 | 说明 | 优势 |
|------|------|------|
| **年份筛选** | 支持单年（2024）或范围（2020-2024）筛选 | 快速定位最新研究 |
| **被引次数** | 自动提取每篇论文的被引次数 | 评估论文影响力 |
| **PDF 直链** | 优先获取 PDF 直接下载链接 | 便于快速获取全文 |
| **批量获取** | 单次最多可获取 100 条结果 | 提高检索效率 |
| **结构化输出** | JSON 格式包含标题、作者、摘要、来源等 | 便于后续处理 |

## 虚拟环境设置

```bash
# 创建虚拟环境
python3 -m venv ~/.pyenvs/env_camoufox

# 激活虚拟环境
source ~/.pyenvs/env_camoufox/bin/activate

# 安装 camoufox
pip install -U camoufox[geoip]
python -m camoufox fetch

# 安装 playwright
pip install playwright
playwright install chromium
```

## 快速使用

```bash
# 激活虚拟环境
source ~/.pyenvs/env_camoufox/bin/activate

# 执行检索（默认使用 http://127.0.0.1:7890 代理）
~/.pyenvs/env_camoufox/bin/python ./.claude/skills/google_scholar_search/run.py "machine learning" -o ./temps/google-scholar-search/my-task
```

**参数说明**：
- 默认使用代理 `http://127.0.0.1:7890`，无需手动指定
- `-o ./temps/google-scholar-search/my-task`：输出目录
- `-n 50`：获取 50 条结果
- `--proxy http://127.0.0.1:1080`：使用自定义代理
- `--no-proxy`：禁用代理
- 默认使用 xvfb 虚拟窗口运行，无需 `--headless` 参数

## 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 接收检索请求                                              │
│    ├── 分析检索词（必需）                                    │
│    ├── 确定年份筛选（可选）                                  │
│    └── 确定结果数量（可选，默认10条）                        │
├─────────────────────────────────────────────────────────────┤
│ 2. 创建任务文件夹                                           │
│    └── 在 temps/google-scholar-search/ 下创建专属文件夹      │
├─────────────────────────────────────────────────────────────┤
│ 3. 执行检索                                                 │
│    └── 调用 cli.py 脚本执行检索                             │
├─────────────────────────────────────────────────────────────┤
│ 4. 返回结果                                                 │
│    └── 以结构化 JSON 格式呈现给用户                          │
└─────────────────────────────────────────────────────────────┘
```

## 基本用法

### 检索工作流程

```bash
# 创建任务文件夹（可选，系统会自动创建）
mkdir -p ./temps/google-scholar-search/my-task

# 执行检索（使用虚拟环境中的 Python）
~/.pyenvs/env_camoufox/bin/python ./.claude/skills/google_scholar_search/run.py "machine learning" -o ./temps/google-scholar-search/my-task
```

### 检索参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `query` | 检索关键词（位置参数，必需） | - |
| `-o, --output-dir` | 输出目录 | `./temps/google-scholar-search` |
| `-y, --year` | 筛选年份（格式: 2024 或 2020-2024） | - |
| `-n, --num-results` | 返回结果数量（最大100） | 10 |
| `--headless` | 启用无头模式（不显示浏览器） | False |
| `--no-geoip` | 禁用地理位置模拟 | False |
| `--proxy` | 自定义代理地址（默认: http://127.0.0.1:7890） | http://127.0.0.1:7890 |
| `--no-proxy` | 禁用代理 | False |
| `--language` | 界面语言 | zh-CN |
| `--no-save` | 不保存结果文件 | False |
| `--json-only` | 仅输出 JSON 格式 | False |

## 输出格式

返回 JSON 格式的检索结果：

```json
{
  "query": "检索词",
  "year_start": 起始年份,
  "year_end": 结束年份,
  "total_results": 结果总数,
  "results": [
    {
      "title": "论文标题",
      "url": "链接",
      "meta": "作者、来源、年份",
      "abstract": "摘要",
      "cited_by": 被引次数,
      "pdf_link": "PDF链接"
    }
  ],
  "url": "检索URL",
  "timestamp": 时间戳
}
```

## 使用示例

### 示例 1：基础检索（使用默认代理）

```bash
~/.pyenvs/env_camoufox/bin/python ./.claude/skills/google_scholar_search/run.py "machine learning" -o ./temps/google-scholar-search/machine-learning
```

### 示例 2：年份筛选 + 结果数量

```bash
~/.pyenvs/env_camoufox/bin/python ./.claude/skills/google_scholar_search/run.py "deep learning" -y 2023 -n 50 -o ./temps/google-scholar-search/deep-learning
```

### 示例 3：使用自定义代理

```bash
~/.pyenvs/env_camoufox/bin/python ./.claude/skills/google_scholar_search/run.py "neural networks" --proxy http://127.0.0.1:1080 -o ./temps/google-scholar-search/neural-networks
```

### 示例 4：禁用代理

```bash
~/.pyenvs/env_camoufox/bin/python ./.claude/skills/google_scholar_search/run.py "attention mechanism" --no-proxy -o ./temps/google-scholar-search/attention
```

## 最佳实践

### 查询优化策略

| 策略 | 说明 | 示例 |
|------|------|------|
| **使用英文关键词** | Google Scholar 对英文检索支持更好 | 用 "transformer architecture" 而非 "Transformer 架构" |
| **添加领域限定词** | 提高检索精确度 | "deep learning" → "deep learning computer vision" |
| **使用作者名** | 查找特定学者的作品 | "attention is all you need vaswani" |
| **年份范围筛选** | 获取最新研究或经典论文 | `-y 2020-2024` 获取近5年研究 |
| **结合被引次数** | 评估论文影响力 | 优先查看被引次数高的论文 |

### 性能优化

| 场景 | 建议 |
|------|------|
| 大量检索 | 使用 `--headless` 模式提高速度 |
| 网络受限 | 配置 `--proxy` 参数 |
| 重复检索 | 利用 Google Scholar 的 URL 直接访问 |
| 结果存储 | 使用 `--no-save` 避免写入磁盘（仅需屏幕输出时） |

## 错误处理

脚本会自动检测以下错误情况：

| 错误类型 | 说明 | 建议 |
|---------|------|------|
| `captcha` | 检测到验证码 | 稍后重试或更换 IP 地址 |
| `rate_limit` | 达到速率限制 | 等待一段时间后重试 |
| `no_results` | 没有匹配结果 | 尝试更换检索词 |

## 依赖要求

- Python 3.8+
- `camoufox[geoip]` 包
- `playwright` 包
- Chromium 浏览器（通过 camoufox fetch 安装）

## 与 google-search skill 的区别

| 特性 | google-search | google-scholar-search |
|------|---------------|----------------------|
| 检索目标 | 通用网页搜索 | 学术文献检索 |
| 检索引擎 | Google 搜索 | Google Scholar |
| 结果类型 | 网页链接 | 论文、期刊、会议 |
| 特色功能 | 拆分查询、翻译 | 年份筛选、被引次数 |
| 输出内容 | 标题、摘要、链接 | 作者、来源、摘要、PDF |
