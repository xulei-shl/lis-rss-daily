# 每日总结分类优化方案

## 需求概述

将当前的每日总结功能从单一类型拆分为两类：
1. **期刊类总结**：仅包含 `journal` 类型 RSS 源的文章
2. **博客资讯类总结**：包含 `blog` 和 `news` 类型 RSS 源的文章

### 用户交互设计
- **首页**：一个面板内用 Tab 切换两类总结，用户可选择生成哪一类
- **历史页面**：支持按类型筛选历史记录

---

## 一、数据库变更

### 1.1 新增字段

在 `daily_summaries` 表新增 `summary_type` 字段：

```sql
-- sql/009_add_summary_type.sql
ALTER TABLE daily_summaries ADD COLUMN summary_type TEXT DEFAULT 'all';

-- 更新现有数据，标记为 'all' 类型（兼容历史数据）
UPDATE daily_summaries SET summary_type = 'all' WHERE summary_type IS NULL;
```

### 1.2 字段定义

| 字段 | 类型 | 说明 |
|------|------|------|
| `summary_type` | TEXT | 总结类型：`journal`（期刊）、`blog_news`（博客资讯）、`all`（历史兼容） |

### 1.3 索引调整

```sql
-- 删除旧的唯一索引
DROP INDEX IF EXISTS idx_daily_summaries_user_date;

-- 创建新的复合索引（支持同一天多条不同类型总结）
CREATE UNIQUE INDEX idx_daily_summaries_user_date_type 
ON daily_summaries(user_id, summary_date, summary_type);
```

### 1.4 TypeScript 类型更新

修改 [`src/db.ts`](src/db.ts:163) 中的 `DailySummariesTable` 接口：

```typescript
export interface DailySummariesTable {
  id: number;
  user_id: number;
  summary_date: string;
  summary_type: 'journal' | 'blog_news' | 'all';  // 新增字段
  article_count: number;
  summary_content: string;
  articles_data: string;
  created_at: string;
}
```

---

## 二、API 接口变更

### 2.1 生成总结接口

**POST /api/daily-summary/generate**

新增请求参数：

```typescript
interface GenerateSummaryRequest {
  date?: string;        // 可选，默认今天
  limit?: number;       // 可选，默认 30
  type?: 'journal' | 'blog_news';  // 新增：总结类型
}
```

响应变更：

```typescript
interface GenerateSummaryResponse {
  date: string;
  type: 'journal' | 'blog_news';  // 新增
  totalArticles: number;
  articlesByType: {
    journal: Article[];
    blog: Article[];
    news: Article[];
  };
  summary: string;
  generatedAt: string;
}
```

### 2.2 获取今日总结接口

**GET /api/daily-summary/today**

新增查询参数：

```
GET /api/daily-summary/today?type=journal
GET /api/daily-summary/today?type=blog_news
```

如果不传 `type` 参数，返回两类总结的概览：

```typescript
interface TodaySummaryResponse {
  journal?: SummaryBrief;
  blog_news?: SummaryBrief;
}

interface SummaryBrief {
  summary_date: string;
  article_count: number;
  created_at: string;
  // 不包含 summary_content，需要详情时调用详情接口
}
```

### 2.3 获取指定日期总结

**GET /api/daily-summary/:date**

新增查询参数：

```
GET /api/daily-summary/2026-02-16?type=journal
```

### 2.4 历史列表接口

**GET /api/daily-summary/history**

新增查询参数：

```
GET /api/daily-summary/history?type=journal&limit=30
```

响应变更：

```typescript
interface HistoryResponse {
  history: HistoryItem[];
}

interface HistoryItem {
  id: number;
  summary_date: string;
  summary_type: 'journal' | 'blog_news' | 'all';  // 新增
  article_count: number;
  created_at: string;
}
```

### 2.5 CLI 接口

**POST /api/daily-summary/cli**

新增请求参数：

```typescript
interface CliSummaryRequest {
  date?: string;
  limit?: number;
  type?: 'journal' | 'blog_news';  // 新增
  generateAll?: boolean;  // 新增：是否同时生成两类总结
}
```

---

## 三、服务层变更

### 3.1 修改 [`src/api/daily-summary.ts`](src/api/daily-summary.ts)

#### 3.1.1 新增类型定义

```typescript
export type SummaryType = 'journal' | 'blog_news' | 'all';

export interface DailySummaryInput {
  userId: number;
  date?: string;
  limit?: number;
  type?: SummaryType;  // 新增
}
```

