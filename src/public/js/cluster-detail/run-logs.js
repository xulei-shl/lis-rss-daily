// ============================================
// 主题洞察详情页 - 运行日志模块（移至底页次级区域）
// ============================================

import {
  escapeHtml,
  formatDateTime,
  formatDuration,
  TRIGGER_LABELS,
  RUN_STATUS_LABELS
} from './utils.js';

export function renderRunLogs(detail) {
  const logs = detail.runLogs || [];
  const latestRun = logs.length > 0 ? logs[0] : null;

  let statusCls = 'idle';
  let statusText = '暂无记录';
  let briefDetails = '下一轮增量流水线执行后将生成执行记录';

  if (latestRun) {
    if (latestRun.status === 'completed') statusCls = 'success';
    else if (latestRun.status === 'failed') statusCls = 'danger';
    else if (latestRun.status === 'running') statusCls = 'running';

    statusText = RUN_STATUS_LABELS[latestRun.status] || latestRun.status;
    const dur = latestRun.durationMs !== null ? formatDuration(latestRun.durationMs) : '—';
    const trig = TRIGGER_LABELS[latestRun.trigger] || latestRun.trigger;
    const added = latestRun.addedCount > 0 ? `+${latestRun.addedCount} 篇文献` : '无文献新增';
    const revAdded = (latestRun.reviewAddedCount || 0) > 0 ? ` / +${latestRun.reviewAddedCount} 综述` : '';

    briefDetails = `最近执行：${formatDateTime(latestRun.startedAt)} · ${trig} · 耗时 ${dur} · ${added}${revAdded}`;
  }

  const rows = logs
    .map((run) => {
      const failed = run.status === 'failed';
      const statusLabel = RUN_STATUS_LABELS[run.status] || run.status;
      const statusBadge = '<span class="cluster-run-badge cluster-run-badge-' + run.status + '">' + escapeHtml(statusLabel) + '</span>';

      return (
        '<tr>' +
          '<td class="tabular-num">' + escapeHtml(formatDateTime(run.startedAt)) + '</td>' +
          '<td><span class="cluster-tag">' + escapeHtml(TRIGGER_LABELS[run.trigger] || run.trigger) + '</span></td>' +
          '<td class="tabular-num">' + (run.addedCount > 0 ? '<strong>+' + run.addedCount + '</strong>' : '0') + '</td>' +
          '<td class="tabular-num">' + ((run.reviewAddedCount || 0) > 0 ? '+' + run.reviewAddedCount : '0') + '</td>' +
          '<td>' +
            statusBadge +
            (failed && run.errorMessage
              ? ' <span class="cluster-run-error-icon" title="' + escapeHtml(run.errorMessage) + '">⚠️</span>'
              : '') +
          '</td>' +
          '<td class="tabular-num">' + (run.durationMs === null ? '—' : escapeHtml(formatDuration(run.durationMs))) + '</td>' +
        '</tr>'
      );
    })
    .join('');

  const tableBody = logs.length
    ? '<div class="cluster-table-responsive">' +
        '<table class="cluster-matrix cluster-run-table">' +
          '<thead>' +
            '<tr><th>执行时间</th><th>触发源</th><th>新增文献</th><th>新增综述</th><th>状态</th><th>耗时</th></tr>' +
          '</thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>'
    : '<div class="cluster-empty-inline">暂无执行流水记录。</div>';

  return (
    '<details class="cluster-run-drawer is-bottom" id="clusterRunDrawer">' +
      '<summary class="cluster-run-summary" aria-label="查看流水线运行日志">' +
        '<div class="cluster-run-summary-left">' +
          '<span class="cluster-status-dot cluster-status-dot-' + statusCls + '" aria-hidden="true"></span>' +
          '<span class="cluster-run-title">流水线状态：<strong>' + escapeHtml(statusText) + '</strong></span>' +
          '<span class="cluster-run-meta-desc">' + escapeHtml(briefDetails) + '</span>' +
        '</div>' +
        '<div class="cluster-run-summary-right">' +
          '<span class="cluster-run-count-badge">日志 (' + logs.length + ')</span>' +
          '<svg class="cluster-drawer-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
            '<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>' +
          '</svg>' +
        '</div>' +
      '</summary>' +
      '<div class="cluster-run-drawer-body">' +
        tableBody +
      '</div>' +
    '</details>'
  );
}

// 兼容别名
export const renderTopRunLogs = renderRunLogs;
