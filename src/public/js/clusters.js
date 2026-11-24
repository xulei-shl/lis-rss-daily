// ============================================
// 主题洞察列表页
// ============================================

(function () {
  'use strict';

  const overviewBar = document.getElementById('overviewBar');
  const grid = document.getElementById('clusterGrid');
  const emptyState = document.getElementById('clusterEmpty');
  const countEl = document.getElementById('clusterCount');
  const searchInput = document.getElementById('clusterSearch');
  const sortSelect = document.getElementById('clusterSort');

  let searchTimer = null;

  document.addEventListener('DOMContentLoaded', () => {
    loadOverview();
    loadTopics();
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadTopics, 300);
      });
    }
    if (sortSelect) sortSelect.addEventListener('change', loadTopics);
  });

  async function loadOverview() {
    try {
      const res = await fetch('/api/cluster-topics/overview', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      renderOverview(await res.json());
    } catch (err) {
      if (overviewBar) overviewBar.innerHTML = '';
    }
  }

  function renderOverview(data) {
    if (!overviewBar) return;
    if (typeof data.setVersion !== 'number') {
      overviewBar.innerHTML = '<span class="cluster-metric-empty">尚未建立主题集合</span>';
      return;
    }
    const stats = [
      { value: data.topicCount, label: '主题数' },
      { value: data.linkedArticleCount, label: '归属文献' },
      { value: data.poolCount, label: '观察池' },
      { value: data.analysisOkCount, label: '已完成分析' }
    ];
    if (data.analysisFailedCount > 0) {
      stats.push({ value: data.analysisFailedCount, label: '待重算', warn: true });
    }
    overviewBar.innerHTML = stats
      .map(
        (stat) =>
          '<div class="cluster-metric-item' + (stat.warn ? ' is-warn' : '') + '">' +
          '<span class="cluster-metric-value tabular-num">' +
          escapeHtml(String(stat.value)) +
          '</span>' +
          '<span class="cluster-metric-label">' +
          escapeHtml(stat.label) +
          '</span></div>'
      )
      .join('<span class="cluster-metric-divider" aria-hidden="true">/</span>');
  }

  async function loadTopics() {
    const params = new URLSearchParams();
    const q = searchInput ? searchInput.value.trim() : '';
    if (q) params.set('q', q);
    if (sortSelect) params.set('sort', sortSelect.value);
    params.set('limit', '48');

    try {
      const res = await fetch('/api/cluster-topics?' + params.toString(), { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      renderTopics(data.items || [], data.total || 0);
    } catch (err) {
      if (grid) grid.innerHTML = '';
      if (countEl) countEl.textContent = '加载失败，请稍后重试';
    }
  }

  function renderTopics(items, total) {
    if (!grid) return;
    if (countEl) countEl.textContent = total > 0 ? '共 ' + total + ' 个主题' : '';

    if (items.length === 0) {
      grid.innerHTML = '';
      if (emptyState) emptyState.hidden = false;
      return;
    }
    if (emptyState) emptyState.hidden = true;
    grid.innerHTML = items.map(renderCard).join('');
  }

  function renderCard(topic) {
    const statusPill = buildStatusPill(topic);
    const keywords = (topic.keywords || [])
      .slice(0, 4)
      .map((word) => '<span class="cluster-tag">' + escapeHtml(word) + '</span>')
      .join('');

    const range = formatRange(topic.firstEventDate, topic.lastEventDate);
    const metaItems = [
      '<span class="cluster-card-stat"><strong class="tabular-num">' + topic.linkedCount + '</strong> 篇</span>',
      topic.threadCount > 0 ? '<span class="cluster-card-stat"><strong class="tabular-num">' + topic.threadCount + '</strong> 条脉络</span>' : '',
      range ? '<span class="cluster-card-range tabular-num">' + escapeHtml(range) + '</span>' : '',
      topic.periodAddedCount > 0 ? '<span class="cluster-tag cluster-tag-accent tabular-num">+' + topic.periodAddedCount + '</span>' : ''
    ].filter(Boolean).join('<span class="cluster-meta-dot" aria-hidden="true">·</span>');

    const overview = topic.overview
      ? '<p class="cluster-card-overview">' + escapeHtml(topic.overview) + '</p>'
      : '<p class="cluster-card-overview is-empty">多维深度分析待下一轮流水线生成。</p>';

    return (
      '<article class="cluster-card">' +
        '<div class="cluster-card-header">' +
          '<h2 class="cluster-card-title">' +
            '<a href="/clusters/' + encodeURIComponent(topic.slug) + '">' +
              escapeHtml(topic.name) +
            '</a>' +
          '</h2>' +
          (statusPill ? '<div class="cluster-card-status-wrap">' + statusPill + '</div>' : '') +
        '</div>' +
        overview +
        '<div class="cluster-card-footer">' +
          '<div class="cluster-card-meta">' + metaItems + '</div>' +
          (keywords ? '<div class="cluster-card-keywords">' + keywords + '</div>' : '') +
        '</div>' +
      '</article>'
    );
  }

  function buildStatusPill(topic) {
    // 采用最优先的 1 个状态胶囊，避免标签堆叠
    if (topic.trend === 'up') {
      return '<span class="cluster-badge cluster-badge-rising">升温</span>';
    }
    if (topic.trend === 'down') {
      return '<span class="cluster-badge cluster-badge-cooling">退潮</span>';
    }
    if (topic.status === 'NEW') {
      return '<span class="cluster-badge cluster-badge-new">新主题</span>';
    }
    if (topic.status === 'DORMANT') {
      return '<span class="cluster-badge cluster-badge-dormant">冷却</span>';
    }
    if (topic.analysisStatus === 'failed') {
      return '<span class="cluster-badge cluster-badge-failed">待更新</span>';
    }
    if (topic.analysisStatus === 'insufficient_data') {
      return '<span class="cluster-badge cluster-badge-insufficient">样本较少</span>';
    }
    return '';
  }

  function formatRange(first, last) {
    if (!first && !last) return '';
    const fmt = (value) => (value ? String(value).slice(0, 7) : '?');
    return fmt(first) + ' ~ ' + fmt(last);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
