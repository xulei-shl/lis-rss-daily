// ============================================
// 主题洞察详情页 - Tab 3: 矩阵与空白
// 包含：方法 × 研究对象 对比矩阵、研究空白发现、邻近主题
// ============================================

import {
  escapeHtml,
  renderInlineNoticeChip,
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
    .map((gap, idx) => {
      const evidenceIds = gap.evidenceArticleIds || [];
      const evidenceArticles = evidenceIds.map((id, aIdx) => {
        const article = articleIndex[id];
        return {
          id,
          index: aIdx + 1,
          title: article && article.title ? article.title : '#' + id,
        };
      });

      const drawerId = 'gap-evidence-' + (idx + 1);
      let evidence = '';

      if (evidenceArticles.length === 1) {
        const single = evidenceArticles[0];
        const tip = '依据文献：\n' + single.title + '\n(点击在新标签页打开详情)';
        evidence =
          '<a class="cluster-cite-pill" href="/articles/' + single.id +
          '" target="_blank" rel="noopener" title="' + escapeHtml(tip) + '">' +
            '<span>依据 1 篇文献</span>' +
            '<svg class="cite-pill-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<line x1="7" y1="17" x2="17" y2="7"></line>' +
              '<polyline points="7 7 17 7 17 17"></polyline>' +
            '</svg>' +
          '</a>';
      } else if (evidenceArticles.length > 1) {
        const tipLines = evidenceArticles.map((a) => a.index + '. ' + a.title).join('\n');
        const tip = '依据 ' + evidenceArticles.length + ' 篇文献：\n' + tipLines + '\n(点击展开/收起文献清单)';
        evidence =
          '<button type="button" class="cluster-cite-pill cluster-cite-toggle" aria-expanded="false" ' +
            'aria-controls="' + drawerId + '" title="' + escapeHtml(tip) + '">' +
            '<span>依据 ' + evidenceArticles.length + ' 篇文献</span>' +
            '<svg class="cite-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<polyline points="6 9 12 15 18 9"></polyline>' +
            '</svg>' +
          '</button>';
      }

      const drawerHtml = evidenceArticles.length > 1
        ? '<div class="cluster-gap-evidence-drawer" id="' + drawerId + '" hidden>' +
            '<div class="cluster-gap-evidence-head">' +
              '<div class="cluster-gap-evidence-lead">' +
                '<svg class="cluster-gap-evidence-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                  '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>' +
                  '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>' +
                '</svg>' +
                '<span class="cluster-gap-evidence-label">依据文献清单 (' + evidenceArticles.length + ' 篇)</span>' +
              '</div>' +
              '<span class="cluster-gap-evidence-hint">点击可直达单篇文献详情</span>' +
            '</div>' +
            '<div class="cluster-gap-evidence-list">' +
              evidenceArticles
                .map((a) => (
                  '<a class="cluster-gap-evidence-item" href="/articles/' + a.id + '" target="_blank" rel="noopener" title="' + escapeHtml(a.title) + '">' +
                    '<span class="cluster-gap-evidence-num">' + a.index + '.</span>' +
                    '<span class="cluster-gap-evidence-badge"><span class="cite-hash">#</span>' + a.id + '</span>' +
                    '<span class="cluster-gap-evidence-title">' + escapeHtml(a.title) + '</span>' +
                    '<svg class="cluster-gap-evidence-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                      '<line x1="7" y1="17" x2="17" y2="7"></line>' +
                      '<polyline points="7 7 17 7 17 17"></polyline>' +
                    '</svg>' +
                  '</a>'
                ))
                .join('') +
            '</div>' +
          '</div>'
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
          drawerHtml +
        '</div>'
      );
    })
    .join('');

  return (
    '<section class="cluster-section">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title">' +
          '<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
          '<span>研究空白 (' + gaps.length + ')</span>' +
        '</h2>' +
      '</div>' +
      '<div class="cluster-gaps-container">' + items + '</div>' +
    '</section>'
  );
}

export function bindMatrixEvents(root) {
  if (!root || root._matrixEventsBound) return;
  root._matrixEventsBound = true;

  root.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.cluster-cite-toggle');
    if (!toggleBtn) return;
    const targetId = toggleBtn.getAttribute('aria-controls');
    if (!targetId) return;
    const drawer = root.querySelector('#' + targetId);
    if (!drawer) return;
    const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    toggleBtn.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
    drawer.hidden = isExpanded;
  });
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

  const adjacentChip = renderInlineNoticeChip({
    tone: 'info',
    shortText: '共享方法/对象之平行分支',
    fullText: '与当前研究方向共享方法或研究对象、但归属于平行分支的关联主题。',
    extraClass: 'cluster-section-notice'
  });

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
        adjacentChip +
      '</div>' +
      '<div class="cluster-adjacent-grid">' + items + '</div>' +
    '</section>'
  );
}
