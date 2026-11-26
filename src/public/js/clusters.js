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
  const backlogAlert = document.getElementById('clusterBacklogAlert');
  const historyPanel = document.getElementById('clusterHistory');
  const historyBody = document.getElementById('clusterHistoryBody');
  const historyCount = document.getElementById('clusterHistoryCount');

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
    if (data.lastRebalance) {
      const rb = data.lastRebalance;
      const hint = '最近一轮归属再平衡'
        + (rb.at ? '（' + new Date(rb.at).toLocaleString('zh-CN', { hour12: false }) + '）' : '');
      stats.push({ value: rb.changedArticles, label: '上轮调整', title: hint + '：归属链接或主归属发生变化的文章数' });
      stats.push({ value: rb.primarySwitches, label: '迁移主归属', title: hint + '：主归属迁移到另一个主题的文章数' });
    }
    stats.push({
      value: Number(data.pendingFacetCount || 0),
      label: '待抽切面',
      title: '当前仍有全文总结但未抽取切面的文章数（实时）',
      warn: Number(data.pendingFacetCount || 0) > Number(data.facetBacklogThreshold || 0)
    });
    if (data.nextUpdateLabel) {
      const kindLabel = data.nextUpdateKind === 'analysis' ? '下次洞察更新' : '下次聚类更新';
      stats.push({
        value: data.nextUpdateLabel,
        label: kindLabel,
        title: '日更聚类与周度洞察综述中最近的一次定时运行'
      });
    }
    renderBacklogAlert(data);
    renderRunHistory(data.runHistory || []);

    overviewBar.innerHTML = stats
      .map(
        (stat) =>
          '<div class="cluster-metric-item' +
          (stat.warn ? ' is-warn' : '') +
          '"' +
          (stat.title ? ' title="' + escapeHtml(stat.title) + '"' : '') +
          '>' +
          '<span class="cluster-metric-value tabular-num">' +
          escapeHtml(String(stat.value)) +
          '</span>' +
          '<span class="cluster-metric-label">' +
          escapeHtml(stat.label) +
          '</span></div>'
      )
      .join('<span class="cluster-metric-divider" aria-hidden="true">/</span>');
  }

  function renderBacklogAlert(data) {
    if (!backlogAlert) return;
    const pending = Number(data.pendingFacetCount || 0);
    const threshold = Number(data.facetBacklogThreshold || 0);
    if (pending > threshold) {
      backlogAlert.hidden = false;
      backlogAlert.textContent =
        '⚠ 切面抽取积压 ' + pending + ' 篇（告警阈值 ' + threshold + ' 篇），新的主题与洞察可能延迟纳入这批文献。';
    } else {
      backlogAlert.hidden = true;
      backlogAlert.textContent = '';
    }
  }

  const TRIGGER_LABELS = {
    cron: '定时',
    manual: '手动',
    cold_start: '冷启动',
    rebuild: '重建'
  };

  function renderRunHistory(runs) {
    if (!historyPanel || !historyBody) return;
    if (runs.length === 0) {
      historyPanel.hidden = true;
      return;
    }
    historyPanel.hidden = false;
    if (historyCount) {
      const failedCount = runs.filter((r) => r.status === 'failed').length;
      historyCount.textContent = failedCount > 0
        ? '最近 ' + runs.length + ' 次 · ' + failedCount + ' 次失败'
        : '最近 ' + runs.length + ' 次';
    }

    const rows = runs
      .map((run) => {
        const time = run.at
          ? new Date(run.at).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '—';
        const duration = run.durationMs ? Math.round(run.durationMs / 1000) + 's' : '—';
        const trigger = run.trigger === 'cron'
          ? (run.analysisExecuted ? '周分析' : '日增量')
          : (TRIGGER_LABELS[run.trigger] || escapeHtml(run.trigger));
        const provenance = run.analysisExecuted
          ? (run.sourceRebalanceRuns > 0
            ? '覆盖 ' + run.sourceRebalanceRuns + ' 轮 / ' + (run.sourceRebalancedArticles || 0) + ' 篇'
            : '无再平衡')
          : '—';
        const status = run.status === 'failed'
          ? '<span class="cluster-history-failed">失败</span>'
          : '<span class="cluster-history-ok">完成</span>';
        return (
          '<tr>' +
            '<td class="tabular-num">' + escapeHtml(time) + '</td>' +
            '<td>' + trigger + '</td>' +
            '<td class="tabular-num is-num">' + duration + '</td>' +
            '<td class="tabular-num is-num">' + (run.changedArticles || 0) + '</td>' +
            '<td class="tabular-num is-num">' + (run.primarySwitches || 0) + '</td>' +
            '<td class="tabular-num is-num">' + (run.facetPending || 0) + '</td>' +
            '<td>' + escapeHtml(provenance) + '</td>' +
            '<td>' + status + '</td>' +
          '</tr>'
        );
      })
      .join('');

    historyBody.innerHTML =
      '<table class="cluster-history-table">' +
        '<thead><tr>' +
          '<th>时间</th><th>触发</th><th class="is-num">耗时</th><th class="is-num">调整</th><th class="is-num">迁主</th><th class="is-num">待抽</th><th>再平衡溯源</th><th>状态</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
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
