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
          '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">🧭</span> 研究角度与研究脉络</h2>' +
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
          '<span class="cluster-tag">' + angle.articleCount + ' 篇文献</span>' +
          (!isDivergent && backboneCount < allSteps.length
            ? '<span class="cluster-tag">连续段 ' + backboneCount + ' 篇</span>'
            : '') +
          (angle.trend ? '<span class="cluster-tag">' + trendLabel(angle.trend) + '</span>' : '') +
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
        ? '<details class="cluster-details cluster-divergent-details">' +
            '<summary class="cluster-details-summary">展开其余 ' + restSteps.length + ' 篇子域成员</summary>' +
            '<ol class="cluster-thread">' +
              restSteps.map((step) => renderStep(step)).join('') +
            '</ol>' +
          '</details>'
        : '';

      const divergentNote = isDivergent
        ? '<div class="cluster-note cluster-divergent-note">该子域暂未识别出连续承接段（至少 3 篇），以下先呈现质心相近的代表文献；其余成员可展开查看，均不代表时间上的承接关系。</div>'
        : backboneCount < allSteps.length
          ? '<div class="cluster-note">其中 ' + backboneCount + ' 篇构成连续承接段，其余 ' + (allSteps.length - backboneCount) + ' 篇为同一子域内的背景/旁支文献。</div>'
          : '';

      return (
        '<div class="cluster-angle-card">' +
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
        '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">🧭</span> 研究角度与研究脉络 (' + detail.angles.length + ')</h2>' +
      '</div>' +
      '<div class="cluster-note">' +
        '先按主题内语义子域分组，再在同一子域内按「切面语义相似度 + 方法/研究对象延续性 + 时间先后」自动推断连续承接段，<strong>不是引文直接继承关系</strong>。' +
        '子域内找不到 3 篇以上的连续承接段时，才标记为并列子域。' +
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
