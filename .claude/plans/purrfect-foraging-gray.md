# Telegram Bot /getarticles 命令增强：支持来源筛选

## Context

现有的 `/getarticles YYYYMMDD` 命令只能按日期获取随机5篇未读文章。用户希望能够像网页版的来源过滤器一样，通过来源名称来获取文章。

## 目标

扩展 `/getarticles` 命令，自动判断参数类型：
- 如果参数是日期格式（YYYY-MM-DD 或 YYYYMMDD），按日期筛选
- 如果参数不是日期格式，按来源名称筛选
- 每次查询只支持单一条件（日期或来源），不支持组合

## 关键文件

### 需要修改的文件

1. **`/opt/lis-rss-daily/src/telegram/command-parser.ts`**
   - 修改 `parseGetArticlesCommand` 函数
   - 返回类型改为 `{ type: 'date', year, month, day } | { type: 'source', name: string } | null`

2. **`/opt/lis-rss-daily/src/telegram/bot.ts`**
   - 修改 `handleGetArticlesCommandWrapper` 函数处理两种类型
   - 添加来源名称匹配逻辑
   - 添加来源列表缓存
   - 修改错误消息提示

3. **`/opt/lis-rss-daily/src/telegram/types.ts`**
   - 更新 `GetArticlesCommand` 类型定义

### 可复用的现有功能

- **`articleService.getMergedSources(userId)`** - 获取合并后的来源列表
- **`getUserArticles(userId, options)`** - 已支持 `rssSourceIds`, `journalIds`, `keywordIds` 参数

## 实现方案

### 1. 扩展命令解析器 (command-parser.ts)

```typescript
export interface GetArticlesDateCommand {
  type: 'date';
  year: number;
  month: number;
  day: number;
}

export interface GetArticlesSourceCommand {
  type: 'source';
  name: string;
}

export type GetArticlesCommand = GetArticlesDateCommand | GetArticlesSourceCommand;

export function parseGetArticlesCommand(args: string): GetArticlesCommand | null {
  if (!args || args.trim() === '') {
    return null;
  }

  const trimmed = args.trim();

  // 先尝试解析为日期
  const dateMatch = tryParseDate(trimmed);
  if (dateMatch) {
    return { type: 'date', ...dateMatch };
  }

  // 不是日期，视为来源名称
  return { type: 'source', name: trimmed };
}

function tryParseDate(input: string): { year: number; month: number; day: number } | null {
  // 现有的日期解析逻辑
  let match = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    match = input.match(/^(\d{4})(\d{2})(\d{2})$/);
  }
  if (!match) return null;

  const [, yearStr, monthStr, dayStr] = match;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // 验证逻辑...
  return { year, month, day };
}
```

### 2. Bot 中添加来源匹配逻辑 (bot.ts)

```typescript
// 在类中添加来源缓存
private sourcesCache: MergedSourceOption[] | null = null;
private sourcesCacheTime: number = 0;
private readonly SOURCES_CACHE_TTL = 5 * 60 * 1000; // 5分钟

// 获取来源列表（带缓存）
private async getSources(): Promise<MergedSourceOption[]> {
  const now = Date.now();
  if (this.sourcesCache && (now - this.sourcesCacheTime) < this.SOURCES_CACHE_TTL) {
    return this.sourcesCache;
  }

  this.sourcesCache = await articleService.getMergedSources(this.userId);
  this.sourcesCacheTime = now;
  return this.sourcesCache;
}

// 匹配来源名称
private matchSourceName(name: string, sources: MergedSourceOption[]): MergedSourceOption | null {
  // 1. 精确匹配
  let match = sources.find(s => s.name === name);
  if (match) return match;

  // 2. 忽略大小写匹配
  const lowerName = name.toLowerCase();
  match = sources.find(s => s.name.toLowerCase() === lowerName);
  if (match) return match;

  // 3. 包含匹配（来源名包含输入）
  match = sources.find(s => s.name.includes(name));
  if (match) return match;

  // 4. 包含匹配（输入包含来源名）
  match = sources.find(s => name.includes(s.name));
  if (match) return match;

  return null;
}
```

### 3. 更新命令处理器 (bot.ts)

```typescript
private async handleGetArticlesCommandWrapper(args: string, chatId: string): Promise<void> {
  try {
    const parsed = parseGetArticlesCommand(args);
    if (!parsed) {
      await this.client.sendMessage(chatId,
        '❌ 格式错误。\n' +
        '按日期：/getarticles YYYY-MM-DD 或 YYYYMMDD\n' +
        '按来源：/getarticles 来源名称\n' +
        '例如：/getarticles 2026-3-1 或 /getarticles MIT Technology Review');
      return;
    }

    if (parsed.type === 'date') {
      await this.handleGetArticlesByDate(parsed, chatId);
    } else {
      await this.handleGetArticlesBySource(parsed, chatId);
    }
  } catch (error) {
    // 错误处理...
  }
}

private async handleGetArticlesByDate(
  command: GetArticlesDateCommand,
  chatId: string
): Promise<void> {
  // 现有的日期查询逻辑
  const { year, month, day } = command;
  // ... 验证和查询
}

private async handleGetArticlesBySource(
  command: GetArticlesSourceCommand,
  chatId: string
): Promise<void> {
  const sources = await this.getSources();
  const matchedSource = this.matchSourceName(command.name, sources);

  if (!matchedSource) {
    await this.client.sendMessage(chatId,
      `❌ 未找到来源 "${escapeHtml(command.name)}"\n` +
      `提示：可以使用完整的来源名称，例如 "MIT Technology Review"`);
    return;
  }

  // 构建查询参数
  const queryParams: any = {
    isRead: false,
    filterStatus: 'passed',
    limit: 5,
    page: 1,
    randomOrder: true,
  };

  if (matchedSource.rssIds) queryParams.rssSourceIds = matchedSource.rssIds;
  if (matchedSource.journalIds) queryParams.journalIds = matchedSource.journalIds;
  if (matchedSource.keywordIds) queryParams.keywordIds = matchedSource.keywordIds;

  const result = await getUserArticles(this.userId, queryParams);

  if (result.articles.length === 0) {
    await this.client.sendMessage(chatId,
      `📭 来源 "${escapeHtml(matchedSource.name)}" 没有符合条件的未读文章`);
    return;
  }

  await this.client.sendMessage(chatId,
    `📚 找到 ${result.articles.length} 篇来自 "${escapeHtml(matchedSource.name)}" 的未读文章：`);

  // 发送文章列表...
}
```

## 边界情况处理

1. **来源名称不唯一**：使用第一个匹配结果（merged sources 已处理同名情况）
2. **来源名称匹配不到**：返回友好的错误消息，提示使用完整名称
3. **来源没有未读文章**：显示"没有符合条件的未读文章"
4. **关键词来源**：名称带"关键词: "前缀，用户可以直接搜索

## 验证步骤

1. 测试日期格式：`/getarticles 2026-03-01`、`/getarticles 20260301`
2. 测试来源名称（精确）：`/getarticles MIT Technology Review`
3. 测试来源名称（部分匹配）：`/getarticles MIT`
4. 测试不存在的来源：`/getarticles 不存在的来源名`
5. 测试空参数：`/getarticles`
6. 测试关键词来源：`/getarticles 关键词: 人工智能`
