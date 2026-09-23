// ============================================
// HISTORY PAGE LOGIC
// ============================================

(function() {
  'use strict';

  let allHistory = [];
  let filteredHistory = [];
  let isFullDataLoaded = false;  // 是否已加载全部数据
  let lastActiveCard = null;     // 记录唤起弹窗的卡片元素，用于关闭后焦点还原
  const DEFAULT_DAYS = 30;  // 默认显示最近30天

  // DOM Elements
  const historyContainer = document.getElementById('historyContainer');
  const resultsCount = document.getElementById('resultsCount');
  const searchInput = document.getElementById('searchInput');
  const typeFilter = document.getElementById('typeFilter');
  const yearFilter = document.getElementById('yearFilter');
  const monthFilter = document.getElementById('monthFilter');
  const summaryModal = document.getElementById('summaryModal');
  const closeSummaryModal = document.getElementById('closeSummaryModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');

  // Type labels
  const typeLabels = {
    journal: '期刊精选',
    blog_news: '博客资讯',
    all: '综合',
    journal_all: '全部期刊',
    search: '搜索总结',
    insights: '洞察报告'
  };

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    loadHistory();
    setupEventListeners();
  });

  // Setup event listeners
  function setupEventListeners() {
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        loadFullDataAndFilter();
      }, 250);
    });

    typeFilter.addEventListener('change', () => {
      loadFullDataAndFilter();
    });

    yearFilter.addEventListener('change', () => {
      updateMonthFilter();
      if (!isFullDataLoaded) {
        loadFullDataAndFilter();
      } else {
        filterAndRender();
      }
    });

    monthFilter.addEventListener('change', () => {
      loadFullDataAndFilter();
    });

    closeSummaryModal.addEventListener('click', closeModal);
    summaryModal.addEventListener('click', (e) => {
      if (e.target === summaryModal) closeModal();
    });

    // Close modal on Escape key & Support Enter/Space on cards
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal();
      } else if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.classList?.contains('history-item-card')) {
        e.preventDefault();
        document.activeElement.click();
      }
    });
  }

  // Load history (default: recent 30 days)
  async function loadHistory(loadAll = false) {
    historyContainer.innerHTML = '<div class="loading">加载中...</div>';

    try {
      // Calculate date range for default view
      const limit = loadAll ? 10000 : 200;  // Enough for 30 days of records

      const res = await fetch(`/api/daily-summary/history?limit=${limit}`);
      if (!res.ok) throw new Error('Failed to load history');

      const data = await res.json();
      allHistory = data.history || [];
      isFullDataLoaded = loadAll;

      populateYearFilter();
      filterAndRender();

      // 如果首次只加载了部分，在空闲时静默预取完整历史，避免后续交互卡顿或打断选择
      if (!loadAll) {
        scheduleSilentPreload();
      }
    } catch (err) {
      console.error('Failed to load history:', err);
      historyContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">加载失败</div>
          <div class="empty-state-desc">请稍后重试</div>
        </div>
      `;
    }
  }

  // 静默后台预加载完整数据
  function scheduleSilentPreload() {
    const preload = async () => {
      if (isFullDataLoaded) return;
      try {
        const res = await fetch('/api/daily-summary/history?limit=10000');
        if (!res.ok) return;
        const data = await res.json();
        allHistory = data.history || [];
        isFullDataLoaded = true;
        populateYearFilter();
      } catch (e) {
        // 静默失败不打扰用户
      }
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(preload);
    } else {
      setTimeout(preload, 1000);
    }
  }

  // Load full data and apply filters
  async function loadFullDataAndFilter() {
    if (isFullDataLoaded) {
      filterAndRender();
      return;
    }

    try {
      const res = await fetch('/api/daily-summary/history?limit=10000');
      if (!res.ok) throw new Error('Failed to load history');

      const data = await res.json();
      allHistory = data.history || [];
      isFullDataLoaded = true;

      populateYearFilter();
      filterAndRender();
    } catch (err) {
      console.error('Failed to load full history:', err);
    }
  }

  // Populate year filter based on available data (无损更新，绝不破坏用户正处于 focus 的菜单)
  function populateYearFilter() {
    const years = new Set();
    allHistory.forEach(item => {
      const year = new Date(item.created_at).getFullYear();
      if (!isNaN(year)) years.add(year);
    });

    const sortedYears = Array.from(years).sort((a, b) => b - a);
    const currentVal = yearFilter.value;

    // 检查是否已有完全匹配的选项
    const existingValues = Array.from(yearFilter.options).map(o => o.value).filter(Boolean);
    const isSame = existingValues.length === sortedYears.length && sortedYears.every((y, idx) => String(y) === existingValues[idx]);
    if (isSame) return;

    // 如果用户当前焦点在 yearFilter 上，延迟到 blur 后再无损更新，避免击溃展开中的原生菜单
    if (document.activeElement === yearFilter) {
      yearFilter.addEventListener('blur', () => populateYearFilter(), { once: true });
      return;
    }

    yearFilter.innerHTML = '<option value="">全部年份</option>' +
      sortedYears.map(year => `<option value="${year}">${year}年</option>`).join('');

    if (currentVal && sortedYears.includes(parseInt(currentVal))) {
      yearFilter.value = currentVal;
    }
  }

  // Update month filter options based on year
  function updateMonthFilter() {
    const currentMonth = monthFilter.value;
    monthFilter.innerHTML = '<option value="">全部月份</option>' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m =>
        `<option value="${m}">${m}月</option>`
      ).join('');
    if (currentMonth) {
      monthFilter.value = currentMonth;
    }
  }

  // 一键重置所有筛选条件
  function resetFilters() {
    searchInput.value = '';
    typeFilter.value = '';
    yearFilter.value = '';
    monthFilter.value = '';
    filterAndRender();
  }

  // Filter and render
  function filterAndRender() {
    const searchQuery = searchInput.value.trim();
    const selectedType = typeFilter.value;
    const selectedYear = yearFilter.value;
    const selectedMonth = monthFilter.value;

    // Calculate 30 days ago date
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - DEFAULT_DAYS);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    // Check if any filter is active (search, type, year, month)
    const hasActiveFilter = searchQuery || selectedType || selectedYear || selectedMonth;

    filteredHistory = allHistory.filter(item => {
      // Type filter
      if (selectedType && item.summary_type !== selectedType) return false;

      // Date filter
      const date = new Date(item.created_at);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;

      if (selectedYear && year !== parseInt(selectedYear)) return false;
      if (selectedMonth && month !== parseInt(selectedMonth)) return false;

      // Search filter (YYYY-MM-DD format)
      if (searchQuery) {
        const dateStr = item.summary_date;
        if (!dateStr.includes(searchQuery)) return false;
      }

      // Default: only show last 30 days if no filters are active
      if (!hasActiveFilter) {
        if (date < thirtyDaysAgo) return false;
      }

      return true;
    });

    renderHistory();
    renderResultsCount();
  }

  // Render history grouped by month
  function renderHistory() {
    if (filteredHistory.length === 0) {
      const hasFilter = searchInput.value.trim() || typeFilter.value || yearFilter.value || monthFilter.value;
      historyContainer.innerHTML = `
        <div class="empty-state history-fade-in">
          <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div class="empty-state-title">${hasFilter ? '未找到匹配的记录' : '暂无最近30天的历史记录'}</div>
          <div class="empty-state-desc">${hasFilter ? '尝试调整筛选条件或搜索关键词' : '生成总结后将在此显示'}</div>
          ${hasFilter ? `
            <button class="empty-state-reset-btn" onclick="window.historyPage.resetFilters()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
              <span>清空筛选条件</span>
            </button>
          ` : ''}
        </div>
      `;
      return;
    }

    // Group by month
    const grouped = groupByMonth(filteredHistory);

    historyContainer.innerHTML = Object.entries(grouped).map(([monthKey, items]) => `
      <div class="history-group history-fade-in">
        <div class="history-group-header">
          <h2 class="history-group-title">${monthKey}</h2>
          <span class="history-group-count">${items.length} 篇总结</span>
        </div>
        <div class="history-group-items">
          ${items.map(item => renderHistoryItem(item)).join('')}
        </div>
      </div>
    `).join('');
  }

  // Group history by month
  function groupByMonth(items) {
    const grouped = {};
    items.forEach(item => {
      const date = new Date(item.created_at);
      const key = `${date.getFullYear()}年${date.getMonth() + 1}月`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    });
    return grouped;
  }

  // Render single history item
  function renderHistoryItem(item) {
    const typeLabel = typeLabels[item.summary_type] || '综合';
    return `
      <div class="history-item-card" role="button" tabindex="0" aria-label="查看 ${item.summary_date} 的 ${typeLabel} 总结" onclick="window.historyPage.viewSummary('${item.summary_date}', '${item.summary_type}', this)">
        <div class="history-item-header">
          <span class="history-item-date">${item.summary_date}</span>
          <span class="history-item-type badge-${item.summary_type}">${typeLabel}</span>
        </div>
        <div class="history-item-meta">
          <span class="history-item-count">${item.article_count} 篇文献</span>
          <span class="history-item-time">${formatDate(item.created_at)}</span>
        </div>
      </div>
    `;
  }

  // Render results count
  function renderResultsCount() {
    const total = filteredHistory.length;
    const hasFilter = searchInput.value.trim() || typeFilter.value || yearFilter.value || monthFilter.value;

    if (hasFilter) {
      resultsCount.textContent = total > 0
        ? `找到 ${total} 条记录`
        : '未找到匹配记录';
    } else {
      resultsCount.textContent = total > 0
        ? `最近 ${DEFAULT_DAYS} 天：共 ${total} 条记录`
        : '最近30天暂无记录';
    }
  }

  // View summary detail
  async function viewSummary(date, summaryType, triggerEl) {
    lastActiveCard = triggerEl || document.activeElement;
    const typeLabel = typeLabels[summaryType] || '综合';
    modalTitle.textContent = `每日总结 - ${date} (${typeLabel})`;
    
    // 使用呼吸感骨架屏占位，消除高度突跳
    modalBody.innerHTML = `
      <div class="history-skeleton">
        <div class="skeleton-pulse skeleton-line title"></div>
        <div class="skeleton-pulse skeleton-line" style="margin-top: 14px;"></div>
        <div class="skeleton-pulse skeleton-line medium"></div>
        <div class="skeleton-pulse skeleton-line"></div>
        <div class="skeleton-pulse skeleton-line short"></div>
        <div class="skeleton-pulse skeleton-line" style="margin-top: 24px;"></div>
        <div class="skeleton-pulse skeleton-line medium"></div>
      </div>
    `;
    summaryModal.classList.add('active');

    // 焦点转移至关闭按钮，便于键盘 Esc / Space 触发
    if (closeSummaryModal) {
      setTimeout(() => closeSummaryModal.focus(), 50);
    }

    try {
      // Load summary and articles in parallel
      const [summaryRes, articlesRes] = await Promise.all([
        fetch(`/api/daily-summary/${date}?type=${summaryType}`),
        fetch(`/api/daily-summary/${date}/articles?type=${summaryType}`)
      ]);

      if (!summaryRes.ok) throw new Error('Failed to load summary');

      const summaryData = await summaryRes.json();
      const articlesData = articlesRes.ok ? await articlesRes.json() : null;

      renderSummaryDetail(summaryData, articlesData);
    } catch (err) {
      console.error('Failed to load summary:', err);
      modalBody.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">加载失败</div>
          <div class="empty-state-desc">请稍后重试</div>
        </div>
    }
  }

  // Render summary detail in modal
  function renderSummaryDetail(summaryData, articlesData) {
    // Build full content for copy/download
    const summary = summaryData.summary_content;
    const summaryType = summaryData.summary_type;
    const articlesText = articlesData ? buildArticlesListText(articlesData, summaryType) : '';
    const fullContent = articlesText ? (summary + '\n\n' + articlesText) : summary;

    const typeLabel = typeLabels[summaryType] || '综合';

    modalBody.innerHTML = `
      <div class="summary-detail">
        <div class="summary-detail-meta">
          <div class="summary-meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>${summaryData.summary_date}</span>
          </div>
          <div class="summary-meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            </svg>
            <span>${summaryData.article_count} 篇文章</span>
          </div>
          <div class="summary-meta-item summary-type-badge">
            <span class="badge-${summaryType}">${typeLabel}</span>
          </div>
          <div class="summary-meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>生成于 ${new Date(summaryData.created_at + 'Z').toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span>
          </div>
          <button class="summary-meta-action" onclick="window.historyPage.copySummary(this)" title="复制内容">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>复制</span>
          </button>
          <button class="summary-meta-action" onclick="window.historyPage.downloadSummary()" title="下载内容">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>下载</span>
          </button>
        </div>
        <div class="summary-detail-content" data-full-content="${escapeHtml(fullContent)}">
          ${renderMarkdown(summary)}
          ${articlesData ? buildArticlesListHtml(articlesData, summaryType) : ''}
        </div>
      </div>
    `;
  }

  // Simple Markdown renderer
  function renderMarkdown(text) {
    if (!text) return '';

    let html = escapeHtml(text);

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Lists
    html = html.replace(/^- (.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Paragraphs
    html = html.split('\n\n').map(p => {
      if (p.startsWith('<h') || p.startsWith('<ul')) return p;
      if (!p.trim()) return '';
      return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
    }).join('');

    return html;
  }

  // Utility function to escape HTML
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Format date helper
  function formatDate(dateStr) {
    if (!dateStr) return '';
    if (window.timeUtils && typeof window.timeUtils.formatRelativeTime === 'function') {
      return window.timeUtils.formatRelativeTime(dateStr);
    }
    const date = new Date(dateStr + 'Z');
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;

    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai'
    });
  }

  // Close modal
  function closeModal() {
    summaryModal.classList.remove('active');
    // 焦点还原至原本激活的卡片
    if (lastActiveCard && typeof lastActiveCard.focus === 'function') {
      try {
        lastActiveCard.focus();
      } catch (e) {
        // 忽略聚焦异常
      }
    }
  }

  // Build articles list HTML
  function buildArticlesListHtml(articlesData, summaryType) {
    // Filter sections based on summary type
    const showSections = summaryType === 'journal'
      ? ['journal']
      : summaryType === 'blog_news'
      ? ['blog', 'news', 'email']
      : ['journal', 'blog', 'news', 'email']; // 'all' and 'search' show all types

    const articleTypeLabels = {
      journal: '期刊精选',
      blog: '博客推荐',
      news: '资讯动态',
      email: '邮件订阅'
    };

    let html = '<div class="summary-articles-section">';

    for (const type of showSections) {
      const articleList = articlesData[type] || [];
      if (articleList.length === 0) continue;

      const label = articleTypeLabels[type];
      html += `
        <div class="articles-subsection">
          <h4 class="articles-subsection-title">${label}</h4>
          <ul class="articles-list">
            ${articleList.map(article => `
              <li class="articles-list-item">
                <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener" class="article-link" title="${escapeHtml(article.title)}">
                  ${escapeHtml(article.title)}
                </a>
                <span class="article-source">${escapeHtml(article.source_name)}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  // Build articles list text for copy/download
  function buildArticlesListText(articlesData, summaryType) {
    // Filter sections based on summary type
    const showSections = summaryType === 'journal'
      ? ['journal']
      : summaryType === 'blog_news'
      ? ['blog', 'news', 'email']
      : ['journal', 'blog', 'news', 'email']; // 'all' and 'search' show all types

    const articleTypeLabels = {
      journal: '期刊精选',
      blog: '博客推荐',
      news: '资讯动态',
      email: '邮件订阅'
    };

    let text = '## 文章列表\n\n';

    for (const type of showSections) {
      const articleList = articlesData[type] || [];
      if (articleList.length === 0) continue;

      const label = articleTypeLabels[type];
      text += `### ${label}\n`;
      articleList.forEach((article, index) => {
        text += `${index + 1}. [${article.title}](${article.url}) - ${article.source_name}\n`;
      });
      text += '\n';
    }

    return text;
  }

  // Copy summary
  async function copySummary(btnEl) {
    const contentEl = document.querySelector('.summary-detail-content');
    const textToCopy = contentEl?.dataset.fullContent || contentEl?.innerText || '';
    const actionBtn = btnEl || document.querySelector('.summary-meta-action');

    if (!textToCopy) return;

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        fallbackCopyText(textToCopy);
      }
      
      // 按钮即时微动效与对勾反馈
      if (actionBtn) {
        actionBtn.classList.add('copied');
        const originalHTML = actionBtn.innerHTML;
        actionBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>已复制</span>
        `;
        setTimeout(() => {
          actionBtn.classList.remove('copied');
          actionBtn.innerHTML = originalHTML;
        }, 2000);
      }

      showToastMessage('已复制到剪贴板', 'success');
    } catch (err) {
      console.error('Failed to copy:', err);
      showToastMessage('复制失败，请重试', 'error');
    }
  }

  // 兼容不支持 Clipboard API 的环境
  function fallbackCopyText(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  function showToastMessage(message, type) {
    if (window.toast && typeof window.toast[type] === 'function') {
      window.toast[type](message);
    }
  }

  // Download summary
  function downloadSummary() {
    const contentEl = document.querySelector('.summary-detail-content');
    const textToDownload = contentEl?.dataset.fullContent || contentEl?.innerText || '';
    const dateEl = document.querySelector('.summary-detail-meta span');
    const date = dateEl?.textContent || 'summary';
    const filename = `daily-summary-${date}.md`;

    if (!textToDownload) return;

    // Create blob and download
    const blob = new Blob([textToDownload], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Export functions for onclick handlers
  window.historyPage = {
    viewSummary,
    copySummary,
    downloadSummary,
    resetFilters
  };

})();
