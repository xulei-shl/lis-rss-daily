// ============================================
// 主题洞察详情页 - Tab 4: 演化趋势
// 包含：月度新增与累计趋势复合图表、演化动力学计量指标表
// ============================================

import {
  escapeHtml,
  renderInlineNoticeChip,
  isTrendMetricsInsufficient
} from './utils.js';

export function renderTrend(detail) {
  const metrics = detail.metrics || [];
  if (metrics.length === 0) {
    return (
      '<section class="cluster-section">' +
        '<div class="cluster-section-header">' +
          '<h2 class="cluster-section-title">' +
            '<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>' +
            '<span>月度演化趋势与计量指标</span>' +
          '</h2>' +
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

  const insufficient = isTrendMetricsInsufficient(detail);
  const insufficientChip = insufficient
    ? renderInlineNoticeChip({
        tone: 'warn',
        shortText: '有效月份不足 3 个月',
        fullText: '覆盖有效月份不足 3 个月，样本暂不足以推断平滑趋势。',
        extraClass: 'cluster-section-notice'
      })
    : '';

  return (
    '<section class="cluster-section">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title">' +
          '<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>' +
          '<span>演化趋势与计量动力学 (' + metrics.length + ' 个月)</span>' +
        '</h2>' +
        insufficientChip +
      '</div>' +
      '<div class="cluster-chart-card">' + chart + '</div>' +
      '<div class="cluster-table-responsive" style="margin-top:var(--space-4)">' +
        '<table class="cluster-matrix cluster-metrics-table">' +
          '<thead>' +
            '<tr><th>统计月份</th><th>当月新增</th><th>累计总数</th><th>平均相似度</th><th>质心漂移率</th><th>方法熵</th></tr>' +
          '</thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
      renderMetricsGuide() +
    '</section>'
  );
}

function renderMetricsGuide() {
  return (
    '<details class="cluster-accordion cluster-metrics-guide">' +
      '<summary class="cluster-accordion-summary">' +
        '<span class="cluster-accordion-summary-main">' +
          '<svg class="accordion-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' +
          '<span class="accordion-title">指标含义与趋势判读说明</span>' +
          '<span class="cluster-tag cluster-tag-subtle">3 项核心指标</span>' +
        '</span>' +
        '<span class="cluster-accordion-hint">' +
          '<span class="hint-collapsed">展开说明 ↓</span>' +
          '<span class="hint-expanded">收起说明 ↑</span>' +
        '</span>' +
      '</summary>' +
      '<div class="cluster-accordion-body">' +
        '<div class="cluster-metrics-guide-grid">' +
          '<div class="cluster-metrics-guide-item">' +
            '<div class="cluster-metrics-guide-head">' +
              '<span class="cluster-metrics-guide-name">平均相似度</span>' +
              '<span class="cluster-tag cluster-tag-subtle">0 ~ 1</span>' +
            '</div>' +
            '<p class="cluster-metrics-guide-desc"><strong>计算口径：</strong>当月新增文献与主题质心相似度的算术平均值（无新增时显示 <code>—</code>）。</p>' +
            '<p class="cluster-metrics-guide-desc"><strong>趋势判读：</strong>持续高位说明研究紧扣主题核心；持续走低提示议题开始向边缘泛化或酝酿分化。单月新增极少时易受个别文献波动影响。</p>' +
          '</div>' +
          '<div class="cluster-metrics-guide-item">' +
            '<div class="cluster-metrics-guide-head">' +
              '<span class="cluster-metrics-guide-name">质心漂移率</span>' +
              '<span class="cluster-tag cluster-tag-subtle">0 ~ 2</span>' +
            '</div>' +
            '<p class="cluster-metrics-guide-desc"><strong>计算口径：</strong>采用 12 个月滑动窗口，计算「近 12 个月（含当月）」与「上一期近 12 个月」文献向量质心的余弦距离（<code>1 - cos</code>）。</p>' +
            '<p class="cluster-metrics-guide-desc"><strong>趋势判读：</strong><code>&lt; 0.01</code> 表示语义重心基本稳定；<code>&ge; 0.01</code> 且连续上升或出现峰值，说明研究焦点正在发生迁移，可结合代表文献核对转向。</p>' +
          '</div>' +
          '<div class="cluster-metrics-guide-item">' +
            '<div class="cluster-metrics-guide-head">' +
              '<span class="cluster-metrics-guide-name">方法熵</span>' +
              '<span class="cluster-tag cluster-tag-subtle">&ge; 0 bit</span>' +
            '</div>' +
            '<p class="cluster-metrics-guide-desc"><strong>计算口径：</strong>按当月新增文献归一化后的研究方法标签分布计算香农熵（<code>-&Sigma; p log2 p</code>，无标签时显示 <code>—</code>）。</p>' +
            '<p class="cluster-metrics-guide-desc"><strong>趋势判读：</strong>数值越高代表方法越多元（探索期或跨方法融合）；为 <code>0</code> 或偏低代表集中于少数范式（需结合「当月新增」排除样本太少的影响）。</p>' +
          '</div>' +
        '</div>' +
        '<p class="cluster-metrics-guide-note">联合判读建议：先看柱线图规模与有效月份是否足 3 个月，再看「质心漂移率 + 平均相似度」判断焦点是否转移，最后用「方法熵」观察研究手段是在发散还是收敛。</p>' +
      '</div>' +
    '</details>'
  );
}
