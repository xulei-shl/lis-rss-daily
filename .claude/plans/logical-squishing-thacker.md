# AI 摘要编辑和删除功能实现计划

## Context

文章详情页面的 AI 总结（`class="ai-summary" id="aiSummary"`）目前是只读显示的。需要为 admin 用户添加编辑和删除功能，允许他们直接在页面上修改或删除 AI 摘要内容，并实时同步到数据库。

## 实现计划

### 1. 后端 API：添加删除 AI 摘要路由

**文件**: `/opt/lis-rss-daily/src/api/routes/articles.routes.ts`

在现有的 `PATCH /api/articles/:id/ai-summary` 路由之后，添加删除路由：

```typescript
/**
 * DELETE /api/articles/:id/ai-summary
 * Delete article AI summary
 * Requires admin role (not guest)
 */
router.delete('/articles/:id/ai-summary', requireAuth, requireWriteAccess, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (typeof idParam !== 'string') {
      return res.status(400).json({ error: 'Invalid article ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid article ID' });
    }

    await articleService.updateArticleAiSummary(id, req.effectiveUserId!, null);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Article not found') {
      return res.status(404).json({ error: 'Article not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to delete article AI summary');
    res.status(500).json({ error: 'Failed to delete article AI summary' });
  }
});
```

**说明**:
- 复用现有的 `updateArticleAiSummary` 函数，传入 `null` 来删除 AI 摘要
- 使用 `requireWriteAccess` 中间件确保只有 admin 可以操作

### 2. 前端模板：添加编辑/删除按钮

**文件**: `/opt/lis-rss-daily/src/views/article-detail.ejs`

修改 AI 总结区域的标题部分，在标题后添加操作按钮：

```html
<!-- AI 总结 -->
<section class="article-section" id="aiSummarySection" style="display: none;">
  <div class="section-header-with-actions">
    <h2 class="section-header">AI 总结</h2>
    <div class="section-actions" id="aiSummaryActions" style="display: none;">
      <button id="editAiSummaryBtn" class="icon-btn" title="编辑 AI 总结">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
      <button id="deleteAiSummaryBtn" class="icon-btn icon-btn-danger" title="删除 AI 总结">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 22 12 3 21 22"></polyline>
          <line x1="8.5" y1="7" x2="15.5" y2="15.5"></line>
        </svg>
      </button>
    </div>
  </div>
  <div class="ai-summary" id="aiSummary"></div>
</section>
```

### 3. 前端样式：添加操作按钮样式

**文件**: `/opt/lis-rss-daily/src/public/css/pages/article-detail.css`

在样式文件中添加：

```css
/* Section header with actions */
.section-header-with-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.section-header {
  margin-bottom: 0;
}

.section-actions {
  display: flex;
  gap: var(--space-2);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-1);
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.icon-btn-danger:hover {
  background: var(--color-danger-bg);
  color: var(--color-danger);
  border-color: var(--color-danger);
}

/* Edit textarea */
.edit-textarea {
  width: 100%;
  min-height: 200px;
  padding: var(--space-3);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  line-height: 1.6;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-primary);
  resize: vertical;
}

.edit-textarea:focus {
  outline: none;
  border-color: var(--accent-primary);
}

/* Edit actions */
.edit-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
```

### 4. 前端 JavaScript：实现编辑和删除逻辑

**文件**: `/opt/lis-rss-daily/src/public/js/article-detail.js`

在现有代码中添加以下内容：

#### 4.1 页面初始化时显示 admin 操作按钮

在 `DOMContentLoaded` 事件处理中的访客检查逻辑后添加：

```javascript
// Admin 模式：显示 AI 总结操作按钮
if (window.userRole === 'admin') {
  const aiSummaryActions = document.getElementById('aiSummaryActions');
  if (aiSummaryActions) {
    aiSummaryActions.style.display = 'flex';
  }

  // 绑定编辑和删除按钮事件
  document.getElementById('editAiSummaryBtn').addEventListener('click', editAiSummary);
  document.getElementById('deleteAiSummaryBtn').addEventListener('click', deleteAiSummary);
}
```

#### 4.2 添加编辑 AI 摘要函数

