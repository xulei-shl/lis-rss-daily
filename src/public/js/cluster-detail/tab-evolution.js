// ============================================
// 主题洞察详情页 - Tab 2: 演进脉络
// 包含：研究角度与时序脉络、零散研究
// ============================================

import {
  escapeHtml,
  formatDate,
  trendLabel,
  RELATION_LABELS,
  ROLE_LABELS
} from './utils.js';

export function renderAngles(detail, _articleIndex) {
  if (!detail.angles || detail.angles.length === 0) {
    return (
      '<section class="cluster-section">' +
        '<div class="cluster-section-header">' +
          '<h2 class="cluster-section-title">' +
            '<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>' +
            '<span>研究角度与演进脉络</span>' +
          '</h2>' +
        '</div>' +
        '<div class="cluster-empty-inline">暂无归纳的研究角度与时序脉络。</div>' +
      '</section>'
    );
  }

  const angles = detail.angles
    .map((angle) => {
      const isDivergent = angle.patternType === 'divergent';
      const allSteps = angle.steps || [];
      const backboneCount = allSteps.filter((step) => step.academicRole === 'backbone').length;
      const head =
        '<div class="cluster-angle-head">' +
          '<span class="cluster-angle-name">' +
            escapeHtml(angle.angleLabel || '未命名子域') +
          '</span>' +
          (isDivergent
            ? '<span class="cluster-tag cluster-tag-divergent">并列子域</span>'
            : '<span class="cluster-tag cluster-tag-linear">时序脉络</span>') +
          '<span class="cluster-tag cluster-tag-subtle">' + angle.articleCount + ' 篇文献</span>' +
          (!isDivergent && backboneCount < allSteps.length
            ? '<span class="cluster-tag cluster-tag-subtle">连续段 ' + backboneCount + ' 篇</span>'
            : '') +
          (angle.trend ? '<span class="cluster-tag cluster-tag-subtle">' + trendLabel(angle.trend) + '</span>' : '') +
        '</div>';

      const narrative = angle.narrative
        ? '<div class="cluster-angle-narrative">' + escapeHtml(angle.narrative) + '</div>'
        : '';

      const representativeSteps = isDivergent
        ? allSteps.filter((step) => step.isRepresentative)
        : allSteps;
      const restSteps = isDivergent
        ? allSteps.filter((step) => !step.isRepresentative)
        : [];

      const stepsHtml = representativeSteps.map((step) => renderStep(step)).join('');
      const restHtml = restSteps.length > 0
        ? '<details class="cluster-accordion cluster-divergent-details">' +
            '<summary class="cluster-accordion-summary">展开其余 ' + restSteps.length + ' 篇子域成员</summary>' +
            '<ol class="cluster-thread">' +
              restSteps.map((step) => renderStep(step)).join('') +
            '</ol>' +
          '</details>'
        : '';

      const divergentNote = isDivergent
        ? '<div class="cluster-ambient-tip">该子域未识别出连续承接段（至少 3 篇），以下先呈现质心代表文献；展开可查看全部成员。</div>'
        : backboneCount < allSteps.length
          ? '<div class="cluster-ambient-tip">其中 ' + backboneCount + ' 篇构成连续承接段，其余 ' + (allSteps.length - backboneCount) + ' 篇为同一子域背景文献。</div>'
          : '';

      return (
        '<div class="cluster-angle-dossier">' +
          head +
          narrative +
          divergentNote +
          '<ol class="cluster-thread">' + stepsHtml + '</ol>' +
          restHtml +
        '</div>'
      );
    })
    .join('');

  return (
    '<section class="cluster-section">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title">' +
          '<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>' +
          '<span>研究角度与演进脉络 (' + detail.angles.length + ')</span>' +
        '</h2>' +
      '</div>' +
      '<div class="cluster-angles-container">' + angles + '</div>' +
    '</section>'
  );
}

function renderStep(step) {
  const relation = step.relation === 'loose' ? 'shift' : step.relation || 'divergent';
  const tags = [];
  if (step.isRepresentative) {
    tags.push('<span class="cluster-tag cluster-tag-rep">子域代表文献</span>');
  }
  if (!step.isRepresentative && ROLE_LABELS[step.academicRole]) {
    tags.push('<span class="cluster-tag">' + ROLE_LABELS[step.academicRole] + '</span>');
  }
  if (RELATION_LABELS[step.relation]) {
    tags.push('<span class="cluster-tag cluster-tag-relation">' + RELATION_LABELS[step.relation] + '</span>');
  }
  if (step.sharedMethod) tags.push('<span class="cluster-tag">方法延续</span>');
  if (step.sharedObject) tags.push('<span class="cluster-tag">对象延续</span>');
  if (step.crossPrecision) tags.push('<span class="cluster-tag">时间精度不同</span>');
  if (typeof step.similarityToPrev === 'number') {
    tags.push('<span class="cluster-tag">与前篇相似度 ' + step.similarityToPrev.toFixed(2) + '</span>');
  }

  const facet = step.facet;
  const facetLine = facet
    ? escapeHtml(facet.research_question) +
      ' ｜ 方法：' + escapeHtml(facet.method) +
      ' ｜ 对象：' + escapeHtml(facet.study_object)
    : '';

  return (
    '<li class="cluster-thread-item" data-relation="' + escapeHtml(relation) + '">' +
      '<div class="cluster-thread-content">' +
        '<a class="cluster-thread-title" href="/articles/' + step.articleId + '" target="_blank" rel="noopener">' +
          escapeHtml(step.title) +
        '</a>' +
        '<div class="cluster-thread-sub">' +
          '<span class="tabular-num">' + escapeHtml(formatDate(step.eventDate)) + '</span>' +
          (step.precision === 'year' ? '（年级精度）' : step.precision === 'ingest' ? '（入库时间）' : '') +
        '</div>' +
        (facetLine ? '<div class="cluster-thread-facet">' + facetLine + '</div>' : '') +
        (tags.length ? '<div class="cluster-thread-tags">' + tags.join(' ') + '</div>' : '') +
      '</div>' +
    '</li>'
  );
}

export function renderLoose(detail) {
  const loose = detail.looseArticles || [];
  if (loose.length === 0) return '';

  const items = loose
    .map((step) => (
      '<li class="cluster-thread-item" data-relation="shift">' +
        '<div class="cluster-thread-content">' +
          '<a class="cluster-thread-title" href="/articles/' + step.articleId + '" target="_blank" rel="noopener">' +
            escapeHtml(step.title) +
          '</a>' +
          '<div class="cluster-thread-sub">' +
            '<span class="tabular-num">' + escapeHtml(formatDate(step.eventDate)) + '</span>' +
            (step.facet ? ' ｜ ' + escapeHtml(step.facet.study_object) : '') +
          '</div>' +
        '</div>' +
      '</li>'
    ))
    .join('');

  return (
    '<section class="cluster-section">' +
      '<details class="cluster-details">' +
        '<summary class="cluster-details-summary">' +
          '<h3 class="cluster-section-title" style="display:inline-flex;margin:0">' +
            '<span class="section-icon" aria-hidden="true">🗂️</span> 零散研究（' + loose.length + ' 篇未归链文献）' +
          '</h3>' +
        '</summary>' +
        '<div class="cluster-details-body">' +
          '<div class="cluster-note">' +
            '这些文献隶属于本主题，但由于彼此承接关系不成立或篇数不足以聚合成独立角度，故保留平铺展示，不强制附会演进线索。' +
          '</div>' +
          '<ol class="cluster-thread">' + items + '</ol>' +
        '</div>' +
      '</details>' +
    '</section>'
  );
}
