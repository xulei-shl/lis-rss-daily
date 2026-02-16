// ============================================
// HISTORY PAGE LOGIC
// ============================================

(function() {
  'use strict';

  let allHistory = [];
  let filteredHistory = [];
  let currentPage = 1;
  const perPage = 20;

  // DOM Elements
  const historyContainer = document.getElementById('historyContainer');
  const pagination = document.getElementById('pagination');
  const resultsCount = document.getElementById('resultsCount');
  const searchInput = document.getElementById('searchInput');
  const yearFilter = document.getElementById('yearFilter');
  const monthFilter = document.getElementById('monthFilter');
  const summaryModal = document.getElementById('summaryModal');
  const closeSummaryModal = document.getElementById('closeSummaryModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');

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
        currentPage = 1;
        filterAndRender();
      }, 300);
    });

    yearFilter.addEventListener('change', () => {
      currentPage = 1;
      updateMonthFilter();
      filterAndRender();
    });

    monthFilter.addEventListener('change', () => {
      currentPage = 1;
      filterAndRender();
    });

    closeSummaryModal.addEventListener('click', closeModal);
    summaryModal.addEventListener('click', (e) => {
      if (e.target === summaryModal) closeModal();
    });

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  // Load all history
  async function loadHistory() {
    historyContainer.innerHTML = '<div class="loading">加载中...</div>';

    try {
      // Fetch all history with a large limit
      const res = await fetch('/api/daily-summary/history?limit=1000');
      if (!res.ok) throw new Error('Failed to load history');

      const data = await res.json();
      allHistory = data.history || [];

      // Populate year filter
      populateYearFilter();

      filterAndRender();
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

  // Populate year filter based on available data
  function populateYearFilter() {
    const years = new Set();
    allHistory.forEach(item => {
      const year = new Date(item.summary_date).getFullYear();
      years.add(year);
    });

    const sortedYears = Array.from(years).sort((a, b) => b - a);
    yearFilter.innerHTML = '<option value="">全部年份</option>' +
      sortedYears.map(year => `<option value="${year}">${year}年</option>`).join('');
  }

  // Update month filter options based on year
  function updateMonthFilter() {
    const selectedYear = yearFilter.value;
    monthFilter.innerHTML = '<option value="">全部月份</option>' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m =>
        `<option value="${m}">${m}月</option>`
      ).join('');
  }

  // Filter and render
  function filterAndRender() {
    const searchQuery = searchInput.value.trim();
    const selectedYear = yearFilter.value;
    const selectedMonth = monthFilter.value;

    filteredHistory = allHistory.filter(item => {
      // Date filter
      const date = new Date(item.summary_date);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;

      if (selectedYear && year !== parseInt(selectedYear)) return false;
      if (selectedMonth && month !== parseInt(selectedMonth)) return false;

      // Search filter (YYYY-MM-DD format)
      if (searchQuery) {
        const dateStr = item.summary_date;
        if (!dateStr.includes(searchQuery)) return false;
      }

      return true;
    });

    renderHistory();
    renderPagination();
    renderResultsCount();
  }

  // Render history grouped by month
  function renderHistory() {
    if (filteredHistory.length === 0) {
      historyContainer.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div class="empty-state-title">未找到历史记录</div>
          <div class="empty-state-desc">尝试调整筛选条件或搜索关键词</div>
        </div>
      `;
      return;
    }

    // Group by month
    const grouped = groupByMonth(filteredHistory);

    // Pagination
    const totalPages = Math.ceil(filteredHistory.length / perPage);
    const startIdx = (currentPage - 1) * perPage;
    const endIdx = startIdx + perPage;
    const pageItems = filteredHistory.slice(startIdx, endIdx);
    const pageGrouped = groupByMonth(pageItems);

    historyContainer.innerHTML = Object.entries(pageGrouped).map(([monthKey, items]) => `
      <div class="history-group">
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
      const date = new Date(item.summary_date);
      const key = `${date.getFullYear()}年${date.getMonth() + 1}月`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    });
    return grouped;
  }

  // Render single history item
  function renderHistoryItem(item) {
    return `
      <div class="history-item-card" onclick="window.historyPage.viewSummary('${item.summary_date}')">
        <div class="history-item-date">${item.summary_date}</div>
        <div class="history-item-meta">
          <span class="history-item-count">${item.article_count} 篇章</span>
          <span class="history-item-time">${formatDate(item.created_at)}</span>
        </div>
      </div>
    `;
  }

  // Render pagination
  function renderPagination() {
    const totalPages = Math.ceil(filteredHistory.length / perPage);

    if (totalPages <= 1) {
      pagination.style.display = 'none';
      return;
    }

    pagination.style.display = 'flex';

    let html = '';

    // Previous
    html += currentPage > 1
      ? `<a href="#" onclick="window.historyPage.goToPage(${currentPage - 1}); return false;">← 上一页</a>`
      : '<span>← 上一页</span>';

    // Page numbers
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);

    if (startPage > 1) {
      html += '<a href="#" onclick="window.historyPage.goToPage(1); return false;">1</a>';
      if (startPage > 2) html += '<span>...</span>';
    }

    for (let i = startPage; i <= endPage; i++) {
      if (i === currentPage) {
        html += `<span class="current">${i}</span>`;
      } else {
        html += `<a href="#" onclick="window.historyPage.goToPage(${i}); return false;">${i}</a>`;
      }
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) html += '<span>...</span>';
      html += `<a href="#" onclick="window.historyPage.goToPage(${totalPages}); return false;">${totalPages}</a>`;
    }

    // Next
    html += currentPage < totalPages
      ? `<a href="#" onclick="window.historyPage.goToPage(${currentPage + 1}); return false;">下一页 →</a>`
      : '<span>下一页 →</span>';

    pagination.innerHTML = html;
  }

  // Render results count
  function renderResultsCount() {
    const total = filteredHistory.length;
    const start = total === 0 ? 0 : (currentPage - 1) * perPage + 1;
    const end = Math.min(currentPage * perPage, total);
    resultsCount.textContent = total > 0
      ? `显示 ${start}-${end} / 共 ${total} 条记录`
      : '暂无记录';
  }

  // View summary detail
  async function viewSummary(date) {
    modalTitle.textContent = `每日总结 - ${date}`;
    modalBody.innerHTML = '<div class="loading">加载中...</div>';
    summaryModal.classList.add('active');

    try {
      // Load summary and articles in parallel
      const [summaryRes, articlesRes] = await Promise.all([
        fetch(`/api/daily-summary/${date}`),
        fetch(`/api/daily-summary/${date}/articles`)
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
      `;
    }
  }

  // Render summary detail in modal
  function renderSummaryDetail(summaryData, articlesData) {
    // Build full content for copy/download
    const summary = summaryData.summary_content;
    const articlesText = articlesData ? buildArticlesListText(articlesData) : '';
    const fullContent = articlesText ? (summary + '\n\n' + articlesText) : summary;

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
          <div class="summary-meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>生成于 ${new Date(summaryData.created_at).toLocaleString('zh-CN')}</span>
          </div>
          <button class="summary-meta-action" onclick="window.historyPage.copySummary()" title="复制内容">
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
          ${articlesData ? buildArticlesListHtml(articlesData) : ''}
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
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;

    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Go to page
  function goToPage(page) {
    currentPage = page;
    filterAndRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Close modal
  function closeModal() {
    summaryModal.classList.remove('active');
  }

  // Build articles list HTML
  function buildArticlesListHtml(articlesData) {
    const typeLabels = {
      journal: '期刊精选',
      blog: '博客推荐',
      news: '资讯动态'
    };

    let html = '<div class="summary-articles-section">';

    for (const [type, articles] of Object.entries(typeLabels)) {
      const articleList = articlesData[type] || [];
      if (articleList.length === 0) continue;

      html += `
        <div class="articles-subsection">
          <h4 class="articles-subsection-title">${articles}</h4>
          <ul class="articles-list">
            ${articleList.map(article => `
              <li class="articles-list-item">
                <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener" class="article-link">
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
  function buildArticlesListText(articlesData) {
    const typeLabels = {
      journal: '期刊精选',
      blog: '博客推荐',
      news: '资讯动态'
    };

    let text = '## 文章列表\n\n';

    for (const [type, label] of Object.entries(typeLabels)) {
      const articleList = articlesData[type] || [];
      if (articleList.length === 0) continue;

      text += `### ${label}\n`;
      articleList.forEach((article, index) => {
        text += `${index + 1}. [${article.title}](${article.url}) - ${article.source_name}\n`;
      });
      text += '\n';
    }

    return text;
  }

  // Copy summary
  async function copySummary() {
    const contentEl = document.querySelector('.summary-detail-content');
    const textToCopy = contentEl?.dataset.fullContent || contentEl?.innerText || '';

    if (!textToCopy) return;

    try {
      await navigator.clipboard.writeText(textToCopy);
      window.toast.success('已复制到剪贴板');
    } catch (err) {
      console.error('Failed to copy:', err);
      window.toast.error('复制失败，请重试');
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
    goToPage,
    copySummary,
    downloadSummary
  };

})();