#### 3.1.2 修改文章获取逻辑

```typescript
export async function getDailyPassedArticles(
  userId: number,
  dateStr: string,
  limit: number = 30,
  type?: SummaryType  // 新增参数
): Promise<DailySummaryArticle[]> {
  // ... 现有查询逻辑 ...
  
  // 根据类型筛选 source_type
  if (type === 'journal') {
    query = query.where('rss_sources.source_type', '=', 'journal');
  } else if (type === 'blog_news') {
    query = query.where('rss_sources.source_type', 'in', ['blog', 'news']);
  }
  // type 为 undefined 或 'all' 时不筛选
  
  // ... 继续执行查询 ...
}
```

#### 3.1.3 修改保存逻辑

```typescript
export async function saveDailySummary(input: SaveDailySummaryInput): Promise<void> {
  const { userId, date, type, articleCount, summaryContent, articlesData } = input;
  
  await db
    .insertInto('daily_summaries')
    .values({
      user_id: userId,
      summary_date: date,
      summary_type: type,  // 新增
      article_count: articleCount,
      summary_content: summaryContent,
      articles_data: articlesJson,
      created_at: new Date().toISOString(),
    })
    .onConflict((oc) =>
      oc.columns(['user_id', 'summary_date', 'summary_type']).doUpdateSet({
        // 更新冲突处理
      })
    )
    .execute();
}
```

#### 3.1.4 修改查询逻辑

```typescript
export async function getDailySummaryByDate(
  userId: number,
  date: string,
  type?: SummaryType  // 新增参数
): Promise<DailySummariesTable | undefined> {
  let query = db
    .selectFrom('daily_summaries')
    .where('user_id', '=', userId)
    .where('summary_date', '=', date);
  
  if (type) {
    query = query.where('summary_type', '=', type);
  }
  
  return query.selectAll().executeTakeFirst();
}
```

---

## 四、前端变更

### 4.1 首页面板改造 [`src/views/index.ejs`](src/views/index.ejs:31)

#### 4.1.1 HTML 结构调整

```html
<!-- Daily Summary Panel -->
<div class="daily-summary-panel" id="dailySummaryPanel">
  <div class="summary-panel-header" id="summaryPanelHeader">
    <!-- 保持现有头部结构 -->
  </div>

  <div class="summary-panel-content" id="summaryPanelContent">
    <!-- 新增 Tab 切换 -->
    <div class="summary-tabs">
      <button class="summary-tab active" data-type="journal">
        <span class="tab-icon">📚</span>
        期刊精选
      </button>
      <button class="summary-tab" data-type="blog_news">
        <span class="tab-icon">📝</span>
        博客资讯
      </button>
    </div>

    <!-- Tab 内容区域 -->
    <div class="summary-tab-content" id="summaryTabContent">
      <!-- Loading State -->
      <div class="summary-loading" id="summaryLoading" style="display: none;">
        <!-- 保持现有结构 -->
      </div>

      <!-- Empty State -->
      <div class="summary-empty" id="summaryEmpty" style="display: none;">
        <p id="emptyMessage">点击下方按钮生成今日期刊总结</p>
        <button class="btn btn-primary" id="generateBtn">生成总结</button>
      </div>

      <!-- Result State -->
      <div class="summary-result" id="summaryResult" style="display: none;">
        <!-- 保持现有结构 -->
      </div>

      <!-- Error State -->
      <div class="summary-error" id="summaryError" style="display: none;"></div>
    </div>
  </div>
</div>
```

#### 4.1.2 CSS 样式新增

在 [`src/public/css/components/daily-summary.css`](src/public/css/components/daily-summary.css) 中新增：

```css
/* Summary Tabs */
.summary-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 16px;
}

.summary-tab {
  flex: 1;
  padding: 12px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.summary-tab:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.summary-tab.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
}

.tab-icon {
  font-size: 16px;
}

/* Tab badge for article count */
.tab-badge {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 10px;
  margin-left: 4px;
}

.summary-tab.active .tab-badge {
  background: var(--primary-light);
  color: var(--primary-color);
}
```

### 4.2 JavaScript 逻辑改造 [`src/public/js/daily-summary.js`](src/public/js/daily-summary.js)

#### 4.2.1 状态管理

