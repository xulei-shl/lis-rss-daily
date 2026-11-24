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
          '<h2 class="cluster-section-title">' +
            '<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>' +
            '<span>方法 × 研究对象 对比矩阵</span>' +
          '</h2>' +
        '</div>' +
        '<div class="cluster-empty-inline">样本量较少，暂无法形成可对比的方法与研究对象交叉矩阵。</div>' +
      '</section>'
    );
  }

  const cellMap = {};
  (matrix.cells || []).forEach((cell) => {
    cellMap[cell.method + '\u0000' + cell.object] = cell;
  });

  const header =
    '<tr><th class="matrix-corner">方法 \\ 对象</th>' +
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
    ? '<div class="cluster-holes-strip">' +
        '<div class="cluster-holes-label">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
          '<span>未覆盖空缺（方法与对象尚未组合）：</span>' +
        '</div>' +
        '<div class="cluster-holes-tags">' +
          matrix.holes
            .slice(0, 10)
            .map((hole) => (
              '<span class="cluster-tag cluster-tag-hole" title="该交叉领域目前暂无文献">' +
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
        '<h2 class="cluster-section-title">' +
          '<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>' +
          '<span>方法 × 研究对象 对比矩阵</span>' +
        '</h2>' +
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
        ? '<a class="cluster-cite-pill" href="/articles/' + evidenceIds[0] +
          '" target="_blank" rel="noopener" title="' + escapeHtml(evidenceTitles.join('；')) + '">' +
            '依据 ' + evidenceIds.length + ' 篇文献' +
          '</a>'
        : '';

      const basisKey = gap.basis || 'limitation';
      const basisBadge = '<span class="cluster-gap-basis-badge basis-' + basisKey + '">' +
        escapeHtml(BASIS_LABELS[gap.basis] || gap.basis) +
        (gap.evidenceScope === 'adjacent' ? ' · 跨主题' : '') +
      '</span>';

      return (
        '<div class="cluster-gap-entry">' +
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
        '<h2 class="cluster-section-title">' +
          '<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
          '<span>关键研究空白 (' + gaps.length + ')</span>' +
        '</h2>' +
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
          '<div class="cluster-adjacent-header">' +
            '<span class="cluster-adjacent-name">' + escapeHtml(topic.name) + '</span>' +
            '<svg class="cluster-adjacent-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<line x1="7" y1="17" x2="17" y2="7"></line>' +
              '<polyline points="7 7 17 7 17 17"></polyline>' +
            '</svg>' +
          '</div>' +
          '<div class="cluster-adjacent-tags">' +
            (topic.sharedMethod
              ? '<span class="cluster-tag cluster-tag-shared cluster-tag-shared-method" title="与当前主题共享研究方法">' +
                  '<svg class="cluster-tag-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                    '<polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>' +
                    '<polyline points="2 17 12 22 22 17"></polyline>' +
                    '<polyline points="2 12 12 17 22 12"></polyline>' +
                  '</svg>' +
                  '<span>同研究方法</span>' +
                '</span>'
              : '') +
            (topic.sharedObject
              ? '<span class="cluster-tag cluster-tag-shared cluster-tag-shared-object" title="与当前主题共享研究对象">' +
                  '<svg class="cluster-tag-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                    '<circle cx="12" cy="12" r="10"></circle>' +
                    '<circle cx="12" cy="12" r="4"></circle>' +
                  '</svg>' +
                  '<span>同研究对象</span>' +
                '</span>'
              : '') +
          '</div>' +
        '</a>'
    )
    .join('');

  return (
    '<section class="cluster-section">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title">' +
          '<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>' +
            '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>' +
          '</svg>' +
          '<span>邻近与交叉主题 (' + adjacent.length + ')</span>' +
        '</h2>' +
      '</div>' +
      '<div class="cluster-note">与当前研究方向共享方法或研究对象、但归属于平行分支的关联主题。</div>' +
      '<div class="cluster-adjacent-grid">' + items + '</div>' +
    '</section>'
  );
}
