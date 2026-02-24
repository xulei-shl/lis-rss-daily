/**
 * Home Page Logic
 */

let currentPage = 1;
let totalPages = 1;
const perPage = 20;

// Load on page ready
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const page = parseInt(params.get('page')) || 1;
  loadStats();
  loadArticles(page);
});

// Load statistics
async function loadStats() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch('/api/articles/stats', {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.error('Failed to load stats:', res.status, res.statusText);
      return;
    }

    const stats = await res.json();

    document.getElementById('todayNew').textContent = stats.todayNew || 0;
    document.getElementById('pendingCount').textContent = stats.pending || 0;
    document.getElementById('analyzedCount').textContent = stats.analyzed || 1;
    document.getElementById('passRate').textContent = stats.passRate
      ? (stats.passRate * 100).toFixed(0) + '%'
      : '-';
    document.getElementById('unreadCount').textContent = stats.unread || 1;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('Failed to load stats:', err);
  }
}

// Load articles
async function loadArticles(page = 1) {
  const container = document.getElementById('articlesContainer');
  container.innerHTML = '<div class="loading">加载中...</div>';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const fallbackTimeoutId = setTimeout(() => {
    if (container.querySelector('.loading')) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-title">加载超时</div><div class="empty-state-desc">服务器响应时间过长，请检查网络连接或稍后重试</div></div>';
    }
  }, 10500);

  try {
    const res = await fetch('/api/articles?page=' + page + '&limit=' + perPage + '&filterStatus=passed&daysAgo=7&isRead=false', {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    clearTimeout(fallbackTimeoutId);

    if (!res.ok) throw new Error('Failed to fetch');

    const data = await res.json();
    currentPage = page;
    totalPages = data.totalPages || 1;

    renderArticles(data.articles || []);
    renderPagination();
  } catch (err) {
    clearTimeout(timeoutId);
    clearTimeout(fallbackTimeoutId);
    console.error('Failed to load articles:', err);

    const isTimeout = err.name === 'AbortError';
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">' + (isTimeout ? '加载超时' : '加载失败') + '</div><div class="empty-state-desc">' + (isTimeout ? '服务器响应时间过长，请稍后重试' : '请检查网络连接后刷新页面') + '</div></div>';
  }
}

// Render articles grouped by date
function renderArticles(articles) {
  const container = document.getElementById('articlesContainer');

  if (articles.length === 0) {
    container.innerHTML = '<div class="empty-state"><svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg><div class="empty-state-title">暂无文章</div><div class="empty-state-desc">添加RSS订阅源后，文章将显示在这里</div></div>';
    return;
  }

  let html = '';
  let currentDate = '';
  let cardIndex = 0;

  articles.forEach((article) => {
    const dateLabel = formatDate(article.published_at);

    if (dateLabel !== currentDate) {
      currentDate = dateLabel;
      html += '<div class="day-header">' + dateLabel + '<span class="day-date">' + getWeekday(article.published_at) + '</span></div>';
    }

    html += renderArticleCard(article, cardIndex);
    cardIndex++;
  });

  container.innerHTML = html;
}

// Render single article card
function renderArticleCard(article, index) {
  const statusLabel = {
    'passed': '通过',
    'rejected': '拒绝',
    'pending': '待处理'
  };

  const content = article.summary_zh || article.content || article.markdown_content || '';
  const hasContent = content.length > 0;
  const TRUNCATE_LENGTH = 400;
  const needsTruncate = content.length > TRUNCATE_LENGTH;

  const isRead = article.is_read === 1;
  const isRejected = article.filter_status === 'rejected';
  const cardClass = isRead ? 'article-card fade-in-up is-read' : isRejected ? 'article-card fade-in-up is-rejected' : 'article-card fade-in-up';
  const readIcon = isRead ? '<span class="article-read-icon">✅</span>' : '';

  let html = '<div class="' + cardClass + '" style="animation-delay: ' + (index * 30) + 'ms" data-article-id="' + article.id + '">';
  html += '<div class="article-card-header"><h3 class="article-title">' + readIcon + '<a href="/articles/' + article.id + '">' + escapeHtml(article.title) + '</a></h3>';
  html += '<span class="badge ' + article.filter_status + '">' + (statusLabel[article.filter_status] || '未知') + '</span></div>';
  html += '<div class="article-meta"><span>' + escapeHtml(article.source_name || article.rss_source_name || 'Unknown') + '</span><span>·</span>';
  html += '<span>' + getPublishTimeText(article) + '</span><span>·</span>';
  html += '<a href="' + escapeHtml(article.url) + '" target="_blank" rel="noopener">原文链接</a></div>';
  
  if (hasContent) {
    html += '<div class="article-summary">';
    if (needsTruncate) {
      html += '<span class="summary-short">' + truncate(content, TRUNCATE_LENGTH) + '</span>';
      html += '<span class="summary-full" style="display: none;">' + escapeHtml(content) + '</span>';
      html += '<button class="summary-toggle" onclick="toggleSummary(this)">展开</button>';
    } else {
      html += escapeHtml(content);
    }
    html += '</div>';
  }
  
  html += '<div class="article-footer"><div class="article-tags">';
  if (article.tags) {
    article.tags.split(',').forEach(function(tag) {
      html += '<span class="article-tag">#' + escapeHtml(tag.trim()) + '</span>';
    });
  }
  html += '</div><div class="article-actions">';
  if (window.userRole !== 'guest') {
    html += '<button class="btn-icon" onclick="toggleReadStatus(' + article.id + ', false)">已读</button>';
  }
  html += '</div></div></div>';
  
  return html;
}

// Render pagination
function renderPagination() {
  const pagination = document.getElementById('pagination');

  if (totalPages <= 1) {
    pagination.style.display = 'none';
    return;
  }

  pagination.style.display = 'flex';

  let html = '';

  // Previous
  html += currentPage > 1
    ? '<a href="?page=' + (currentPage - 1) + '">← 上一页</a>'
    : '<span>← 上一页</span>';

  // Page numbers
  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);

  if (startPage > 1) {
    html += '<a href="?page=1">1</a>';
    if (startPage > 2) html += '<span>...</span>';
  }

  
  for (let i = startPage; i <= endPage; i++) {
    if (i === currentPage) {
      html += '<span class="current">' + i + '</span>';
    } else {
      html += '<a href="?page=' + i + '">' + i + '</a>';
    }
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += '<span>...</span>';
    html += '<a href="?page=' + totalPages + '">' + totalPages + '</a>';
  }
  
  // Next
  html += currentPage < totalPages
    ? '<a href="?page=' + (currentPage + 1) + '">下一页 →</a>'
    : '<span>下一页 →</span>';

  pagination.innerHTML = html;
}