```javascript
// 编辑 AI 总结
async function editAiSummary() {
  if (!articleData) return;

  const aiSummarySection = document.getElementById('aiSummarySection');
  const aiSummaryDiv = document.getElementById('aiSummary');
  const currentContent = articleData.ai_summary || '';

  // 创建编辑界面
  aiSummaryDiv.innerHTML =
    '<textarea id="aiSummaryTextarea" class="edit-textarea">' + escapeHtml(currentContent) + '</textarea>' +
    '<div class="edit-actions">' +
      '<button id="saveAiSummaryBtn" class="btn btn-primary">保存</button>' +
      '<button id="cancelAiSummaryBtn" class="btn btn-secondary">取消</button>' +
    '</div>';

  // 绑定保存和取消按钮
  document.getElementById('saveAiSummaryBtn').addEventListener('click', saveAiSummary);
  document.getElementById('cancelAiSummaryBtn').addEventListener('click', cancelEditAiSummary);
}

// 保存 AI 总结
async function saveAiSummary() {
  if (!articleData) return;

  const textarea = document.getElementById('aiSummaryTextarea');
  const newContent = textarea.value;

  try {
    const res = await fetch('/api/articles/' + articleData.id + '/ai-summary', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ai_summary: newContent })
    });

    if (!res.ok) {
      const result = await res.json();
      throw new Error(result.error || '保存失败');
    }

    // 更新本地数据
    articleData.ai_summary = newContent;

    // 恢复显示模式
    if (newContent) {
      document.getElementById('aiSummary').innerHTML = formatMarkdown(newContent);
    } else {
      // 如果内容为空，隐藏整个区域
      document.getElementById('aiSummarySection').style.display = 'none';
    }

    window.toast.success('AI 总结已更新');
  } catch (err) {
    console.error('Failed to save AI summary:', err);
    window.toast.error(err.message || '保存失败，请稍后重试');
  }
}

// 取消编辑
function cancelEditAiSummary() {
  if (!articleData) return;

  // 恢复显示模式
  if (articleData.ai_summary) {
    document.getElementById('aiSummary').innerHTML = formatMarkdown(articleData.ai_summary);
  } else {
    document.getElementById('aiSummarySection').style.display = 'none';
  }
}
```

#### 4.3 添加删除 AI 摘要函数

```javascript
// 删除 AI 总结
async function deleteAiSummary() {
  if (!articleData) return;

  const confirmed = await showConfirm('确定要删除 AI 总结吗？此操作不可撤销。', {
    title: '删除 AI 总结',
    okText: '删除',
    cancelText: '取消'
  });

  if (!confirmed) return;

  try {
    const res = await fetch('/api/articles/' + articleData.id + '/ai-summary', {
      method: 'DELETE'
    });

    if (!res.ok) {
      const result = await res.json();
      throw new Error(result.error || '删除失败');
    }

    // 更新本地数据
    articleData.ai_summary = null;

    // 隐藏 AI 总结区域
    document.getElementById('aiSummarySection').style.display = 'none';

    window.toast.success('AI 总结已删除');
  } catch (err) {
    console.error('Failed to delete AI summary:', err);
    window.toast.error(err.message || '删除失败，请稍后重试');
  }
}
```

## 关键文件路径

| 文件类型 | 路径 |
|---------|------|
| 后端路由 | `/opt/lis-rss-daily/src/api/routes/articles.routes.ts` |
| 前端模板 | `/opt/lis-rss-daily/src/views/article-detail.ejs` |
| 前端样式 | `/opt/lis-rss-daily/src/public/css/pages/article-detail.css` |
| 前端脚本 | `/opt/lis-rss-daily/src/public/js/article-detail.js` |
| 服务层（已存在） | `/opt/lis-rss-daily/src/api/articles.ts` |

## 验证步骤

1. 以 admin 用户身份登录
2. 打开一篇有 AI 总结的文章详情页
3. 验证 AI 总结标题右侧显示编辑和删除图标按钮
4. 点击编辑按钮，验证出现编辑文本框
5. 修改内容并保存，验证内容更新且数据库同步
6. 点击删除按钮，确认后验证 AI 总结区域被隐藏
7. 刷新页面，验证删除状态持久化
8. 以 guest 用户身份登录，验证不显示编辑/删除按钮
