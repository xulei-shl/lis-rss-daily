# 文章星级评分功能实现计划

## Context

为每篇通过的文章添加打等级功能（1-5星），支持admin操作、guest只读查看，并在多个页面显示评级和筛选功能。

---

## 实现步骤

### 阶段一：数据库迁移

#### 1.1 创建迁移脚本 `sql/019_add_article_rating.sql`

```sql
-- ===========================================
-- 添加文章评级字段
-- 用于给通过的文章打等级（1-5星）
-- ===========================================

ALTER TABLE articles ADD COLUMN rating INTEGER CHECK(rating IS NULL OR (rating >= 1 AND rating <= 5));

CREATE INDEX IF NOT EXISTS idx_articles_rating ON articles(rating) WHERE rating IS NOT NULL;
```

#### 1.2 同步修改 `sql/001_init.sql`

在 articles 表定义中添加 `rating INTEGER CHECK(...)`

#### 1.3 更新 `scripts/migrate.ts`

添加 019 迁移脚本的执行逻辑（使用 `hasColumn` 检查幂等性）

#### 1.4 更新类型定义 `src/db.ts`

在 `ArticlesTable` 接口添加：
```typescript
rating: number | null;
```

---

### 阶段二：后端 API

#### 2.1 服务层 `src/api/articles.ts`

**修改点：**
1. `ArticleWithSource` 接口添加 `rating: number | null`
2. `getUserArticles()` 函数：
   - select 添加 `articles.rating`
   - options 参数添加 `rating?: number` 和 `ratingNull?: boolean`
   - 查询条件添加 rating 筛选逻辑
3. `getArticleById()` 函数 select 添加 `articles.rating`
4. 新增 `updateArticleRating()` 函数

#### 2.2 API路由 `src/api/routes/articles.routes.ts`

**修改点：**
1. GET `/api/articles` 路由：解析 `rating` 和 `ratingNull` 查询参数
2. 新增 PATCH `/api/articles/:id/rating` 路由：
   - 使用 `requireAuth` + `requireWriteAccess` 中间件
   - 请求体：`{ rating: number | null }`

---

### 阶段三：前端组件

#### 3.1 创建样式文件 `src/public/css/components/rating.css`

```css
.rating-container { display: inline-flex; align-items: center; gap: 2px; }
.rating-star { color: var(--border-strong); font-size: 14px; }
.rating-star.filled { color: #fbbf24; }
.rating-input .rating-star { cursor: pointer; }
.rating-input .rating-star:hover { color: #fbbf24; }
.rating-input .rating-star.active { color: #fbbf24; }
```

#### 3.2 创建组件脚本 `src/public/js/rating.js`

```javascript
// renderRatingDisplay(rating) - 只读显示（灰色空星也可见）
// renderRatingInput(articleId, rating, isGuest) - 交互输入
//   - isGuest=true: 只读显示，灰色空星可见，点击无响应
//   - isGuest=false: 可点击交互，设置/清除评级
// updateRating(articleId, rating) - API调用
// initRatingInputs() - 事件监听初始化
```

---

### 阶段四：页面修改

#### 4.1 首页 `src/views/index.ejs` + `src/public/js/home.js`

**index.ejs:**
- 添加 `rating.css` 样式引用
- 添加 `rating.js` 脚本引用

**home.js renderArticleCard():**
- 在 `article-meta` 的"原文链接"后添加评级组件
- 调用 `renderRatingInput(article.id, article.rating, window.userRole === 'guest')`
- admin 可点击交互，guest 只读显示

#### 4.2 列表页 `src/views/articles.ejs`

**修改点：**
1. 添加样式和脚本引用
2. 在"爬取日期"筛选器后添加"评级"筛选下拉框
3. `setupEventListeners()` 添加 `filterRating` change 事件
4. `loadArticles()` 添加 rating 参数构建
5. `renderArticleCard()` 添加评级组件
   - 调用 `renderRatingInput(article.id, article.rating, isGuest)`
   - admin 可点击交互，guest 只读显示

**筛选器位置：**
```html
<!-- 第一行：来源 + 爬取日期 + 评级 -->
<div class="filter-row filter-row-equal">
  <div class="filter-group">来源...</div>
  <div class="filter-group date-group">爬取日期...</div>
  <div class="filter-group">
    <span class="filter-label">评级</span>
    <select id="filterRating" class="filter-select">
      <option value="">全部</option>
      <option value="unrated">未评级</option>
      <option value="5">★★★★★</option>
      <option value="4">★★★★</option>
      <option value="3">★★★</option>
      <option value="2">★★</option>
      <option value="1">★</option>
    </select>
  </div>
</div>
```

#### 4.3 详情页 `src/views/article-detail.ejs` + `src/public/js/article-detail.js`

**修改点：**
1. 添加样式和脚本引用
2. `renderArticle()` 的 metaHtml 中，在"原文链接"后添加评级交互组件
3. 调用 `renderRatingInput(article.id, article.rating, window.userRole === 'guest')`

---

## 关键文件清单

| 文件路径 | 操作 |
|---------|------|
| `sql/019_add_article_rating.sql` | 新建 |
| `sql/001_init.sql` | 修改 |
| `scripts/migrate.ts` | 修改 |
| `src/db.ts` | 修改 |
| `src/api/articles.ts` | 修改 |
| `src/api/routes/articles.routes.ts` | 修改 |
| `src/public/css/components/rating.css` | 新建 |
| `src/public/js/rating.js` | 新建 |
| `src/views/index.ejs` | 修改 |
| `src/public/js/home.js` | 修改 |
| `src/views/articles.ejs` | 修改 |
| `src/views/article-detail.ejs` | 修改 |
| `src/public/js/article-detail.js` | 修改 |

---

## 验证步骤

1. **数据库迁移验证**
   - 运行 `pnpm run db:migrate`
   - 检查 articles 表是否有 rating 字段

2. **API 测试**
   - PATCH `/api/articles/:id/rating` 设置评级
   - GET `/api/articles?rating=5` 筛选5星文章
   - GET `/api/articles?ratingNull=true` 筛选未评级文章

3. **前端功能测试**
   - 首页卡片显示评级（admin 可点击交互，guest 只读显示灰色空星）
   - 列表页筛选器按评级筛选
   - 列表页卡片显示评级（admin 可点击交互，guest 只读显示灰色空星）
   - 详情页"原文链接"后显示评级组件（admin 可点击交互，guest 只读显示灰色空星）
   - admin 点击星级设置评级，guest 点击无响应（但能看到灰色空星）

4. **权限验证**
   - guest 用户能看到灰色空星（未评级），点击无响应
   - admin 用户可正常设置和清除评级

---

## 空值处理说明

- `rating = NULL` 表示未评级
- 筛选时：
  - `rating=1-5` 筛选对应星级
  - `ratingNull=true` 筛选未评级文章
- 显示时：
  - 未评级显示灰色空星（admin 和 guest 均可见）
  - 已评级显示金色实心星
- 权限区分：
  - admin：可点击交互，设置/清除评级
  - guest：只读显示，点击无响应，灰色空星也可见