// Toggle summary expansion
function toggleSummary(btn) {
  const container = btn.parentElement;
  const shortText = container.querySelector('.summary-short');
  const fullText = container.querySelector('.summary-full');

  if (fullText.style.display === 'none') {
    shortText.style.display = 'none';
    fullText.style.display = 'inline';
    btn.textContent = '收起';
  } else {
    fullText.style.display = 'none';
    shortText.style.display = 'inline';
    btn.textContent = '展开';
  }
}

// Utility functions
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

function formatDate(dateStr) {
  if (!dateStr) return '未知日期';
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const articleDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  
  const diffDays = Math.floor((today - articleDate) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays === 2) return '前天';
  if (diffDays < 7) return diffDays + ' 天前';
  
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function getWeekday(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return weekdays[date.getDay()];
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
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

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

function getPublishTimeText(article) {
  if (article.source_origin === 'journal') {
    const issueText = formatJournalIssue(article);
    return issueText || formatTime(article.published_at);
  }
  return formatTime(article.published_at);
}

// Handle browser back/forward
window.addEventListener('popstate', () => {
  const params = new URLSearchParams(window.location.search);
  const page = parseInt(params.get('page')) || 1;
  loadArticles(page);
});

// Toggle article read status
async function toggleReadStatus(articleId, currentIsRead) {
  const card = document.querySelector('[data-article-id="' + articleId + '"]');
  if (!card) return;

  try {
    const res = await fetch('/api/articles/' + articleId + '/read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_read: !currentIsRead })
    });

    
    if (!res.ok) throw new Error('Failed to update');
    
    // 标记为已读时，淡出并移除卡片
    if (!currentIsRead) {
      fadeOutAndRemoveCard(card);
    }
    
    // 更新统计数据
    loadStats();
  } catch (err) {
    console.error('Failed to toggle read status:', err);
    alert('操作失败，请稍后重试');
  }
}

// 淡出并移除卡片
function fadeOutAndRemoveCard(card) {
  // 添加淡出动画
  card.style.transition = 'opacity 0.3s ease, transform 0.3s ease, max-height 0.3s ease, margin 0.3s ease';
  card.style.opacity = '0';
  card.style.transform = 'translateX(20px)';
  card.style.maxHeight = '0';
  card.style.margin = '0';
  card.style.overflow = 'hidden';
  
  // 动画结束后移除DOM
  setTimeout(() => {
    card.remove();
    // 检查是否需要移除日期分组标题
    checkAndRemoveEmptyDayHeaders();
  }, 300);
}

// 检查并移除没有文章的日期分组标题
function checkAndRemoveEmptyDayHeaders() {
  const dayHeaders = document.querySelectorAll('.day-header');
  dayHeaders.forEach(function(header) {
    const nextElement = header.nextElementSibling;
    // 如果下一个元素不是文章卡片或者是另一个日期标题,则移除当前日期标题
    if (!nextElement || !nextElement.classList.contains('article-card')) {
      header.remove();
    }
  });
}
