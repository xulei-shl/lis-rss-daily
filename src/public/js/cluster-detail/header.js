// ============================================
// 主题洞察详情页 - 顶部标题与时空元数据
// ============================================

import {
  escapeHtml,
  formatMonth,
  formatDateTime,
  getAnalysisStatusNotice,
  renderInlineNoticeChip
} from './utils.js';

export function renderHeader(detail) {
  const badges = [];
  if (detail.status === 'NEW') badges.push(['cluster-badge-new', '新主题']);
  if (detail.status === 'DORMANT') badges.push(['cluster-badge-dormant', '已冷却']);
  if (detail.analysis && detail.analysis.trend && detail.analysis.trend.direction === 'up') {
    badges.push(['cluster-badge-rising', '升温']);
  }
  if (detail.analysis && detail.analysis.trend && detail.analysis.trend.direction === 'down') {
    badges.push(['cluster-badge-cooling', '退潮']);
  }

  const keywords = (detail.keywords || [])
    .slice(0, 8)
    .map((word) => '<span class="cluster-tag">' + escapeHtml(word) + '</span>')
    .join('');

  const range = detail.firstEventDate || detail.lastEventDate
    ? escapeHtml(formatMonth(detail.firstEventDate)) + ' ~ ' + escapeHtml(formatMonth(detail.lastEventDate))
    : '时间跨度未知';

  const badgeHtml = badges.length
    ? badges.map(([cls, label]) => '<span class="cluster-badge ' + cls + '">' + escapeHtml(label) + '</span>').join(' ')
    : '';

  const logs = detail.runLogs || [];
  const latestRun = logs.length > 0 ? logs[0] : null;
  let runStatusCls = 'idle';
  let runStatusText = '暂无记录';
  if (latestRun) {
    if (latestRun.status === 'completed') runStatusCls = 'success';
    else if (latestRun.status === 'failed') runStatusCls = 'danger';
    else if (latestRun.status === 'running') runStatusCls = 'running';
    runStatusText = latestRun.status === 'completed' ? '正常' : latestRun.status === 'failed' ? '异常' : '进行中';
  }

  const statusNotice = renderStatusNotice(detail);
  const hasFooter = Boolean(keywords || statusNotice);

  return (
    '<div class="cluster-detail-header">' +
      '<div class="cluster-detail-topbar">' +
        '<nav class="cluster-breadcrumbs" aria-label="主题路径导航">' +
          '<a href="/clusters" class="cluster-breadcrumb-link">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>' +
            '<span>主题洞察</span>' +
          '</a>' +
          '<span class="cluster-breadcrumb-separator" aria-hidden="true">/</span>' +
          '<span class="cluster-breadcrumb-current">' + escapeHtml(detail.name) + '</span>' +
        '</nav>' +
        '<button type="button" class="cluster-pipeline-badge" id="btnToggleRunLogs" title="点击查看流水线执行记录">' +
          '<span class="cluster-status-dot cluster-status-dot-' + runStatusCls + '" aria-hidden="true"></span>' +
          '<span>流水线' + escapeHtml(runStatusText) + '</span>' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
        '</button>' +
      '</div>' +

      '<div class="cluster-title-wrap">' +
        '<h1 class="cluster-page-title">' + escapeHtml(detail.name) + '</h1>' +
        (badgeHtml ? '<div class="cluster-title-badges">' + badgeHtml + '</div>' : '') +
      '</div>' +

      '<div class="cluster-header-meta">' +
        '<span class="cluster-meta-pill" title="关联文献总数">' +
          '<strong>' + detail.linkedCount + '</strong> 篇文献' +
          '<span class="cluster-meta-sub">（主归属 ' + detail.primaryCount + '）</span>' +
        '</span>' +
        '<span class="cluster-meta-dot" aria-hidden="true">·</span>' +
        '<span class="cluster-meta-pill" title="文献涵盖时间段">' + escapeHtml(range) + '</span>' +
        '<span class="cluster-meta-dot" aria-hidden="true">·</span>' +
        '<span class="cluster-meta-pill" title="研究脉络数">' + (detail.angles || []).length + ' 条脉络</span>' +
        '<span class="cluster-meta-dot" aria-hidden="true">·</span>' +
        '<span class="cluster-meta-pill cluster-meta-time" title="分析最近更新时间">' +
          '更新于 ' + escapeHtml(formatDateTime(detail.updatedAt)) +
        '</span>' +
      '</div>' +

      (hasFooter
        ? '<div class="cluster-header-footer">' +
            (keywords ? '<div class="cluster-keywords-wrap">' + keywords + '</div>' : '') +
            statusNotice +
          '</div>'
        : '') +
    '</div>'
  );
}

export function renderStatusNotice(detail) {
  const notice = getAnalysisStatusNotice(detail);
  if (!notice || !notice.shortText) return '';

  const fullText = notice.fullHtml.replace(/<[^>]+>/g, '');
  return renderInlineNoticeChip({
    tone: notice.tone,
    shortText: notice.shortText,
    fullText,
    extraClass: 'cluster-header-notice',
    id: 'btnHeaderStatusNotice'
  });
}
