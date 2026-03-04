// ============================================
// 文章详情页逻辑
// ============================================

let articleData = null;

// 检查向量配置
async function checkVectorConfig() {
  try {
    const res = await fetch('/api/articles/vector-check');
    if (!res.ok) return;

    const data = await res.json();

    if (!data.ready) {
      const warnings = [];
      if (!data.embedding.configured) {
        warnings.push('<li>' + escapeHtml(data.embedding.message) + '</li>');
      }
      if (data.chroma.status !== 'available') {
        warnings.push('<li>' + escapeHtml(data.chroma.message) + '</li>');
      }

      if (warnings.length > 0) {
        const warningDiv = document.getElementById('vectorConfigWarning');
        const warningList = document.getElementById('vectorConfigWarnings');
        warningList.innerHTML = warnings.join('');
        warningDiv.style.display = 'block';
      }
    }
  } catch (err) {
    console.error('Failed to check vector config:', err);
  }
}

// 页面就绪后加载文章
document.addEventListener('DOMContentLoaded', () => {
  // 移除尾部斜杠并解析文章 ID
  const pathname = window.location.pathname.replace(/\/$/, '');
  const pathParts = pathname.split('/');
  const articleId = parseInt(pathParts[pathParts.length - 1]);

  // 检查向量配置
  checkVectorConfig();

  // 访客模式：隐藏操作按钮
  if (window.userRole === 'guest') {
    const readBtn = document.getElementById('readBtn');
    const processBtn = document.getElementById('processBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    if (readBtn) readBtn.style.display = 'none';
    if (processBtn) processBtn.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
  }

  if (!isNaN(articleId)) {
    loadArticle(articleId);
  } else {
    console.error('Invalid article ID:', window.location.pathname);
    showError();
  }
});

// 加载文章数据
async function loadArticle(id) {
  try {
    const res = await fetch('/api/articles/' + id);

    if (!res.ok) {
      showError();
      return;
    }

    const article = await res.json();
    articleData = article;

    renderArticle(article);
    loadRelatedArticles(id);

    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('articleDetail').style.display = 'block';
  } catch (err) {
    console.error('Failed to load article:', err);
    showError();
  }
}

// 显示错误状态
function showError() {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('errorState').style.display = 'block';
}

// 渲染文章
function renderArticle(article) {
  // 标题
  document.getElementById('articleTitle').textContent = article.title;

  // 元信息
  const metaHtml =
    '<div class="article-meta-item">' +
      '<span>' + escapeHtml(article.source_name || article.rss_source_name || 'Unknown') + '</span>' +
    '</div>' +
    '<div class="article-meta-item">' +
      '<span>·</span>' +
    '</div>' +
    '<div class="article-meta-item">' +
      '<span>' + getPublishTimeText(article) + '</span>' +
    '</div>' +
    '<div class="article-meta-item">' +
      '<span>·</span>' +
    '</div>' +
    '<div class="article-meta-item">' +
      '<a href="' + escapeHtml(article.url) + '" target="_blank" rel="noopener">' +
        '原文链接' +
      '</a>' +
    '</div>' +
    '<div class="article-meta-item">' +
      '<span>·</span>' +
    '</div>' +
    '<div class="article-meta-item">' +
      renderRatingInput(article.id, article.rating, window.userRole === 'guest') +
    '</div>';
  document.getElementById('articleMeta').innerHTML = metaHtml;

  // 原文链接
  document.getElementById('originalLink').href = article.url;

  // 文章信息
  const statusLabels = {
    'passed': '通过',
    'rejected': '拒绝',
    'pending': '待处理'
  };
  const processLabels = {
    'pending': '待处理',
    'processing': '处理中',
    'completed': '已完成',
    'failed': '失败'
  };

  document.getElementById('filterStatus').textContent = statusLabels[article.filter_status] || article.filter_status;
  document.getElementById('processStatus').textContent = processLabels[article.process_status] || article.process_status;
  document.getElementById('publishedAt').textContent = formatDateTime(article.published_at);
  document.getElementById('createdAt').textContent = formatDateTime(article.created_at);

  // 已读状态显示
  const readStatusEl = document.getElementById('readStatus');
  if (readStatusEl) {
    const isRead = article.is_read === 1;
    readStatusEl.textContent = isRead ? '已读' : '未读';
    readStatusEl.style.color = isRead ? 'var(--accent-primary)' : 'var(--text-tertiary)';
  }

  // 已读状态
  const isRead = article.is_read === 1;
  updateReadButton(isRead);

  // 处理按钮可见性
  const processBtn = document.getElementById('processBtn');
  processBtn.style.display = (article.process_status === 'pending' || article.process_status === 'failed') ? 'inline-block' : 'none';

  // AI 摘要
  const summarySection = document.getElementById('summarySection');
  if (article.summary) {
    summarySection.style.display = 'block';
    document.getElementById('rssSummary').innerHTML = '<p>' + escapeHtml(article.summary) + '</p>';
  }

  // 中文翻译
  const translationSection = document.getElementById('translationSection');
  if (article.translation && article.translation.summary_zh) {
    translationSection.style.display = 'block';
    document.getElementById('translationContent').innerHTML =
      '<p>' + escapeHtml(article.translation.summary_zh) + '</p>';
  }

  // AI 总结
  const aiSummarySection = document.getElementById('aiSummarySection');
  if (article.ai_summary) {
    aiSummarySection.style.display = 'block';
    document.getElementById('aiSummary').innerHTML = formatMarkdown(article.ai_summary);
  }

  // 过滤匹配
  const filterSection = document.getElementById('filterSection');
  const filterList = document.getElementById('filterList');
  if (Array.isArray(article.filter_matches) && article.filter_matches.length > 0) {
    filterSection.style.display = 'block';
    filterList.innerHTML = article.filter_matches.map((match) => {
      const domain = match.domainName ? escapeHtml(match.domainName) : '未归类';
      const reasonHtml = match.filterReason
        ? '<div class="filter-reason">' +
             '<span class="filter-reason-label">原因：</span>' +
             '<span class="filter-reason-text">' + escapeHtml(match.filterReason) + '</span>' +
           '</div>'
        : '';
      return '<li class="filter-item">' +
        '<div class="filter-domain">【' + domain + '】</div>' +
        reasonHtml +
      '</li>';
    }).join('');
  }

  // 正文：优先使用 markdown_content
  const rssSection = document.getElementById('rssContentSection');
  const mainContent = article.markdown_content || article.content;
  if (mainContent) {
    rssSection.style.display = 'block';
    document.getElementById('rssContent').innerHTML = formatMarkdown(mainContent);
  }

}

// 加载相关文章
async function loadRelatedArticles(id) {
  try {
    const res = await fetch('/api/articles/' + id + '/related');

    if (!res.ok) return;

    const articles = await res.json();

    if (articles.length > 0) {
      document.getElementById('relatedCard').style.display = 'block';
      document.getElementById('relatedList').innerHTML = articles.map(article =>
        '<li class="related-article-item">' +
          '<a href="/articles/' + article.id + '" class="related-article-link">' +
            escapeHtml(article.title) +
          '</a>' +
          '<div class="related-article-meta">' +
            '<span class="related-score">相关度: ' + formatScore(article.score) + '</span>' +
            '<span class="related-separator">·</span>' +
            formatTime(article.published_at) +
          '</div>' +
        '</li>'
      ).join('');
    }
  } catch (err) {
    console.error('Failed to load related articles:', err);
  }
}

// 格式化相关性得分
function formatScore(score) {
  if (typeof score !== 'number') return 'N/A';
  return (score * 100).toFixed(0) + '%';
}

// 导出 Markdown
function exportMarkdown() {
  if (!articleData) return;

  // 构建简单的 Markdown 导出
  const md = '# ' + articleData.title + '\n\n' +
    '**来源:** ' + (articleData.source_name || articleData.rss_source_name || 'Unknown') + '\n' +
    '**URL:** ' + articleData.url + '\n' +
    '**发布时间:** ' + getPublishTimeText(articleData) + '\n\n' +
    '---\n\n' +
    (articleData.summary || '') + '\n\n' +
    '---\n\n' +
    (articleData.markdown_content || articleData.content || '');

  // 下载为文件
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'article-' + articleData.id + '.md';
  a.click();
  URL.revokeObjectURL(url);
}

// 重新处理文章
async function processArticle() {
  if (!articleData) return;

  try {
    const res = await fetch('/api/articles/' + articleData.id + '/process', { method: 'POST' });
    const result = await res.json();

    if (res.ok) {
      await showConfirm('处理任务已加入队列', {
        title: '重新处理',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
    } else {
      await showConfirm(result.error || '操作失败', {
        title: '错误',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
    }
  } catch (err) {
    await showConfirm('操作失败，请稍后重试', {
      title: '错误',
      okText: '知道了',
      okButtonType: 'btn-secondary'
    });
  }
}

// 删除文章
async function deleteArticle() {
  if (!articleData) return;
  const confirmed = await showConfirm('确定要删除这篇文章吗？此操作不可撤销。', {
    title: '删除文章',
    okText: '删除',
    cancelText: '取消'
  });
  if (!confirmed) return;

  try {
    const res = await fetch('/api/articles/' + articleData.id, { method: 'DELETE' });

    if (res.ok) {
      window.location.href = '/articles';
    } else {
      const result = await res.json();
      await showConfirm(result.error || '删除失败', {
        title: '错误',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
    }
  } catch (err) {
    await showConfirm('删除失败，请稍后重试', {
      title: '错误',
      okText: '知道了',
      okButtonType: 'btn-secondary'
    });
  }
}

// 简易 Markdown 格式化（支持表格、列表、标题等）
function formatMarkdown(text) {
  if (!text) return '';

  // 分割成块进行处理
  const blocks = text.split(/\n\n+/);
  const result = [];

  for (let block of blocks) {
    block = block.trim();
    if (!block) continue;

    // 检测表格
    if (block.includes('|') && block.includes('\n')) {
      const tableHtml = formatTable(block);
      if (tableHtml) {
        result.push(tableHtml);
        continue;
      }
    }

    // 检测无序列表
    const lines = block.split('\n');
    if (lines.every(line => line.trim().startsWith('- ') || line.trim().match(/^\*\*.*\*\*$/))) {
      result.push('<ul>' + lines.map(line => {
        const content = line.replace(/^-\s+/, '').trim();
        // 处理列表项中的粗体
        return '<li>' + formatInline(escapeHtml(content)) + '</li>';
      }).join('') + '</ul>');
      continue;
    }

    // 处理标题和段落
    if (block.startsWith('#### ')) {
      result.push('<h4>' + formatInline(escapeHtml(block.slice(5))) + '</h4>');
    } else if (block.startsWith('### ')) {
      result.push('<h3>' + formatInline(escapeHtml(block.slice(4))) + '</h3>');
    } else if (block.startsWith('## ')) {
      result.push('<h2>' + formatInline(escapeHtml(block.slice(3))) + '</h2>');
    } else if (block.startsWith('# ')) {
      result.push('<h1>' + formatInline(escapeHtml(block.slice(2))) + '</h1>');
    } else {
      result.push('<p>' + formatInline(escapeHtml(block)) + '</p>');
    }
  }

  return result.join('');
}

// 格式化表格
function formatTable(block) {
  const lines = block.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;

  // 检查是否是分隔行（Markdown 表格分隔行格式：|---|、|:---|、|---:|、|:---:|）
  const isSeparator = (line) => /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/.test(line);
  if (lines.length < 3 || !isSeparator(lines[1])) return null;

  const rows = lines.map(line =>
    line.split('|').map(cell => cell.trim()).filter(cell => cell)
  );

  if (rows.length < 2) return null;

  let html = '<table><thead><tr>';
  // 表头
  rows[0].forEach(cell => {
    html += '<th>' + formatInline(escapeHtml(cell)) + '</th>';
  });
  html += '</tr></thead><tbody>';

  // 数据行
  for (let i = 2; i < rows.length; i++) {
    html += '<tr>';
    rows[i].forEach(cell => {
      html += '<td>' + formatInline(escapeHtml(cell)) + '</td>';
    });
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

// 格式化行内元素（粗体、斜体、链接、代码）
function formatInline(text) {
  return text
    .replace(/[*][*]([^*]+?)[*][*]/g, '<strong>$1</strong>')
    .replace(/[*]([^*]+?)[*]/g, '<em>$1</em>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+?)\]\(([^\)]+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// 工具函数
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, len) {
  if (!str) return '';
  if (str.length <= len) return str;
  return str.substring(0, len - 3) + '...';
}

function truncateUrl(url) {
  if (!url) return '';
  if (url.length <= 50) return url;

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const path = urlObj.pathname;
    return hostname + path.length > 30 ? hostname + path.substring(0, 30) + '...' : url;
  } catch {
    return url.substring(0, 50) + '...';
  }
}

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  if (window.timeUtils && typeof window.timeUtils.formatDateTime === 'function') {
    return window.timeUtils.formatDateTime(dateStr);
  }
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * 格式化期刊年卷期信息
 */
function formatJournalIssue(article) {
  const parts = [];
  if (article.published_year) {
    parts.push(article.published_year + '年');
  }
  if (article.published_issue) {
    parts.push('第' + article.published_issue + '期');
  }
  if (article.published_volume) {
    parts.push('第' + article.published_volume + '卷');
  }
  return parts.length > 0 ? parts.join(' ') : '';
}

/**
 * 获取文章发布时间显示文本
 * 期刊文章优先显示年卷期，RSS 文章显示 published_at
 */
function getPublishTimeText(article) {
  if (article.source_origin === 'journal') {
    const issueText = formatJournalIssue(article);
    return issueText || formatDateTime(article.published_at);
  }
  return formatDateTime(article.published_at);
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  if (window.timeUtils && typeof window.timeUtils.formatRelativeTime === 'function') {
    return window.timeUtils.formatRelativeTime(dateStr);
  }
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';

  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric'
  });
}

// 更新已读按钮状态
function updateReadButton(isRead) {
  const readBtn = document.getElementById('readBtn');
  if (readBtn) {
    readBtn.textContent = isRead ? '标记未读' : '标记已读';
    readBtn.onclick = function() { toggleReadStatus(!isRead); };
  }
}

// 切换已读状态
async function toggleReadStatus(isRead) {
  if (!articleData) return;

  try {
    const res = await fetch('/api/articles/' + articleData.id + '/read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_read: isRead })
    });

    if (!res.ok) throw new Error('Failed to update');

    articleData.is_read = isRead ? 1 : 0;
    updateReadButton(isRead);

    // 更新已读状态显示
    const readStatusEl = document.getElementById('readStatus');
    if (readStatusEl) {
      readStatusEl.textContent = isRead ? '已读' : '未读';
      readStatusEl.style.color = isRead ? 'var(--accent-primary)' : 'var(--text-tertiary)';
    }
  } catch (err) {
    console.error('Failed to toggle read status:', err);
    window.toast.error('操作失败，请稍后重试');
  }
}
