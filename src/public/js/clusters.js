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
      overviewBar.innerHTML = '<div class="cluster-stat"><div class="cluster-stat-value">—</div><div class="cluster-stat-label">尚未建立主题集合</div></div>';
      return;
    }
    const stats = [
      { value: data.topicCount, label: '主题数' },
      { value: data.linkedArticleCount, label: '已归属文章' },
      { value: data.poolCount, label: '游离观察池' },
      { value: data.analysisOkCount, label: '已完成多维分析' }
    ];
    if (data.analysisFailedCount > 0) {
      stats.push({ value: data.analysisFailedCount, label: '分析待重算' });
    }
    overviewBar.innerHTML = stats
      .map(
        (stat) =>
          '<div class="cluster-stat"><div class="cluster-stat-value">' +
          escapeHtml(String(stat.value)) +
          '</div><div class="cluster-stat-label">' +
          escapeHtml(stat.label) +
          '</div></div>'
      )
      .join('');
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
    const badges = buildBadges(topic);
    const keywords = (topic.keywords || [])
      .slice(0, 5)
      .map((word) => '<span class="cluster-tag">' + escapeHtml(word) + '</span>')
      .join('');

    const range = formatRange(topic.firstEventDate, topic.lastEventDate);
    const meta = [
      '<span>' + topic.linkedCount + ' 篇</span>',
      topic.threadCount > 0 ? '<span>' + topic.threadCount + ' 条脉络</span>' : '',
      topic.angleCount ? '<span>' + topic.angleCount + ' 个角度</span>' : '',
      range ? '<span>' + escapeHtml(range) + '</span>' : '',
      topic.periodAddedCount > 0 ? '<span>本期 +' + topic.periodAddedCount + '</span>' : ''
    ].filter(Boolean).join('');

    const overview = topic.overview
      ? '<div class="cluster-card-overview">' + escapeHtml(topic.overview) + '</div>'
      : '<div class="cluster-card-overview" style="opacity:.6">该主题的多维分析尚未生成。</div>';

    return (
      '<article class="cluster-card">' +
      '<a class="cluster-card-title" href="/clusters/' + encodeURIComponent(topic.slug) + '">' +
      escapeHtml(topic.name) +
      '</a>' +
      badges +
      overview +
      '<div class="cluster-card-meta">' + meta + '</div>' +
      (keywords ? '<div class="cluster-card-meta">' + keywords + '</div>' : '') +
      '</article>'
    );
  }

  function buildBadges(topic) {
    const badges = [];
    if (topic.status === 'NEW') badges.push(['cluster-badge-new', '新主题']);
    if (topic.status === 'DORMANT') badges.push(['cluster-badge-dormant', '已冷却']);
    if (topic.trend === 'up') badges.push(['cluster-badge-rising', '升温']);
    if (topic.trend === 'down') badges.push(['cluster-badge-cooling', '退潮']);
    if (topic.analysisStatus === 'insufficient_data') badges.push(['cluster-badge-insufficient', '样本不足']);
    if (topic.analysisStatus === 'failed') badges.push(['cluster-badge-failed', '分析待更新']);
    if (badges.length === 0) return '';
    return (
      '<div class="cluster-card-meta">' +
      badges
        .map(([cls, label]) => '<span class="cluster-badge ' + cls + '">' + escapeHtml(label) + '</span>')
        .join('') +
      '</div>'
    );
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
