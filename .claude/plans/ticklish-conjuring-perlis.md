# 标题去重机制实现计划

## Context

当前文章去重机制基于 URL，但同一篇文章在不同平台可能有不同 URL（如带参数、短链等），导致重复入库。

**解决方案**：改用标题去重，因为标题通常稳定且一致。

## 实现方案

### 1. 数据库迁移

**创建** `sql/015_add_title_normalized.sql`:

```sql
-- 添加 title_normalized 字段用于标题去重
ALTER TABLE articles ADD COLUMN title_normalized TEXT;

-- 创建唯一索引（仅对非 NULL 值生效，历史数据为 NULL 不受影响）
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_title_normalized
ON articles(title_normalized)
WHERE title_normalized IS NOT NULL;
```

**更新** `scripts/migrate.ts` (在第100行附近添加):

```typescript
// ============================================================
// 015: 添加 title_normalized 字段用于标题去重
// ============================================================
if (file === '015_add_title_normalized.sql') {
  const hasTitleNormalized = hasColumn(db, 'articles', 'title_normalized');
  if (!hasTitleNormalized) {
    const sql = fs.readFileSync(fullPath, 'utf-8');
    db.exec(sql);
    console.log('      → Added title_normalized column and unique index');
  } else {
    console.log('      → Skipped (already exists)');
  }
  continue;
}
```

---

### 2. 标题规范化工具

**创建** `src/utils/title.ts`:

```typescript
/**
 * 规范化标题用于去重
 * - 转小写
 * - 移除标点和特殊字符
 * - 保留中文、字母、数字
 * - 压缩空白字符
 */
export function normalizeTitle(title: string): string | null {
  if (!title || typeof title !== 'string') return null;
  const trimmed = title.trim();
  if (trimmed.length === 0) return null;

  let normalized = trimmed.toLowerCase();
  normalized = normalized.replace(/[^\w\s\u4e00-\u9fff\u3400-\u4dbf]/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ');
  normalized = normalized.trim();

  return normalized.length > 0 ? normalized : null;
}

export function generateNormalizedTitle(title: string): string | null {
  const normalized = normalizeTitle(title);
  if (normalized && normalized.length > 500) {
    return normalized.substring(0, 500);
  }
  return normalized;
}
```

---

### 3. 数据库类型更新

**修改** `src/db.ts` (第67-91行 `ArticlesTable` 接口):

```typescript
export interface ArticlesTable {
  id: Generated<number>;
  rss_source_id: number | null;
  title: string;
  title_normalized: string | null;  // 新增
  url: string;
  // ... 其他字段保持不变
}
```

---

### 4. RSS 文章保存逻辑

**修改** `src/api/articles.ts`:

- **导入**: 添加 `import { generateNormalizedTitle } from '../utils/title.js';`
- **修改** `saveArticles` 函数 (第115-194行):

```typescript
// 生成规范化标题
const titleNormalized = generateNormalizedTitle(item.title);

// 检查标题是否已存在
const exists = await db
  .selectFrom('articles')
  .where('title_normalized', '=', titleNormalized)
  .select('id')
  .executeTakeFirst();

if (exists) {
  log.debug({ title: item.title, existingId: exists.id }, 'Article title exists, skipping');
  continue;
}

// 插入时添加 title_normalized 字段
const result = await db
  .insertInto('articles')
  .values({
    // ...
    title: item.title,
    title_normalized: titleNormalized,  // 新增
    url: item.link,
    // ...
  })
  .returning('id')
  .executeTakeFirst();
```

---

### 5. 爬虫文章保存逻辑

**修改** `src/journal-scheduler.ts`:

- **导入**: 添加 `import { generateNormalizedTitle } from './utils/title.js';`
- **修改** `saveArticles` 方法 (第398-473行):

```typescript
// 生成规范化标题
const titleNormalized = generateNormalizedTitle(article.title);

// 检查标题是否已存在
if (titleNormalized) {
  const existing = await db
    .selectFrom('articles')
    .where('title_normalized', '=', titleNormalized)
    .select('id')
    .executeTakeFirst();

  if (existing) {
    log.debug({ title: article.title, existingId: existing.id }, 'Article title exists, skipping');
    continue;
  }
}

// 插入时添加 title_normalized 字段
await db
  .insertInto('articles')
  .values({
    // ...
    title: article.title.trim(),
    title_normalized: titleNormalized,  // 新增
    url: article.url.trim(),
    // ...
  })
  .execute();
```

---

## 关键文件

| 文件 | 变更 |
|------|------|
| `sql/015_add_title_normalized.sql` | 新建 |
| `scripts/migrate.ts` | 添加 015 迁移处理 |
| `src/utils/title.ts` | 新建 |
| `src/db.ts` | `ArticlesTable` 添加 `title_normalized` 字段 |
| `src/api/articles.ts` | `saveArticles` 使用标题去重 |
| `src/journal-scheduler.ts` | `saveArticles` 使用标题去重 |

---

## 验证步骤

1. **执行迁移**: `pnpm run db:migrate`
2. **验证字段**: `PRAGMA table_info(articles);` 应显示 `title_normalized`
3. **验证索引**: `PRAGMA index_list(articles);` 应显示 `idx_articles_title_normalized`
4. **测试去重**:
   - 添加一篇新文章，检查 `title_normalized` 是否正确生成
   - 再次添加相同标题的文章，应被跳过
   - 检查日志输出确认去重逻辑正确触发

---

## 注意事项

- **历史数据**: 不迁移，`title_normalized` 为 NULL，不影响新文章
- **URL 约束**: 保留 `url UNIQUE` 作为兜底
- **NULL 处理**: 标题无法规范化时返回 null，不参与标题去重
