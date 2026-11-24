// ============================================
// 主题洞察详情页 - Tab 3: 矩阵与空白
// 包含：方法 × 研究对象 对比矩阵、研究空白发现、邻近主题
// ============================================

import {
  escapeHtml,
  BASIS_LABELS
} from './utils.js';

export function renderMatrix(detail) {
  const matrix = detail.matrix;
  if (!matrix) return '';
  if ((matrix.methods || []).length === 0 || (matrix.objects || []).length === 0) {
    return (
      '<section class="cluster-section">' +
        '<div class="cluster-section-header">' +
          '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">📊</span> 方法 × 研究对象 对比矩阵</h2>' +
        '</div>' +
        '<div class="cluster-note">样本量不足，暂无法形成可对比的方法与研究对象交叉矩阵。</div>' +
      '</section>'
    );
  }

  const cellMap = {};
  (matrix.cells || []).forEach((cell) => {
    cellMap[cell.method + '\u0000' + cell.object] = cell;
  });

  const header =
    '<tr><th class="matrix-corner">方法 \\ 研究对象</th>' +
    matrix.objects.map((object) => '<th>' + escapeHtml(object) + '</th>').join('') +
    '</tr>';

  const rows = matrix.methods
    .map((method) => {
      const cells = matrix.objects
        .map((object) => {
          const cell = cellMap[method + '\u0000' + object];
          if (!cell) {
            return '<td class="is-hole" title="' + escapeHtml(method + ' × ' + object + '：未覆盖') + '"><span class="hole-dot">·</span></td>';
          }
          const levelCls = cell.count >= 5 ? 'cell-hot-high' : cell.count >= 3 ? 'cell-hot-med' : 'cell-hot-low';
          return (
            '<td class="has-value ' + levelCls + '" title="' + escapeHtml(cell.articleIds.join(', ')) + '">' +
              '<span class="tabular-num cell-value">' + cell.count + '</span>' +
            '</td>'
          );
        })
        .join('');
      return '<tr><th class="matrix-row-head">' + escapeHtml(method) + '</th>' + cells + '</tr>';
    })
    .join('');

  const holesPills = (matrix.holes || []).length
    ? '<div class="cluster-holes-box">' +
        '<div class="cluster-holes-title">💡 显著覆盖空缺（方法与对象尚未组合，按显著度排序）：</div>' +
        '<div class="cluster-holes-tags">' +
          matrix.holes
            .slice(0, 10)
            .map((hole) => (
              '<span class="cluster-tag cluster-tag-hole" title="该交集目前文献空白">' +
                '<span class="hole-icon">⚡</span> ' +
                escapeHtml(hole.method) + ' <span class="hole-cross">×</span> ' + escapeHtml(hole.object) +
              '</span>'
            ))
            .join(' ') +
        '</div>' +
      '</div>'
    : '';

  return (
    '<section class="cluster-section">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">📊</span> 方法 × 研究对象 对比矩阵</h2>' +
      '</div>' +
      '<div class="cluster-note">' +
        '通过文献切面标签纯规则交叉聚合，不依赖模型想象。单元格数字为文献篇数，颜色深度表示聚集热度；鼠标悬停可查看对应文章 ID。' +
      '</div>' +
      '<div class="cluster-table-responsive">' +
        '<table class="cluster-matrix cluster-heatmap-matrix">' +
          '<thead>' + header + '</thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
      holesPills +
    '</section>'
  );
}

export function renderGaps(detail, articleIndex) {
  const gaps = detail.analysis && detail.analysis.gaps ? detail.analysis.gaps : [];
  if (gaps.length === 0) return '';

  const items = gaps
    .map((gap) => {
      const evidenceIds = gap.evidenceArticleIds || [];
      const evidenceTitles = evidenceIds.map((id) => {
        const article = articleIndex[id];
        return article ? article.title : '#' + id;
      });
      const evidence = evidenceIds.length
        ? '<a class="cluster-evidence-pill" href="/articles/' + evidenceIds[0] +
          '" target="_blank" rel="noopener" title="' + escapeHtml(evidenceTitles.join('；')) + '">' +
            '依据 ' + evidenceIds.length + ' 篇文献证据' +
          '</a>'
        : '';

      const basisKey = gap.basis || 'limitation';
      const basisBadge = '<span class="cluster-gap-basis-badge basis-' + basisKey + '">' +
        escapeHtml(BASIS_LABELS[gap.basis] || gap.basis) +
        (gap.evidenceScope === 'adjacent' ? ' · 跨主题证据' : '') +
      '</span>';

      return (
        '<div class="cluster-gap-card">' +
          '<div class="cluster-gap-header">' +
            basisBadge +
            (evidence ? '<div class="cluster-evidence">' + evidence + '</div>' : '') +
          '</div>' +
          '<div class="cluster-gap-text">' + escapeHtml(gap.gap) + '</div>' +
        '</div>'
      );
    })
    .join('');

  return (
    '<section class="cluster-section">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">🔍</span> 关键研究空白 (' + gaps.length + ')</h2>' +
      '</div>' +
      '<div class="cluster-note">' +
        '研究空白由算法从「覆盖矩阵空格、邻近主题差异、时效断层与文献自陈局限」严格推导，' +
        '杜绝虚构，所有空白点均需具备实体文献回溯证据。' +
      '</div>' +
      '<div class="cluster-gaps-container">' + items + '</div>' +
    '</section>'
  );
}

export function renderAdjacent(detail) {
  const adjacent = detail.adjacent || [];
  if (adjacent.length === 0) return '';

  const items = adjacent
    .map(
      (topic) =>
        '<a class="cluster-adjacent-card" href="/clusters/' + encodeURIComponent(topic.slug) + '">' +
          '<span class="cluster-adjacent-name">' + escapeHtml(topic.name) + '</span>' +
          '<span class="cluster-adjacent-tags">' +
            (topic.sharedMethod ? '<span class="cluster-tag cluster-tag-shared">同研究方法</span>' : '') +
            (topic.sharedObject ? '<span class="cluster-tag cluster-tag-shared">同研究对象</span>' : '') +
          '</span>' +
        '</a>'
    )
    .join('');

  return (
    '<section class="cluster-section">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">🔗</span> 邻近与交叉主题 (' + adjacent.length + ')</h2>' +
      '</div>' +
      '<div class="cluster-note">与当前研究方向共享方法或研究对象、但归属于平行分支的关联主题。</div>' +
      '<div class="cluster-adjacent-grid">' + items + '</div>' +
    '</section>'
  );
}
