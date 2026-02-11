// ============================================
// DAILY SUMMARY PANEL
// ============================================

(function() {
  'use strict';

  const dailySummaryPanel = document.getElementById('dailySummaryPanel');
  const summaryPanelHeader = document.getElementById('summaryPanelHeader');
  const summaryPanelContent = document.getElementById('summaryPanelContent');
  const panelChevron = document.getElementById('panelChevron');
  const refreshBtn = document.getElementById('refreshBtn');
  const historyBtn = document.getElementById('historyBtn');
  const generateBtn = document.getElementById('generateBtn');
  const copySummaryBtn = document.getElementById('copySummaryBtn');
  const downloadSummaryBtn = document.getElementById('downloadSummaryBtn');
  const regenerateBtn = document.getElementById('regenerateBtn');
  const historyModal = document.getElementById('historyModal');
  const closeHistoryModal = document.getElementById('closeHistoryModal');

  // Toggle panel expansion
  summaryPanelHeader.addEventListener('click', () => {
    dailySummaryPanel.classList.toggle('expanded');
    // Load summary on first expand if not loaded
    if (dailySummaryPanel.classList.contains('expanded') && !summaryPanelContent.dataset.loaded) {
      loadTodaySummary();
      summaryPanelContent.dataset.loaded = 'true';
    }
  });

  // Refresh button
  refreshBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await loadTodaySummary();
  });

  // History button
  historyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openHistoryModal();
  });

  // Generate button
  generateBtn.addEventListener('click', async () => {
    await generateDailySummary();
  });

  // Regenerate button
  regenerateBtn.addEventListener('click', async () => {
    await generateDailySummary();
  });

  // Copy button
  copySummaryBtn.addEventListener('click', async () => {
    const summaryTextEl = document.getElementById('summaryText');
    // Use full content if available (summary + articles list), otherwise use innerText
    const textToCopy = summaryTextEl.dataset.fullContent || summaryTextEl.innerText;
    try {
      await navigator.clipboard.writeText(textToCopy);
      const originalText = copySummaryBtn.innerHTML;
      copySummaryBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        已复制!
      `;
      setTimeout(() => {
        copySummaryBtn.innerHTML = originalText;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  });

  // Download button
  downloadSummaryBtn.addEventListener('click', () => {
    const summaryTextEl = document.getElementById('summaryText');
    const textToDownload = summaryTextEl.dataset.fullContent || summaryTextEl.innerText;
    const date = document.querySelector('.summary-meta-item span')?.textContent || 'summary';
    const filename = `daily-summary-${date}.md`;

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
  });

  // Close history modal
  closeHistoryModal.addEventListener('click', () => {
    historyModal.classList.remove('active');
  });

  historyModal.addEventListener('click', (e) => {
    if (e.target === historyModal) {
      historyModal.classList.remove('active');
    }
  });

  // Load today's summary
  async function loadTodaySummary() {
    showSummaryLoading();

    try {
      const res = await fetch('/api/daily-summary/today');

      if (res.status === 404) {
        showSummaryEmpty();
        return;
      }

      if (!res.ok) {
        throw new Error('Failed to load summary');
      }

      const data = await res.json();
      showSummaryResult(data.summary_date, data.article_count, data.summary_content, data.created_at);
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
        body: JSON.stringify({ limit: 30 })
      });

      if (!res.ok) {
        throw new Error('Failed to generate summary');
      }

      const data = await res.json();
      showSummaryResult(data.date, data.totalArticles, data.summary, data.generatedAt);
    } catch (err) {
      console.error('Failed to generate summary:', err);
      showSummaryError('生成失败，请重试');
    }
  }

  // Show loading state
  function showSummaryLoading() {
    document.getElementById('summaryLoading').style.display = 'flex';
    document.getElementById('summaryEmpty').style.display = 'none';
    document.getElementById('summaryResult').style.display = 'none';
    document.getElementById('summaryError').style.display = 'none';
  }

  // Show empty state
  function showSummaryEmpty() {
    document.getElementById('summaryLoading').style.display = 'none';
    document.getElementById('summaryEmpty').style.display = 'block';
    document.getElementById('summaryResult').style.display = 'none';
    document.getElementById('summaryError').style.display = 'none';
  }

  // Show result state
  async function showSummaryResult(date, articleCount, summary, generatedAt) {
    document.getElementById('summaryLoading').style.display = 'none';
    document.getElementById('summaryEmpty').style.display = 'none';
    document.getElementById('summaryError').style.display = 'none';
    document.getElementById('summaryResult').style.display = 'block';

    // Render meta
    document.getElementById('summaryMeta').innerHTML = `
      <div class="summary-meta-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        <span>${date}</span>
      </div>
      <div class="summary-meta-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        </svg>
        <span>${articleCount} 篇文章</span>
      </div>
      <div class="summary-meta-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        <span>生成于 ${new Date(generatedAt).toLocaleTimeString('zh-CN')}</span>
      </div>
    `;

    // Render summary content
    const summaryHtml = renderMarkdown(summary);
    document.getElementById('summaryText').innerHTML = summaryHtml;

    // Load and render articles list
    await loadAndRenderArticlesList(date, summary);
  }

  // Show error state
  function showSummaryError(message) {
    document.getElementById('summaryLoading').style.display = 'none';
    document.getElementById('summaryEmpty').style.display = 'none';
    document.getElementById('summaryResult').style.display = 'none';
    const errorEl = document.getElementById('summaryError');
    errorEl.style.display = 'block';
    errorEl.textContent = message;
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

  // Open history modal
  async function openHistoryModal() {
    historyModal.classList.add('active');
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '<div class="loading">加载中...</div>';

    try {
      const res = await fetch('/api/daily-summary/history?limit=5');
      if (!res.ok) throw new Error('Failed to load history');

      const data = await res.json();
      const history = data.history || [];

      if (history.length === 0) {
        historyList.innerHTML = '<div class="history-empty">暂无历史记录</div>';
        return;
      }

      historyList.innerHTML = history.map(item => `
        <div class="history-item" onclick="window.dailySummary.viewHistorySummary('${item.summary_date}')">
          <div class="history-date">${item.summary_date}</div>
          <div class="history-meta">${item.article_count} 篇章 · ${formatDate(item.created_at)}</div>
        </div>
      `).join('') + `
        <div class="history-more">
          <a href="/history">查看全部历史 →</a>
        </div>
      `;
    } catch (err) {
      console.error('Failed to load history:', err);
      historyList.innerHTML = '<div class="history-empty">加载失败</div>';
    }
  }

  // Format date helper (shared with home page)
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

  // View history summary
  async function viewHistorySummary(date) {
    historyModal.classList.remove('active');

    // Expand panel and load the specific date
    dailySummaryPanel.classList.add('expanded');
    showSummaryLoading();

    try {
      const res = await fetch(`/api/daily-summary/${date}`);
      if (!res.ok) throw new Error('Failed to load summary');

      const data = await res.json();
      showSummaryResult(data.summary_date, data.article_count, data.summary_content, data.created_at);
    } catch (err) {
      console.error('Failed to load summary:', err);
      showSummaryError('加载失败，请重试');
    }
  }

  // Load and render articles list
  async function loadAndRenderArticlesList(date, summary) {
    try {
      const res = await fetch(`/api/daily-summary/${date}/articles`);
      if (!res.ok) return;

      const articlesData = await res.json();
      renderArticlesList(articlesData, summary);
    } catch (err) {
      console.error('Failed to load articles:', err);
    }
  }

  // Render articles list
  function renderArticlesList(articlesData, summary) {
    const summaryText = document.getElementById('summaryText');
    const articlesHtml = buildArticlesListHtml(articlesData);

    // Append articles list after summary
    summaryText.innerHTML += articlesHtml;

    // Store full content for copy/download
    summaryText.dataset.fullContent = summary + '\n\n' + buildArticlesListText(articlesData);
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

  // Export for external access (e.g., history item onclick)
  window.dailySummary = {
    viewHistorySummary
  };

})();
