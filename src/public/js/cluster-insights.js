// ============================================
// 主题内洞察页
// ============================================

(function () {
  'use strict';

  const root = document.getElementById('insightsRoot');
  const countEl = document.getElementById('insightCount');

  const GAP_STATE_LABELS = {
    opening: '正在打开',
    closing: '正在被填补',
    unaddressed: '仍无人回应'
  };

  document.addEventListener('DOMContentLoaded', load);

  async function load() {
    try {
      const res = await fetch('/api/cluster-insights', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      render(data.items || []);
    } catch (err) {
      root.innerHTML = '<div class="cluster-empty">加载失败，请稍后重试。</div>';
    }
  }

  function render(items) {
    if (countEl) countEl.textContent = items.length > 0 ? '共 ' + items.length + ' 份洞察报告' : '';
    if (items.length === 0) {
      root.innerHTML =
        '<div class="cluster-empty">暂无主题内洞察。周分析会在同一主题的综述子簇足够后自动生成。</div>';
      return;
    }
    root.innerHTML = items.map(renderReport).join('');
  }

  function renderReport(report) {
    const topics = (report.topics || [])
      .map(
        (topic) =>
          '<a class="cluster-tag" href="/clusters/' + encodeURIComponent(topic.slug) + '">' +
          escapeHtml(topic.name) +
          '</a>'
      )
      .join(' ');

    const thesis = report.thesis
      ? '<p class="cluster-insight-thesis">' + escapeHtml(report.thesis) + '</p>'
      : '';

    return (
      '<article class="cluster-insight-card">' +
      '<div class="cluster-card-meta">' +
      '<span>报告 v' + report.version + '</span>' +
      '<span>更新于 ' + escapeHtml(formatDateTime(report.updatedAt)) + '</span>' +
      '<span>主题内综合</span>' +
      '</div>' +
      '<h2 class="cluster-insight-title">' + escapeHtml(report.title) + '</h2>' +
      thesis +
      (topics ? '<div class="cluster-card-meta">' + topics + '</div>' : '') +
      renderLinkedSection('🤝 子簇间收敛', report.convergences) +
      renderLinkedSection('⚖️ 张力与条件差异', report.tensions) +
      renderGapMaturity(report.gapMaturity) +
      renderLinkedSection('🧭 研究议程', report.agenda) +
      '</article>'
    );
  }

  function renderLinkedSection(title, items) {
    if (!items || items.length === 0) return '';
    const rows = items
      .map((item) => {
        const refs = []
          .concat((item.reviewIds || []).map((id) => '综述 #' + id))
          .concat((item.gapIds || []).map((id) => '空白 #' + id))
          .map((label) => '<span class="cluster-tag">' + escapeHtml(label) + '</span>')
          .join(' ');
        return (
          '<li>' +
          '<div>' + escapeHtml(item.text) + '</div>' +
          (refs ? '<div class="cluster-thread-sub">' + refs + '</div>' : '') +
          '</li>'
        );
      })
      .join('');
    return (
      '<section class="cluster-insight-section">' +
      '<h3 class="cluster-insight-section-title">' + title + '</h3>' +
      '<ul class="cluster-list">' + rows + '</ul>' +
      '</section>'
    );
  }

  function renderGapMaturity(items) {
    if (!items || items.length === 0) return '';
    const rows = items
      .map(
        (item) =>
          '<div class="cluster-gap">' +
          '<div class="cluster-gap-basis">' +
          escapeHtml(GAP_STATE_LABELS[item.state] || item.state) +
          ' <span class="cluster-tag">空白 #' + item.gapId + '</span>' +
          '</div>' +
          '<div>' + escapeHtml(item.gap || '') + '</div>' +
          '<div class="cluster-thread-sub">' + escapeHtml(item.reason || '') + '</div>' +
          '</div>'
      )
      .join('');
    return (
      '<section class="cluster-insight-section">' +
      '<h3 class="cluster-insight-section-title">🕳️ 研究空白成熟度</h3>' +
      rows +
      '</section>'
    );
  }

  function formatDateTime(value) {
    if (!value) return '未知';
    return String(value).replace('T', ' ').slice(0, 16);
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
