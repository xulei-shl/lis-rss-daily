# 配置与常量参考

## 常量定义

| 常量 | 值 | 说明 |
|------|-----|------|
| 邮件发件人 | `scholaralerts-noreply@google.com` | Google Scholar Alert 发件人 |
| 临时目录 | `$CLAUDE_PROJECT_DIR/outputs/temps/` | 存放临时邮件和解析文件 |
| 报告目录 | `$CLAUDE_PROJECT_DIR/outputs/scholar-reports/` | 生成的日报存放位置 |
| 报告同步目录 | `C:\Users\Administrator\WPSDrive\1568727350\WPS企业云盘\上海图书馆(上海科学技术情报研究所)\我的企业文档\CC-datas\gmail-daily` | 日报额外同步位置 |
| MEMORY.md | `$CLAUDE_PROJECT_DIR/MEMORY.md` | 用户研究兴趣配置（包含过滤规则） |
| email_formatter | `$CLAUDE_PROJECT_DIR/.claude/skills/scholar-daily/scripts/email_formatter.py` | 邮件解析脚本 |

## 路径变量

> **路径规范**：使用 `$CLAUDE_PROJECT_DIR` 环境变量，确保跨工作目录的可靠路径解析。

## Gmail 查询格式

### 日期查询

使用 `after:` 和 `before:` 精确匹配指定日期的邮件：

```python
# 搜索 2026-02-04 这天的邮件
query = "from:scholaralerts-noreply@google.com after:2026/2/3 before:2026/2/5"
```

**技巧**：前后各扩展 1 天确保覆盖当天所有邮件。

### 日期计算

```python
from datetime import datetime, timedelta

target_date = "2026-02-04"
dt = datetime.strptime(target_date, "%Y-%m-%d")
prev_date = (dt - timedelta(days=1)).strftime("%Y/%m/%d")  # 2026/2/3
next_date = (dt + timedelta(days=1)).strftime("%Y/%m/%d")  # 2026/2/5
```

## 文件命名规范

| 文件类型 | 命名格式 | 示例 |
|----------|----------|------|
| 邮件 JSON | `email_{id}.json` | `email_18f3abc123.json` |
| 论文 Markdown | `papers_{id}.md` | `papers_18f3abc123.md` |
| 论文 JSON | `papers_{id}.json` | `papers_18f3abc123.json` |
| 日报文件 | `{date}-scholar-daily.md` | `2026-02-04-scholar-daily.md` |

## 默认值

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `target_date` | 今天 | 未指定日期时使用当前日期 |
| `max_results` | 50 | Gmail 搜索最大结果数 |
| `star_threshold` | ★★☆☆☆ | 低于此星级的论文不纳入日报 |

## 环境要求

- Python 3.9+
- Gmail API 认证配置（见 [gmail-skill](../gmail-skill/SKILL.md)）
- MEMORY.md 文件存在

## 过滤规则

论文过滤规则定义在 `$CLAUDE_PROJECT_DIR/MEMORY.md` 中，包括：

- **学科领域**：图书馆学，信息资源组织
- **关注主题词**：知识组织、元数据、大模型、RAG、知识图谱等
- **排除关键词**：元宇宙、阅读推广、公共图书馆服务等