```javascript
// 当前选中的 Tab 类型
let currentSummaryType = 'journal';

// Tab 切换处理
document.querySelectorAll('.summary-tab').forEach(tab => {
  tab.addEventListener('click', async (e) => {
    const type = tab.dataset.type;
    if (type === currentSummaryType) return;
    
    // 切换 Tab 样式
    document.querySelectorAll('.summary-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    currentSummaryType = type;
    
    // 更新空状态提示文字
    const emptyMessage = document.getElementById('emptyMessage');
    emptyMessage.textContent = type === 'journal' 
      ? '点击下方按钮生成今日期刊总结' 
      : '点击下方按钮生成今日博客资讯总结';
    
    // 重新加载当前类型的总结
    await loadTodaySummary(type);
  });
});
```

#### 4.2.2 加载逻辑修改

```javascript
// Load today's summary
async function loadTodaySummary(type = currentSummaryType) {
  showSummaryLoading();

  try {
    const res = await fetch(`/api/daily-summary/today?type=${type}`);

    if (res.status === 404) {
      showSummaryEmpty();
      return;
    }

    if (!res.ok) {
      throw new Error('Failed to load summary');
    }

    const data = await res.json();
    showSummaryResult(data.summary_date, data.article_count, data.summary_content, data.created_at, type);
  } catch (err) {
    console.error('Failed to load summary:', err);
    showSummaryError('加载失败，请重试');
  }
}

// Generate new summary
async function generateDailySummary() {
  showSummaryLoading();

  try {
    const res = await fetch('/api/daily-summary/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        limit: 30,
        type: currentSummaryType  // 新增类型参数
      })
    });

    if (!res.ok) {
      throw new Error('Failed to generate summary');
    }

    const data = await res.json();
    showSummaryResult(data.date, data.totalArticles, data.summary, data.generatedAt, data.type);
  } catch (err) {
    console.error('Failed to generate summary:', err);
    showSummaryError('生成失败，请重试');
  }
}
```

### 4.3 历史页面改造 [`src/views/history.ejs`](src/views/history.ejs)

#### 4.3.1 新增类型筛选器

```html
<!-- Search & Filters -->
<div class="filters-bar">
  <!-- 现有搜索框 -->
  <div class="search-box">
    <!-- 保持不变 -->
  </div>
  
  <!-- 新增类型筛选 -->
  <div class="filter-group">
    <span class="filter-label">类型</span>
    <select id="typeFilter" class="filter-select">
      <option value="">全部类型</option>
      <option value="journal">期刊精选</option>
      <option value="blog_news">博客资讯</option>
    </select>
  </div>
  
  <!-- 现有年月筛选 -->
  <div class="filter-group">
    <!-- 保持不变 -->
  </div>
</div>
```

### 4.4 历史页面 JavaScript 改造 [`src/public/js/history.js`](src/public/js/history.js)

#### 4.4.1 筛选逻辑修改

```javascript
// 新增类型筛选器引用
const typeFilter = document.getElementById('typeFilter');

// 更新筛选事件监听
typeFilter.addEventListener('change', () => {
  currentPage = 1;
  filterAndRender();
});

// 更新筛选函数
function filterAndRender() {
  const searchQuery = searchInput.value.trim();
  const selectedYear = yearFilter.value;
  const selectedMonth = monthFilter.value;
  const selectedType = typeFilter.value;  // 新增

  filteredHistory = allHistory.filter(item => {
    // 类型筛选
    if (selectedType && item.summary_type !== selectedType) return false;
    
    // 其他筛选逻辑保持不变
    // ...
  });

  renderHistory();
  renderPagination();
  renderResultsCount();
}
```

#### 4.4.2 历史项渲染修改

```javascript
function renderHistoryItem(item) {
  // 类型标签
  const typeLabel = {
    'journal': '期刊',
    'blog_news': '博客资讯',
    'all': '综合'
  };
  
  return `
    <div class="history-item-card" onclick="window.historyPage.viewSummary('${item.summary_date}', '${item.summary_type}')">
      <div class="history-item-header">
        <span class="history-item-date">${item.summary_date}</span>
        <span class="history-item-type badge-${item.summary_type}">${typeLabel[item.summary_type] || '综合'}</span>
      </div>
      <div class="history-item-meta">
        <span class="history-item-count">${item.article_count} 篇章</span>
        <span class="history-item-time">${formatDate(item.created_at)}</span>
      </div>
    </div>
  `;
}
```

---

## 五、实施步骤

