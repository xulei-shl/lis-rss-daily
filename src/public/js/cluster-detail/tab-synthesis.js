// ============================================
// 主题洞察详情页 - Tab 1: 综述与洞察
// 包含：主题宏观概览、深度综述、主题内洞察、共识与分歧双栏看板
// ============================================

import {
  escapeHtml,
  formatDateTime,
  GAP_STATE_LABELS
} from './utils.js';

export function renderSummary(detail) {
  const analysis = detail.analysis;
  if (!analysis) return '';
  const blocks = [];

  if (analysis.overview) {
    blocks.push('<div class="cluster-hero-overview">' + escapeHtml(analysis.overview) + '</div>');
  }
  if (analysis.trend && analysis.trend.summary) {
    blocks.push(
      '<div class="cluster-hero-trend">' +
        '<span class="cluster-hero-label">演变走向：</span>' +
        escapeHtml(analysis.trend.summary) +
      '</div>'
    );
  }
  if (analysis.historySummary) {
    blocks.push(
      '<div class="cluster-note cluster-history-note">' +
        '<span class="cluster-hero-label">研究历史溯源：</span>' +
        escapeHtml(analysis.historySummary) +
      '</div>'
    );
  }
  if (blocks.length === 0) return '';

  return (
    '<section class="cluster-section cluster-hero-card">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">📌</span> 主题宏观概览</h2>' +
      '</div>' +
      blocks.join('') +
    '</section>'
  );
}

export function renderReviews(detail, articleIndex) {
  const reviews = detail.reviews || [];
  if (reviews.length === 0) return '';

  const items = reviews
    .map((review) => {
      const sections = (review.sections || [])
        .map((section) => {
          const evidence = (section.basisArticleIds || [])
            .slice(0, 8)
            .map((id) => {
              const article = articleIndex[id];
              const title = article ? article.title : '#' + id;
              return (
                '<a class="cluster-evidence-pill" href="/articles/' + id +
                '" target="_blank" rel="noopener" title="' + escapeHtml(title) + '">' +
                  '<span class="evidence-hash">#</span>' + id +
                '</a>'
              );
            })
            .join(' ');

          return (
            '<div class="cluster-review-section"' +
              (section.insufficient ? ' data-insufficient="true"' : '') + '>' +
              '<div class="cluster-review-section-label">' + escapeHtml(section.label) + '</div>' +
              '<div class="cluster-review-section-text">' + escapeHtml(section.text) + '</div>' +
              (evidence ? '<div class="cluster-evidence"><span class="evidence-label">支撑论据：</span>' + evidence + '</div>' : '') +
            '</div>'
          );
        })
        .join('');

      return (
        '<article class="cluster-review-card">' +
          '<div class="cluster-review-head">' +
            '<div class="cluster-review-meta">' +
              '<span class="cluster-tag cluster-tag-accent">' + review.memberCount + ' 篇文献</span>' +
              '<span class="cluster-tag">v' + review.version + '</span>' +
              '<span class="cluster-meta-time">更新于 ' + escapeHtml(formatDateTime(review.updatedAt)) + '</span>' +
            '</div>' +
            '<h3 class="cluster-review-title">' + escapeHtml(review.title) + '</h3>' +
          '</div>' +
          (review.abstract
            ? '<p class="cluster-review-abstract">' + escapeHtml(review.abstract) + '</p>'
            : '') +
          sections +
        '</article>'
      );
    })
    .join('');

  return (
    '<section class="cluster-section">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">📚</span> 深度综述 (' + reviews.length + ')</h2>' +
      '</div>' +
      '<div class="cluster-note">' +
        '每篇综述对应主题内部由高维向量聚类产出的语义子群；引用编号（#id）均可直连回溯文献。' +
        '综述由每周流水线增量维护，成员变动幅度在安全阈值内时持续在同一篇上增订续写。' +
      '</div>' +
      '<div class="cluster-reviews-container">' + items + '</div>' +
    '</section>'
  );
}

