# 计划：添加 Telegram `/getarticles` 关键词搜索功能

## 背景

用户希望为 Telegram `/getarticles` 命令添加关键词搜索功能，类似 articles.ejs 页面的"关键词"搜索。

### 现有实现

当前 `/getarticles` 支持两种模式：
1. **日期查询**: `/getarticles 2026-3-1`
2. **来源查询**: `/getarticles MIT Technology Review` 或 `/getarticles 关键词: 人工智能`

### 关键区分点

- **关键词订阅来源**: 用户在系统中预先定义的订阅（如"关键词: 人工智能"），有固定的 ID，通过 `keywordIds` 参数查询
- **真正的关键词搜索**: 动态搜索文章标题和摘要中包含特定关键词的文章，通过 `search` 参数查询

## 实现方案：智能回退（方案 B）

```
/getarticles MIT Technology Review  → 匹配来源 → 查询该来源的文章
/getarticles 深度学习               → 无匹配来源 → 关键词搜索
/getarticles 关键词: 人工智能        → 匹配关键词订阅来源 → 查询该订阅的文章
```

## 修改文件

### 1. `src/telegram/bot.ts`

**修改 `handleGetArticlesBySource()` 方法**（行 785-873）：

```typescript
private async handleGetArticlesBySource(command: GetArticlesSourceCommand, chatId: string): Promise<void> {
  const sources = await this.getSources();
  const matchedSource = this.matchSourceName(command.name, sources);

  // 新增：如果没有匹配到来源，则作为关键词搜索
  if (!matchedSource) {
    await this.handleGetArticlesBySearch(command.name, chatId);
    return;
  }

  // 原有逻辑...
}
```

**新增 `handleGetArticlesBySearch()` 方法**：

```typescript
/**
 * Handle /getarticles command by keyword search
 * (fallback when source name is not found)
 */
private async handleGetArticlesBySearch(keyword: string, chatId: string): Promise<void> {
  const queryParams: any = {
    search: keyword,
    isRead: false,
    filterStatus: 'passed',
    limit: 5,
    page: 1,
    randomOrder: true,
    skipDaysFilterForSearch: true,  // 搜索时跳过时间过滤，实现全量检索
  };

  const result = await getUserArticles(this.userId, queryParams);

  if (result.articles.length === 0) {
    await this.client.sendMessage(chatId,
      `📭 关键词 "${this.escapeHtml(keyword)}" 没有找到符合条件的未读文章`);
    return;
  }

  await this.client.sendMessage(chatId,
    `🔍 关键词 "${this.escapeHtml(keyword)}" 找到 ${result.articles.length} 篇未读文章：`);

  // 发送文章...（与 handleGetArticlesBySource 类似）
}
```

### 2. `src/telegram/command-parser.ts`

无需修改。`GetArticlesSourceCommand` 的 `name` 字段可以同时表示来源名称和搜索关键词。

### 3. `src/api/articles.ts`

已有 `search` 和 `skipDaysFilterForSearch` 参数支持，无需修改。

## 命令解析流程

```
用户输入: /getarticles 深度学习
    ↓
parseGetArticlesCommand() → type: 'source', name: "深度学习"
    ↓
handleGetArticlesBySource()
    ↓
matchSourceName("深度学习", sources) → null (无匹配)
    ↓
handleGetArticlesBySearch("深度学习")  ← 新增方法
    ↓
getUserArticles({ search: "深度学习", skipDaysFilterForSearch: true })
    ↓
SQL: WHERE title LIKE '%深度学习%' OR summary LIKE '%深度学习%'
```

## 验证步骤

1. 启动应用，向 Telegram Bot 发送 `/getarticles 深度学习`
2. 确认返回标题或摘要包含"深度学习"的文章
3. 向 Bot 发送 `/getarticles MIT`（匹配存在的来源）
4. 确认返回 MIT 来源的文章（不是关键词搜索）
5. 向 Bot 发送 `/getarticles 关键词: 人工智能`（匹配关键词订阅来源）
6. 确认返回该关键词订阅的文章（不是关键词搜索）
