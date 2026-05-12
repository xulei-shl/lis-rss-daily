---
name: gmail-skill
description: Read, search, and manage Gmail emails and Google contacts. Use when the user asks to check email, find emails, search messages, look up contacts, or find someone's email/phone. Supports multiple accounts.
allowed-tools: "Read, Edit, Write, Bash, Glob, Grep, AskUserQuestion, Task"
---

# Gmail 技能 - 电子邮件和联系人访问
读取、搜索和删除 Gmail 电子邮件，访问 Google 联系人。

## 命令

> **路径规范**：使用 `$CLAUDE_PROJECT_DIR` 环境变量，确保跨工作目录的可靠路径解析。

### 搜索电子邮件
```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py search "查询语句" [--max-results 数量] [--account 邮箱地址]
```

**查询示例：**
- `from:john@example.com` - 来自特定发件人
- `subject:meeting after:2026/01/01` - 包含指定主题且在指定日期之后
- `has:attachment filename:pdf` - 包含 PDF 附件
- `is:unread` - 未读邮件
- `"exact phrase"` - 精确匹配短语

### 读取电子邮件
```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py read 邮件ID [--output 文件路径] [--format full|minimal] [--account 邮箱地址]
```

**参数说明：**
- `--output`, `-o`: 直接将邮件 JSON 保存到指定文件（推荐用于批量处理）
- `--format`: `full`（默认，完整内容）或 `minimal`（仅元数据）

**示例：**
```bash
# 输出到终端（默认）
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py read 18d5a3b2c1f4e5d6

# 直接保存到文件（推荐）
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py read 18d5a3b2c1f4e5d6 --output temp_emails/email_1.json
```

### 列出最近的电子邮件
```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py list [--max-results 数量] [--label 标签名] [--account 邮箱地址]
```


### 标记为已读
```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py mark-read 邮件ID [--account 邮箱地址]
```

### 标记为未读
```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py mark-unread 邮件ID [--account 邮箱地址]
```

### 标记为已处理（归档）
将邮件从收件箱移除并归档。

```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py mark-done 邮件ID [--account 邮箱地址]
```

### 取消归档
将邮件移回收件箱（撤销归档操作）。

```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py unarchive 邮件ID [--account 邮箱地址]
```

### 标星 / 取消标星
```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py star 邮件ID [--account 邮箱地址]
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py unstar 邮件ID [--account 邮箱地址]
```

### 移到垃圾箱 / 恢复
将邮件移到垃圾箱（30天内可恢复）或从垃圾箱恢复。

```bash
# 移到垃圾箱（推荐 - 可恢复）
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py trash 邮件ID [--account 邮箱地址]

# 从垃圾箱恢复
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py untrash 邮件ID [--account 邮箱地址]
```

### 永久删除
⚠️ **谨慎使用** - 此操作不可撤销，邮件将被永久删除。

```bash
# 永久删除（不可逆）
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py delete 邮件ID [--account 邮箱地址]
```

**建议**：优先使用 `trash` 命令移到垃圾箱，确认不再需要后再手动从垃圾箱永久删除。

### 批量操作提示
标记类命令（`mark-read`、`mark-unread`、`mark-done`、`unarchive`、`star`、`unstar`、`trash`、`untrash`、`delete`）均支持多个 ID（逗号分隔）：
```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py mark-read "id1,id2,id3" --account user@gmail.com
```

### 列出标签
```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py labels [--account 邮箱地址]
```

### 列出联系人
```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py contacts [--max-results 数量] [--account 邮箱地址]
```

### 搜索联系人
```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py search-contacts "查询语句" [--account 邮箱地址]
```

### 账户管理
```bash
# 列出所有已认证的账户
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py accounts

# 移除指定账户
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py logout --account user@gmail.com

# 强制重新授权并刷新本地令牌
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py refresh-auth --account user@gmail.com
```

`refresh-auth` 会强制拉起浏览器 OAuth，覆盖本地保存的 token，不会删除账户标签等元数据。

## 多账户支持
使用 `--account` 参数指定新邮箱地址即可添加账户，系统会自动打开浏览器进行认证：

```bash
# 第一个账户（自动认证）
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py list

# 添加工作账户
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py list --account work@company.com

# 添加个人账户
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py list --account personal@gmail.com

# 使用指定账户操作
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py search "from:boss" --account work@company.com
```

当 `refresh token` 失效、需要切换重新授权的账号，或需要强制重新同意权限时，可执行：

```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py refresh-auth --account work@company.com
```

## 示例

### 查找本周的未读邮件
```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py search "is:unread after:2026/01/01"
```

### 读取指定邮件
```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py read 18d5a3b2c1f4e5d6
```

### 查找某人的联系信息
```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py search-contacts "张三"
```

### 在个人设备上查看工作邮箱
```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py list --account work@company.com --max-results 5
```

## 输出格式
所有命令均输出 JSON 格式，便于解析处理。

## 技术提示

### 读取多封邮件
**重要提示**：`read` 命令**不支持**逗号分隔的多个邮件ID。读取多封邮件时，应使用多个独立的 Bash 工具调用并行执行：

```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py read "id1"
```

```bash
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py read "id2"
```

```bash
# 错误方式：会提示"无效的ID值"
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py read "id1,id2,id3"
```

### 处理大体积邮件内容

当邮件输出超过约40KB时（显示"输出内容过大"提示），可使用 `email_formatter.py` 格式化为 Markdown。详见 [ADVANCED.md](ADVANCED.md)。

### 日期搜索格式

#### 推荐方式：使用 --date-range 参数（避免时区问题）

⚠️ **重要**：Gmail 的 `after:YYYY/M/D before:YYYY/M/D` 格式会被解释为 **PST 时区的午夜**，导致时区问题。推荐使用 `--date-range` 参数，该参数自动将日期转换为 Unix 时间戳（使用 UTC）。

**新增参数：**
- `--date-range YYYY-MM-DD` - 查询指定日期的邮件
- `--date-start YYYY-MM-DD` - 起始日期（包含）
- `--date-end YYYY-MM-DD` - 结束日期（不包含）

**示例：**
```bash
# 查询指定日期的邮件（推荐）
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py search \
    "from:scholaralerts-noreply@google.com" \
    --date-range "2026-02-04"

# 查询日期范围
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py search \
    "from:john@example.com" \
    --date-start "2026-02-01" \
    --date-end "2026-02-05"

# 相对时间查询（不受时区影响）
python $CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/scripts/gmail_skill.py search \
    "from:alert@example.com newer_than:7d"
```

#### 旧格式（不推荐用于精确日期查询）

Gmail 原生的日期搜索运算符：
- `after:YYYY/M/D` - 指定日期之后的邮件（包含当天，但使用 PST 时区）
- `before:YYYY/M/D` - 指定日期之前的邮件（包含当天，但使用 PST 时区）
- `newer_than:Nd` - 最近 N 天内的邮件

⚠️ **注意**：使用 `after:YYYY/M/D before:YYYY/M/D` 进行精确日期查询时，由于 PST 时区解释问题，可能导致日期范围不准确。建议使用 `--date-range` 参数代替。

更多高级用法详见 [ADVANCED.md](ADVANCED.md)。

## 环境要求
- Python 3.9 及以上版本
- 安装依赖：`pip install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client requests`

## 安全说明
- **发送确认要求** - Claude 发送邮件前必须始终向用户确认
- 令牌本地存储在 `$CLAUDE_PROJECT_DIR/.claude/skills/gmail-skill/tokens/` 目录
