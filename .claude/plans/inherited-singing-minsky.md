# 语义搜索页面 AI 总结功能

## Context

用户希望在语义搜索页面添加手动触发总结功能：允许用户勾选搜索结果中的文章，点击"AI总结"按钮生成总结，保存到数据库，并可在历史总结页面查看。

## 实现方案

### 一、后端修改

#### 1.1 类型定义更新

**文件**: `src/api/daily-summary.ts`

```typescript
// 更新 SummaryType 类型
export type SummaryType = 'journal' | 'blog_news' | 'all' | 'search';
```

**文件**: `src/db.ts`

```typescript
// 更新 DailySummariesTable 接口
export interface DailySummariesTable {
  // ...
  summary_type: 'journal' | 'blog_news' | 'all' | 'search';
  // ...
}
```

#### 1.2 新增服务函数

**文件**: `src/api/daily-summary.ts`

新增以下函数：

```typescript
/**
 * 根据文章 ID 列表生成搜索总结
 */
export async function generateSearchSummary(
  userId: number,
  articleIds: number[]
): Promise<DailySummaryResult> {
  // 1. 查询文章（复用现有查询模式）
  // 2. 按类型分组
  // 3. 调用 LLM 生成总结（复用 generateDailySummary 的逻辑）
  // 4. 返回结果
}
```

#### 1.3 新增 API 路由

**文件**: `src/api/routes/search.routes.ts`

```typescript
// POST /api/search/summary
// 权限: requireWriteAccess (admin only)
router.post('/search/summary', requireAuth, requireWriteAccess, async (req: AuthRequest, res) => {
  const { articleIds } = req.body;

  // 验证
  if (!articleIds || articleIds.length === 0) {
    return res.status(400).json({ error: '请选择至少一篇文章' });
  }
  if (articleIds.length > 50) {
    return res.status(400).json({ error: '最多选择 50 篇文章' });
  }

  // 生成总结（自动保存到数据库）
  const result = await generateSearchSummary(req.userId!, articleIds);

  res.json(result);
});
```

### 二、前端修改

#### 2.1 搜索页面 UI

**文件**: `src/views/search.ejs`

1. **在 resultsHeader 中添加批量操作栏**（有搜索结果时显示）：
```html
<div class="results-actions" id="resultsActions" style="display: none;">
  <div class="selection-controls">
    <label class="checkbox-wrapper">
      <input type="checkbox" id="selectAll">
      <span>全选</span>
    </label>
    <span class="selected-count">已选 <span id="selectedCount">0</span> 篇</span>
  </div>
  <button id="aiSummaryBtn" class="btn btn-primary">AI 总结</button>
</div>
```

2. **在 renderSearchResult 中添加复选框**：
```html
<input type="checkbox" class="article-checkbox" data-id="${result.id}">
```

3. **添加总结弹窗**（自动保存，只显示复制按钮）：
```html
<div class="modal-overlay" id="summaryModal">
  <div class="modal modal-large">
    <div class="modal-header">
      <h3>AI 总结</h3>
      <button class="modal-close">×</button>
    </div>
    <div class="modal-body" id="modalBody"></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeSummaryModal()">关闭</button>
      <button class="btn btn-primary" onclick="copySummary()">复制内容</button>
    </div>
  </div>
</div>
```

4. **JavaScript 逻辑**（支持跨页选择）：
```javascript
// 状态管理
let selectedArticles = new Set();  // 跨页保持选中状态
let currentResults = [];  // 当前页结果
const isAdmin = window.userRole !== 'guest';
const MAX_SELECTION = 50;

// 选择逻辑
function updateSelection() {
  const checkboxes = document.querySelectorAll('.article-checkbox');
  selectedArticles.clear();
  checkboxes.forEach(cb => {
    if (cb.checked) selectedArticles.add(parseInt(cb.dataset.id));
  });
  updateSelectionUI();
}

function toggleSelectAll() {
  const selectAll = document.getElementById('selectAll');
  const checkboxes = document.querySelectorAll('.article-checkbox');
  checkboxes.forEach(cb => cb.checked = selectAll.checked);
  updateSelection();
}

function updateSelectionUI() {
  const count = selectedArticles.size;
  document.getElementById('selectedCount').textContent = count;
  document.getElementById('resultsActions').style.display = count > 0 ? 'flex' : 'none';

  // 同步全选框状态
  const checkboxes = document.querySelectorAll('.article-checkbox');
  const allChecked = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
  document.getElementById('selectAll').checked = allChecked;
}

// 渲染搜索结果时恢复选中状态
function renderSearchResult(result, index) {
  // ...
  const checked = selectedArticles.has(result.id) ? 'checked' : '';
  // ...
}

// AI 总结（自动保存）
async function generateAISummary() {
  const ids = Array.from(selectedArticles);
  if (ids.length > MAX_SELECTION) {
    window.toast?.error(`最多选择 ${MAX_SELECTION} 篇文章`);
    return;
  }

  const res = await fetch('/api/search/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articleIds: ids })
  });
  const data = await res.json();
  renderSummaryInModal(data);  // 已自动保存，只显示内容
}
```

#### 2.2 样式更新

**文件**: `src/public/css/pages/search.css`

添加批量操作栏和复选框样式：
```css
.results-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-4);
  background: var(--bg-subtle);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-4);
}

.selection-controls {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.article-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
}
```

#### 2.3 历史页面更新

**文件**: `src/views/history.ejs`

在类型筛选器添加"搜索总结"选项：
```html
<option value="search">搜索总结</option>
```

**文件**: `src/public/js/history.js`

更新 typeLabels：
```javascript
const typeLabels = {
  journal: '期刊精选',
  blog_news: '博客资讯',
  all: '综合',
  search: '搜索总结'  // 新增
};
```

### 三、权限控制

- **前端**: AI 总结按钮仅在 `window.userRole !== 'guest'` 时显示
- **后端**: 使用 `requireWriteAccess` 中间件

### 四、修改文件清单

| 文件 | 修改类型 |
|------|----------|
| `src/api/daily-summary.ts` | 修改类型定义，新增函数 |
| `src/db.ts` | 更新类型定义 |
| `src/api/routes/search.routes.ts` | 新增路由 |
| `src/views/search.ejs` | 添加 UI 组件和 JS 逻辑 |
| `src/views/history.ejs` | 添加筛选选项 |
| `src/public/js/history.js` | 更新类型标签 |
| `src/public/css/pages/search.css` | 添加样式 |

### 五、验证测试

1. 搜索文章 → 勾选 → 点击 AI 总结 → 查看弹窗结果
2. 测试全选/取消全选功能
3. 验证 guest 用户看不到 AI 总结按钮
4. 历史页面筛选"搜索总结"类型可正常显示
5. 复制总结内容功能正常
