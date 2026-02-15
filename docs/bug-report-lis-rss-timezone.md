# Bug Report: LIS RSS Daily Summary 时区问题

## 问题描述

**症状**：使用 `lis-rss-daily-summary` skill 查询当天文章汇总时，API 返回 `empty` 状态，但页面显示当天确实有通过审核的文章。

**重现步骤**：
1. 页面显示抓取时间：2026年2月15日 02:00
2. 运行 `lis-rss-daily-summary` skill
3. API 返回：`"status": "empty"`, `"date": "2026-02-15"`, `"totalArticles": 0`

## 根本原因

**时区转换问题**：数据库存储 UTC 时间，页面显示本地时间（UTC+8），API 查询使用 UTC 时间导致日期不匹配。

### 数据示例

| 位置 | 时间值 | 说明 |
|------|--------|------|
| 数据库 (`created_at`) | `2026-02-14T18:00:02.772Z` | UTC 时间（Z 后缀） |
| 页面显示 | `2026年2月15日 02:00` | 本地时间（UTC+8） |
| API 查询条件 | `DATE(created_at) = '2026-02-15'` | 查询 2月15日 UTC 时间 |

**时间线**：
```
UTC:    2026-02-14 18:00:02
        ↓
UTC+8:  2026-02-15 02:00:02  ← 页面显示的日期
```

用户看到的是 `2026-02-15`（本地时间），但 API 查询的是数据库 UTC 时间 `2026-02-14`，导致查询不到数据。

## 影响范围

- `lis-rss-daily-summary` skill 每日汇总功能
- 所有涉及日期查询的 API 端点
- 跨时区用户的数据查询

## 修复建议

### 方案 1：API 查询时转换时区（推荐）

修改服务端 `/api/daily-summary/cli` 端点的查询逻辑：

```python
# 错误的查询（当前）
WHERE DATE(created_at) = '2026-02-15'

# 正确的查询（转换为本地时区）
WHERE DATE(CONVERT_TZ(created_at, '+00:00', '+08:00')) = '2026-02-15'
```

### 方案 2：统一使用本地时区存储

如果业务主要在中国时区，可将数据库时间统一存储为本地时区。

### 方案 3：增加 `local_date` 字段

在数据库中增加一个 `local_date` 字段，专门用于按本地日期查询：

```sql
ALTER TABLE articles ADD COLUMN local_date DATE GENERATED ALWAYS AS
    (DATE(CONVERT_TZ(created_at, '+00:00', '+08:00'))) STORED;

-- 查询
WHERE local_date = '2026-02-15'
```

### 方案 4：API 支持时区参数

让客户端指定时区，服务端按指定时区查询：

```json
POST /api/daily-summary/cli
{
  "date": "2026-02-15",
  "timezone": "Asia/Shanghai"  // 或 "+08:00"
}
```

## 相关文件

- **客户端**：`.claude/skills/lis-rss-daily-summary/scripts/fetch-summary.py`
- **服务端**：`lis-rss-api` 项目中 `/api/daily-summary/cli` 端点实现

## 验证方法

修复后，使用以下命令验证：

```bash
# 查询 2026-02-15（本地时间）
python .claude/skills/lis-rss-daily-summary/scripts/fetch-summary.py --date 2026-02-15 --json

# 期望返回
{
  "status": "success",
  "data": {
    "date": "2026-02-15",
    "totalArticles": > 0
  }
}
```

## 参考

- [MySQL CONVERT_TZ 文档](https://dev.mysql.com/doc/refman/8.0/en/date-and-time-functions.html#function_convert-tz)
- 数据库原始数据：
  ```json
  {
    "created_at": "2026-02-14T18:00:02.772Z",
    "filter_status": "passed"
  }
  ```
- 页面显示：`抓取时间: 2026年2月15日 02:00`

---

**报告日期**：2026-02-15
**优先级**：高（影响核心功能）
**状态**：待修复
