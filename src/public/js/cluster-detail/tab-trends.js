// ============================================
// 主题洞察详情页 - Tab 4: 演化趋势
// 包含：月度新增与累计趋势复合图表、演化动力学计量指标表
// ============================================

import {
  escapeHtml
} from './utils.js';

export function renderTrend(detail) {
  const metrics = detail.metrics || [];
  if (metrics.length === 0) {
    return (
      '<section class="cluster-section">' +
        '<div class="cluster-section-header">' +
          '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">📈</span> 月度趋势与动力学</h2>' +
        '</div>' +
        '<div class="cluster-empty-inline">暂无月度指标度量数据。</div>' +
      '</section>'
    );
  }

  const maxAdded = Math.max.apply(null, metrics.map((row) => row.addedLinkedCount).concat([1]));
  const maxCumulative = Math.max.apply(null, metrics.map((row) => row.cumulativeLinkedCount).concat([1]));
  const width = Math.max(480, metrics.length * 36);
  const height = 180;
  const padX = 16;
  const padTop = 20;
  const padBottom = 20;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;
  const step = plotW / metrics.length;
  const barW = Math.min(20, Math.max(10, step * 0.55));
  const baseline = padTop + plotH;

  const bars = metrics
    .map((row, index) => {
      const barH = (row.addedLinkedCount / maxAdded) * plotH;
      const x = padX + step * index + (step - barW) / 2;
      return (
        '<rect x="' + x.toFixed(1) + '" y="' + (baseline - barH).toFixed(1) +
        '" width="' + barW.toFixed(1) + '" height="' + barH.toFixed(1) +
        '" rx="3" class="cluster-bar-rect"><title>' +
        escapeHtml(row.period + '：新增 ' + row.addedLinkedCount + ' 篇') +
        '</title></rect>'
      );
    })
    .join('');

  const points = metrics.map((row, index) => {
    const x = padX + step * index + step / 2;
    const y = padTop + plotH - (row.cumulativeLinkedCount / maxCumulative) * plotH;
    return x.toFixed(1) + ',' + y.toFixed(1);
  });

  const line = '<polyline points="' + points.join(' ') + '" class="cluster-line" fill="none" />';
  const area =
    '<polygon points="' + padX + ',' + baseline + ' ' + points.join(' ') + ' ' +
    (padX + plotW).toFixed(1) + ',' + baseline + '" class="cluster-area" />';

  const dots = metrics
    .map((row, index) => {
      const x = padX + step * index + step / 2;
      const y = padTop + plotH - (row.cumulativeLinkedCount / maxCumulative) * plotH;
      return (
        '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" class="cluster-line-dot"><title>' +
        escapeHtml(row.period + '：累计 ' + row.cumulativeLinkedCount + ' 篇') +
        '</title></circle>'
      );
    })
    .join('');

  const chart =
    '<div class="cluster-chart-wrap">' +
      '<div class="cluster-chart-legend">' +
        '<span class="legend-item"><span class="legend-color legend-bar"></span> 月度新增文献 (柱)</span>' +
        '<span class="legend-item"><span class="legend-color legend-line"></span> 累计文献规模 (折线)</span>' +
      '</div>' +
      '<svg class="cluster-chart" viewBox="0 0 ' + width + ' ' + height +
      '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="月度新增与累计趋势图">' +
        area + line + bars + dots +
        '<line x1="' + padX + '" y1="' + baseline + '" x2="' + (padX + plotW) +
        '" y2="' + baseline + '" class="cluster-axis" />' +
      '</svg>' +
      '<div class="cluster-chart-labels" style="grid-template-columns:repeat(' + metrics.length + ',1fr)">' +
        metrics.map((row) => '<span>' + escapeHtml(row.period.slice(2)) + '</span>').join('') +
      '</div>' +
    '</div>';

  const rows = metrics
    .map(
      (row) =>
        '<tr>' +
          '<td class="tabular-num">' + escapeHtml(row.period) + '</td>' +
          '<td class="tabular-num">' + (row.addedLinkedCount > 0 ? '<strong>+' + row.addedLinkedCount + '</strong>' : '0') + '</td>' +
          '<td class="tabular-num">' + row.cumulativeLinkedCount + '</td>' +
          '<td class="tabular-num">' + (row.avgSimilarity === null ? '—' : row.avgSimilarity.toFixed(3)) + '</td>' +
          '<td class="tabular-num">' + (row.centroidDrift === null ? '—' : row.centroidDrift.toFixed(3)) + '</td>' +
          '<td class="tabular-num">' + (row.methodEntropy === null ? '—' : row.methodEntropy.toFixed(2)) + '</td>' +
        '</tr>'
    )
    .join('');

  const insufficient = metrics.filter((row) => row.addedLinkedCount > 0).length < 3;

  return (
    '<section class="cluster-section">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">📈</span> 演化趋势与动力学指标</h2>' +
      '</div>' +
      (insufficient
        ? '<div class="cluster-note cluster-note-warn">覆盖有效月份不足 3 个月，样本暂不足以推断长程平滑趋势，仅展示已知指标。</div>'
        : '') +
      '<div class="cluster-chart-card">' + chart + '</div>' +
      '<div class="cluster-table-responsive" style="margin-top:var(--space-4)">' +
        '<table class="cluster-matrix cluster-metrics-table">' +
          '<thead>' +
            '<tr><th>统计月份</th><th>当月新增</th><th>累计总数</th><th>平均相似度</th><th>质心漂移率</th><th>方法熵</th></tr>' +
          '</thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</section>'
  );
}
