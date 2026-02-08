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
      '<span>' + escapeHtml(article.rss_source_name || 'Unknown') + '</span>' +
    '</div>' +
    '<div class="article-meta-item">' +
      '<span>·</span>' +
    '</div>' +
    '<div class="article-meta-item">' +
      '<span>' + formatDateTime(article.published_at) + '</span>' +
    '</div>' +
    '<div class="article-meta-item">' +
      '<span>·</span>' +
    '</div>' +
    '<div class="article-meta-item">' +
      '<a href="' + escapeHtml(article.url) + '" target="_blank" rel="noopener">' +
        '原文链接' +
      '</a>' +
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
  if (article.translation && (article.translation.title_zh || article.translation.summary_zh)) {
    translationSection.style.display = 'block';
    const parts = [];
    if (article.translation.title_zh) {
      parts.push('<p><strong>标题译文:</strong> ' + escapeHtml(article.translation.title_zh) + '</p>');
    }
    if (article.translation.summary_zh) {
      parts.push('<p><strong>摘要译文:</strong> ' + escapeHtml(article.translation.summary_zh) + '</p>');
    }
    document.getElementById('translationContent').innerHTML = parts.join('');
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
    '**来源:** ' + (articleData.rss_source_name || 'Unknown') + '\n' +
    '**URL:** ' + articleData.url + '\n' +
    '**发布时间:** ' + formatDateTime(articleData.published_at) + '\n\n' +
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

// 简易 Markdown 格式化（基础实现）
function formatMarkdown(text) {
  if (!text) return '';

  // 先转义反斜杠，避免处理异常
  let result = text
    // 标题
    .replace(new RegExp('^### (.+)$', 'gm'), '<h3>$1</h3>')
    .replace(new RegExp('^## (.+)$', 'gm'), '<h2>$1</h2>')
    .replace(new RegExp('^# (.+)$', 'gm'), '<h1>$1</h1>')
    // 粗体（使用字符类避免转义问题）
    .replace(/[*][*]([^*]+?)[*][*]/g, '<strong>$1</strong>')
    // 斜体
    .replace(/[*]([^*]+?)[*]/g, '<em>$1</em>')
    // 行内代码
    .replace(/`([^`]+?)`/g, '<code>$1</code>')
    // 链接
    .replace(/\[([^\]]+?)\]\(([^\)]+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // 按双换行分段并包裹为段落
  return result.split(new RegExp('\\n\\n', 'g')).map(para => {
    para = para.trim();
    if (!para) return '';
    // 如果已是 HTML 标签则跳过包裹
    if (para.startsWith('<')) return para;
    return '<p>' + para + '</p>';
  }).join('');
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
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatTime(dateStr) {
  if (!dateStr) return '';
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