export function renderInsights(detail) {
  const insights = detail.insights || [];
  if (insights.length === 0) return '';

  const items = insights
    .map((report) => {
      const topics = (report.topics || [])
        .map(
          (topic) =>
            '<a class="cluster-tag" href="/clusters/' + encodeURIComponent(topic.slug) + '">' +
            escapeHtml(topic.name) + '</a>'
        )
        .join(' ');

      const list = (entries) =>
        (entries || []).length
          ? '<ul class="cluster-list cluster-insight-list">' +
            entries.map((entry) => '<li>' + escapeHtml(entry.text) + '</li>').join('') +
            '</ul>'
          : '';

      const gaps = (report.gapMaturity || []).length
        ? '<div class="cluster-review-section-label">研究空白成熟度评估</div>' +
          report.gapMaturity
            .map(
              (item) =>
                '<div class="cluster-gap cluster-gap-mini">' +
                  '<div class="cluster-gap-basis">' +
                    '<span class="gap-state-tag gap-state-' + item.state + '">' +
                      escapeHtml(GAP_STATE_LABELS[item.state] || item.state) +
                    '</span>' +
                  '</div>' +
                  '<div class="cluster-gap-content">' + escapeHtml(item.gap || '') + '</div>' +
                  '<div class="cluster-thread-sub">' + escapeHtml(item.reason || '') + '</div>' +
                '</div>'
            )
            .join('')
        : '';

      return (
        '<article class="cluster-insight-card">' +
          '<h3 class="cluster-insight-title">' + escapeHtml(report.title) + '</h3>' +
          (report.thesis
            ? '<blockquote class="cluster-insight-thesis">' + escapeHtml(report.thesis) + '</blockquote>'
            : '') +
          (topics ? '<div class="cluster-card-meta cluster-insight-topics">' + topics + '</div>' : '') +
          ((report.convergences || []).length
            ? '<div class="cluster-review-section-label">子簇间收敛趋势</div>' + list(report.convergences)
            : '') +
          ((report.tensions || []).length
            ? '<div class="cluster-review-section-label">张力与适用边界差异</div>' + list(report.tensions)
            : '') +
          gaps +
          ((report.agenda || []).length
            ? '<div class="cluster-review-section-label">未来研究议程建议</div>' + list(report.agenda)
            : '') +
        '</article>'
      );
    })
    .join('');

  return (
    '<section class="cluster-section">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">💡</span> 主题内宏观洞察 (' + insights.length + ')</h2>' +
        '<a href="/clusters/insights" class="cluster-link-more" target="_blank" rel="noopener">查看全库洞察报告 →</a>' +
      '</div>' +
      '<div class="cluster-note">' +
        '将本主题内部的多个综述子簇与研究空白做二次聚类分析，挖掘不同学术子群之间的收敛共识、争鸣张力与空白成熟演进。' +
      '</div>' +
      '<div class="cluster-insights-container">' + items + '</div>' +
    '</section>'
  );
}

export function renderConsensusDualView(detail) {
  const analysis = detail.analysis;
  if (!analysis) return '';
  const consensus = analysis.consensus || [];
  const controversies = analysis.controversies || [];
  if (consensus.length === 0 && controversies.length === 0) return '';

  const renderItems = (items, emptyText) => {
    if (!items || items.length === 0) {
      return '<div class="cluster-empty-inline">' + escapeHtml(emptyText) + '</div>';
    }
    return (
      '<ul class="cluster-dual-list">' +
        items.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') +
      '</ul>'
    );
  };

  return (
    '<section class="cluster-section">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">⚖️</span> 学术共识与学术分歧</h2>' +
      '</div>' +
      '<div class="cluster-consensus-grid">' +
        '<div class="consensus-card is-agreed">' +
          '<div class="consensus-card-header">' +
            '<span class="consensus-icon" aria-hidden="true">✅</span>' +
            '<h3 class="consensus-card-title">学术界现有共识</h3>' +
            '<span class="consensus-count-pill">' + consensus.length + ' 项</span>' +
          '</div>' +
          renderItems(consensus, '暂无明确收敛的学术共识') +
        '</div>' +
        '<div class="consensus-card is-controversial">' +
          '<div class="consensus-card-header">' +
            '<span class="consensus-icon" aria-hidden="true">⚡</span>' +
            '<h3 class="consensus-card-title">主要分歧与条件张力</h3>' +
            '<span class="consensus-count-pill">' + controversies.length + ' 项</span>' +
          '</div>' +
          renderItems(controversies, '暂未探测到显著的条件性争论') +
        '</div>' +
      '</div>' +
    '</section>'
  );
}