### 阶段一：数据库迁移
1. 创建迁移脚本 `sql/009_add_summary_type.sql`
2. 执行迁移，添加 `summary_type` 字段
3. 更新 TypeScript 类型定义

### 阶段二：后端 API 改造
1. 修改 `src/api/daily-summary.ts` 服务层
2. 修改 `src/api/routes/daily-summary.routes.ts` 路由层
3. 更新 CLI 脚本 `scripts/cli-daily-summary.ts`

### 阶段三：前端改造
1. 更新首页 HTML 结构
2. 添加 Tab 切换 CSS 样式
3. 改造 `daily-summary.js` 逻辑
4. 改造历史页面筛选功能

### 阶段四：测试验证
1. 测试两类总结的生成
2. 测试 Tab 切换功能
3. 测试历史页面筛选
4. 测试 CLI 命令

---

## 六、兼容性考虑

### 6.1 历史数据兼容
- 现有总结记录的 `summary_type` 默认为 `'all'`
- 前端展示时，`'all'` 类型显示为"综合"标签
- 查询时不传 `type` 参数可获取所有类型

### 6.2 API 向后兼容
- 所有新增参数均为可选
- 不传 `type` 参数时保持原有行为

### 6.3 CLI 兼容
- 现有 CLI 命令保持兼容
- 新增 `--type` 参数支持指定类型
- 新增 `--all` 参数支持同时生成两类

---

## 七、文件变更清单

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `sql/009_add_summary_type.sql` | 新增 | 数据库迁移脚本 |
| `src/db.ts` | 修改 | 更新类型定义 |
| `src/api/daily-summary.ts` | 修改 | 服务层逻辑 |
| `src/api/routes/daily-summary.routes.ts` | 修改 | API 路由 |
| `scripts/cli-daily-summary.ts` | 修改 | CLI 脚本 |
| `src/views/index.ejs` | 修改 | 首页 HTML |
| `src/views/history.ejs` | 修改 | 历史页面 HTML |
| `src/public/js/daily-summary.js` | 修改 | 首页 JS |
| `src/public/js/history.js` | 修改 | 历史页面 JS |
| `src/public/css/components/daily-summary.css` | 修改 | 样式文件 |


---

变更文件清单
数据库层
新增 sql/009_add_summary_type.sql - 数据库迁移脚本，添加 summary_type 字段和新索引
修改 src/db.ts - 更新 DailySummariesTable 类型定义
后端 API 层
修改 src/api/daily-summary.ts - 服务层核心逻辑

新增 SummaryType 类型定义
修改 getDailyPassedArticles() 支持按类型筛选文章
修改 generateDailySummary() 支持生成指定类型总结
修改 saveDailySummary() 保存类型字段
修改 getDailySummaryByDate() 和 getDailySummaryHistory() 支持类型参数
修改 src/api/routes/daily-summary.routes.ts - API 路由层

所有接口新增 type 参数支持
CLI 接口新增 --all 参数支持同时生成两类总结
修改 scripts/cli-daily-summary.ts - CLI 工具

新增 --type 参数指定总结类型
新增 --all 参数同时生成两类总结
前端层
修改 src/views/index.ejs - 首页 HTML

新增 Tab 切换组件（期刊精选 / 博客资讯）
新增文章数量徽章显示
修改 src/public/js/daily-summary.js - 首页 JS 逻辑

实现 Tab 切换功能
按类型加载和生成总结
更新历史记录弹窗显示类型标签
修改 src/views/history.ejs - 历史页面 HTML

新增类型筛选下拉框
修改 src/public/js/history.js - 历史页面 JS 逻辑

实现类型筛选功能
更新历史项显示类型标签
修改 src/public/css/components/daily-summary.css - 样式文件

新增 Tab 切换样式
新增类型徽章样式（期刊/博客资讯/综合）
使用说明
部署前需执行数据库迁移
sqlite3 data/database.db < sql/009_add_summary_type.sql
CLI 使用示例
# 生成期刊类总结
tsx scripts/cli-daily-summary.ts -u 1 --type journal

# 生成博客资讯类总结
tsx scripts/cli-daily-summary.ts -u 1 --type blog_news

# 同时生成两类总结
tsx scripts/cli-daily-summary.ts -u 1 --all
API 使用示例
# 生成期刊类总结
POST /api/daily-summary/generate {"type": "journal"}

# 获取今日期刊类总结
GET /api/daily-summary/today?type=journal

# 获取历史博客资讯类总结
GET /api/daily-summary/history?type=blog_news