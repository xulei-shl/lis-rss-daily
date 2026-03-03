# 添加关键词爬取日志到日志页面

## Context

用户需要在日志页面（filter-logs.ejs）添加关键词爬取日志的支持：
1. 在"全部流程"tab 中显示关键词爬取日志
2. 添加一个新的单独 tab 记录关键词爬取日志

数据库表 `keyword_crawl_logs` 已存在，包含字段：id, keyword_id, keyword, spider_type, year_start, year_end, articles_count, new_articles_count, status, error_message, duration_ms, created_at

现有的 `getKeywordCrawlLogs` 函数（src/api/keywords.ts:582-636）需要扩展以支持日期范围和状态过滤。

## Implementation Plan

### Step 1: 扩展 `getKeywordCrawlLogs` 函数

**文件**: `src/api/keywords.ts`

修改函数签名和实现，添加日期范围和状态过滤参数：

```typescript
export interface KeywordCrawlLogQueryOptions {
  status?: 'success' | 'failed' | 'partial';
  fromDate?: string;
  toDate?: string;
}

export async function getKeywordCrawlLogs(
  userId: number,
  keywordId?: number,
  page: number = 1,
  limit: number = 10,
  options?: KeywordCrawlLogQueryOptions
): Promise<{...}>
```

### Step 2: 添加日志路由

**文件**: `src/api/routes/logs.routes.ts`

添加两个新路由：
1. `GET /api/logs/keyword-crawl` - 获取所有关键词爬取日志（分页）
2. `GET /api/logs/keywords/:id` - 获取单个关键词的爬取日志

参考现有的 RSS 抓取日志路由模式。

### Step 3: 扩展统一日志

**文件**: `src/api/unified-logs.ts`

1. 在 `UnifiedLogType` 中添加 `'keyword_crawl'`
2. 在 `getUnifiedLogs` 中添加关键词爬取日志的获取逻辑
3. 添加 `mapKeywordCrawlLog` 映射函数
4. 更新 `ALL_TYPES` 数组和 `totalsByType`

### Step 4: 更新前端页面

**文件**: `src/views/filter-logs.ejs`

1. 添加新的 tab 按钮：
   ```html
   <button class="logs-tab" data-tab="keyword">关键词爬取</button>
   ```

2. 添加新的 tab panel，包含：
   - 状态过滤器（全部/成功/部分成功/失败）
   - 日志表格（列：展开、关键词、爬虫类型、年份范围、结果、新增/总数、耗时、时间）
   - 空状态提示
   - 分页控件

3. 更新 JavaScript：
   - 在 `state.tabs` 中添加 `keyword`
   - 在 `state.filters` 中添加 `keywordStatus`
   - 添加 `loadKeywordLogs(page)` 函数
   - 添加 `renderKeywordLogs(logs)` 函数
   - 更新 `reloadAllTabs()` 调用新函数
   - 更新 `changeLogPage()` 处理新 tab
   - 添加 `getFlowLabel()` 对 `keyword_crawl` 的处理
   - 添加 `getUnifiedSummary()` 对 `keyword_crawl` 的处理
   - 添加 `buildKeywordDetail()` 函数

## Files to Modify

| 文件 | 修改内容 |
|------|----------|
| `src/api/keywords.ts` | 扩展 `getKeywordCrawlLogs` 函数 |
| `src/api/routes/logs.routes.ts` | 添加关键词爬取日志路由 |
| `src/api/unified-logs.ts` | 添加 `keyword_crawl` 类型支持 |
| `src/views/filter-logs.ejs` | 添加关键词爬取 tab 和相关 JS |

## Verification

1. 启动应用，访问日志页面
2. 验证新 tab 显示正确
3. 验证"全部流程"tab 中显示关键词爬取日志
4. 验证状态过滤功能
5. 验证分页功能
6. 验证展开详情功能