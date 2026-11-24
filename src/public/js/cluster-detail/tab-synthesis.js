// ============================================
// 主题洞察详情页 - Tab 1: 综述与洞察
// 包含：主题宏观导读、子群深度综述、主题内综合研判、共识与分歧双栏看板
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
    blocks.push('<div class="cluster-overview-prose">' + escapeHtml(analysis.overview) + '</div>');
  }
  if (analysis.trend && analysis.trend.summary) {
    blocks.push(
      '<div class="cluster-editorial-callout">' +
        '<div class="callout-head">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>' +
          '<span class="callout-label">演变动向研判</span>' +
        '</div>' +
        '<div class="callout-text">' + escapeHtml(analysis.trend.summary) + '</div>' +
      '</div>'
    );
  }
  if (analysis.historySummary) {
    blocks.push(
      '<div class="cluster-history-prose">' +
        '<span class="cluster-history-label">溯源考证：</span>' +
        escapeHtml(analysis.historySummary) +
      '</div>'
    );
  }
  if (blocks.length === 0) return '';

  return (
    '<section class="cluster-section cluster-summary-dossier">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title">' +
          '<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' +
          '<span>主题综述导读</span>' +
        '</h2>' +
      '</div>' +
      '<div class="cluster-summary-body">' + blocks.join('') + '</div>' +
    '</section>'
  );
}

export function renderReviews(detail, articleIndex) {
  const reviews = detail.reviews || [];
  if (reviews.length === 0) return '';

  const items = reviews
    .map((review, idx) => {
      const sectionsList = review.sections || [];
      const sections = sectionsList
        .map((section) => {
          const evidence = (section.basisArticleIds || [])
            .slice(0, 8)
            .map((id) => {
              const article = articleIndex[id];
              const title = article ? article.title : '#' + id;
              return (
                '<a class="cluster-cite-pill" href="/articles/' + id +
                '" target="_blank" rel="noopener" title="' + escapeHtml(title) + '">' +
                  '<span class="cite-hash">#</span>' + id +
                '</a>'
              );
            })
            .join(' ');

          return (
            '<div class="cluster-review-section"' +
              (section.insufficient ? ' data-insufficient="true"' : '') + '>' +
              '<div class="cluster-review-section-label">' + escapeHtml(section.label) + '</div>' +
              '<div class="cluster-review-section-text">' + escapeHtml(section.text) + '</div>' +
              (evidence ? '<div class="cluster-evidence"><span class="evidence-label">证据文献：</span>' + evidence + '</div>' : '') +
            '</div>'
          );
        })
        .join('');

      const uniqueArticleIds = new Set();
      sectionsList.forEach((s) => {
        (s.basisArticleIds || []).forEach((id) => uniqueArticleIds.add(id));
      });
      const evidenceCount = uniqueArticleIds.size;
      const isOpen = idx === 0;

      const detailsHtml = sectionsList.length > 0
        ? '<details class="cluster-accordion cluster-review-details"' + (isOpen ? ' open' : '') + '>' +
            '<summary class="cluster-accordion-summary">' +
              '<span class="cluster-accordion-summary-main">' +
                '<svg class="accordion-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>' +
                '<span class="accordion-title">论证章节与引用依据</span>' +
                '<span class="cluster-tag cluster-tag-subtle">' + sectionsList.length + ' 节</span>' +
                (evidenceCount > 0 ? '<span class="cluster-tag cluster-tag-subtle">' + evidenceCount + ' 篇引用</span>' : '') +
              '</span>' +
              '<span class="cluster-accordion-hint">' +
                '<span class="hint-collapsed">展开论据 ↓</span>' +
                '<span class="hint-expanded">收起论据 ↑</span>' +
              '</span>' +
            '</summary>' +
            '<div class="cluster-accordion-body">' +
              sections +
            '</div>' +
          '</details>'
        : '';

      return (
        '<article class="cluster-review-entry" id="cluster-review-' + (idx + 1) + '">' +
          '<div class="cluster-review-head">' +
            '<div class="cluster-review-meta">' +
              '<span class="cluster-tag cluster-tag-accent">' + review.memberCount + ' 篇文献支撑</span>' +
              '<span class="cluster-tag cluster-tag-subtle">子群综述 v' + review.version + '</span>' +
              '<span class="cluster-meta-time">更新于 ' + escapeHtml(formatDateTime(review.updatedAt)) + '</span>' +
            '</div>' +
            '<h3 class="cluster-review-title">' + escapeHtml(review.title) + '</h3>' +
          '</div>' +
          (review.abstract
            ? '<div class="cluster-review-abstract">' + escapeHtml(review.abstract) + '</div>'
            : '') +
          detailsHtml +
        '</article>'
      );
    })
    .join('');

  return (
    '<section class="cluster-section" id="clusterReviewsSection">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title">' +
          '<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>' +
          '<span>子群深度综述 (' + reviews.length + ')</span>' +
        '</h2>' +
        (reviews.length > 1
          ? '<button type="button" class="cluster-btn-subtle" id="clusterReviewsToggleAll" aria-expanded="false">' +
              '全部展开' +
            '</button>'
          : '') +
      '</div>' +
      '<div class="cluster-reviews-container">' + items + '</div>' +
    '</section>'
  );
}

export function bindSynthesisEvents(root) {
  // 1. 深度综述批量展开/收起
  const reviewToggleBtn = root.querySelector('#clusterReviewsToggleAll');
  if (reviewToggleBtn) {
    const getReviewList = () => Array.from(root.querySelectorAll('.cluster-review-details'));

    const updateReviewBtnText = () => {
      const list = getReviewList();
      if (list.length === 0) return;
      const allOpen = list.every((d) => d.open);
      reviewToggleBtn.textContent = allOpen ? '全部收起' : '全部展开';
      reviewToggleBtn.setAttribute('aria-expanded', allOpen ? 'true' : 'false');
    };

    reviewToggleBtn.addEventListener('click', () => {
      const list = getReviewList();
      if (list.length === 0) return;
      const allOpen = list.every((d) => d.open);
      list.forEach((d) => {
        d.open = !allOpen;
      });
      updateReviewBtnText();
    });

    root.addEventListener(
      'toggle',
      (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('cluster-review-details')) {
          updateReviewBtnText();
        }
      },
      true
    );
  }

  // 2. 主题洞察批量展开/收起
  const insightToggleBtn = root.querySelector('#clusterInsightsToggleAll');
  if (insightToggleBtn) {
    const getInsightList = () => Array.from(root.querySelectorAll('.cluster-insight-details'));

    const updateInsightBtnText = () => {
      const list = getInsightList();
      if (list.length === 0) return;
      const allOpen = list.every((d) => d.open);
      insightToggleBtn.textContent = allOpen ? '全部收起' : '全部展开';
      insightToggleBtn.setAttribute('aria-expanded', allOpen ? 'true' : 'false');
    };

    insightToggleBtn.addEventListener('click', () => {
      const list = getInsightList();
      if (list.length === 0) return;
      const allOpen = list.every((d) => d.open);
      list.forEach((d) => {
        d.open = !allOpen;
      });
      updateInsightBtnText();
    });

    root.addEventListener(
      'toggle',
      (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('cluster-insight-details')) {
          updateInsightBtnText();
        }
      },
      true
    );
  }
}

export function renderInsights(detail) {
  const insights = detail.insights || [];
  if (insights.length === 0) return '';

  const items = insights
    .map((report, idx) => {
      const topics = (report.topics || [])
        .map(
          (topic) =>
            '<a class="cluster-tag" href="/clusters/' + encodeURIComponent(topic.slug) + '">' +
            escapeHtml(topic.name) + '</a>'
        )
        .join(' ');

      const list = (entries) =>
        (entries || []).length
          ? '<ul class="cluster-clean-list">' +
            entries.map((entry) => {
              const refs = []
                .concat((entry.reviewIds || []).map((id) => '综述 #' + id))
                .concat((entry.gapIds || []).map((id) => '空白 #' + id))
                .map((label) => '<span class="cluster-tag cluster-tag-subtle">' + escapeHtml(label) + '</span>')
                .join(' ');
              return (
                '<li class="cluster-clean-item">' +
                  '<div class="item-text">' + escapeHtml(entry.text) + '</div>' +
                  (refs ? '<div class="item-refs">' + refs + '</div>' : '') +
                '</li>'
              );
            }).join('') +
            '</ul>'
          : '';

      const subBlocks = [];

      if ((report.convergences || []).length) {
        subBlocks.push(
          '<div class="cluster-insight-subgroup">' +
            '<div class="cluster-insight-subgroup-title">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>' +
              '<span>子群间收敛趋势 (' + report.convergences.length + ')</span>' +
            '</div>' +
            list(report.convergences) +
          '</div>'
        );
      }

      if ((report.tensions || []).length) {
        subBlocks.push(
          '<div class="cluster-insight-subgroup">' +
            '<div class="cluster-insight-subgroup-title">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1"/><path d="M18 8h4a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-4"/></svg>' +
              '<span>学术张力与适用边界差异 (' + report.tensions.length + ')</span>' +
            '</div>' +
            list(report.tensions) +
          '</div>'
        );
      }

      if ((report.gapMaturity || []).length) {
        subBlocks.push(
          '<div class="cluster-insight-subgroup">' +
            '<div class="cluster-insight-subgroup-title">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
              '<span>研究空白成熟度演进 (' + report.gapMaturity.length + ')</span>' +
            '</div>' +
            '<div class="cluster-gap-rows">' +
              report.gapMaturity
                .map(
                  (item) =>
                    '<div class="cluster-gap-row">' +
                      '<div class="gap-row-head">' +
                        '<span class="gap-state-tag gap-state-' + escapeHtml(item.state || 'unaddressed') + '">' +
                          escapeHtml(GAP_STATE_LABELS[item.state] || item.state) +
                        '</span>' +
                        (item.gapId ? '<span class="cluster-tag cluster-tag-subtle">空白 #' + escapeHtml(item.gapId) + '</span>' : '') +
                        '<span class="gap-row-title">' + escapeHtml(item.gap || '') + '</span>' +
                      '</div>' +
                      (item.reason ? '<div class="gap-row-reason">' + escapeHtml(item.reason) + '</div>' : '') +
                    '</div>'
                )
                .join('') +
            '</div>' +
          '</div>'
        );
      }

      if ((report.agenda || []).length) {
        subBlocks.push(
          '<div class="cluster-insight-subgroup">' +
            '<div class="cluster-insight-subgroup-title">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>' +
              '<span>未来研究议程建议 (' + report.agenda.length + ')</span>' +
            '</div>' +
            list(report.agenda) +
          '</div>'
        );
      }

      const isOpen = idx === 0;

      const detailsHtml = subBlocks.length > 0
        ? '<details class="cluster-accordion cluster-insight-details"' + (isOpen ? ' open' : '') + '>' +
            '<summary class="cluster-accordion-summary">' +
              '<span class="cluster-accordion-summary-main">' +
                '<svg class="accordion-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
                '<span class="accordion-title">研判细分论述与空白成熟度</span>' +
                '<span class="cluster-tag cluster-tag-subtle">' + subBlocks.length + ' 个研判维度</span>' +
              '</span>' +
              '<span class="cluster-accordion-hint">' +
                '<span class="hint-collapsed">展开研判细节 ↓</span>' +
                '<span class="hint-expanded">收起研判细节 ↑</span>' +
              '</span>' +
            '</summary>' +
            '<div class="cluster-accordion-body">' +
              subBlocks.join('') +
            '</div>' +
          '</details>'
        : '';

      return (
        '<article class="cluster-insight-entry" id="cluster-insight-' + (idx + 1) + '">' +
          '<div class="cluster-insight-head">' +
            (report.version
              ? '<div class="cluster-review-meta"><span class="cluster-tag cluster-tag-accent">洞察研判报告 v' + report.version + '</span></div>'
              : '') +
            '<h3 class="cluster-insight-title">' + escapeHtml(report.title) + '</h3>' +
          '</div>' +
          (report.thesis
            ? '<div class="cluster-thesis-box">' + escapeHtml(report.thesis) + '</div>'
            : '') +
          (topics ? '<div class="cluster-insight-topics">' + topics + '</div>' : '') +
          detailsHtml +
        '</article>'
      );
    })
    .join('');

  return (
    '<section class="cluster-section" id="clusterInsightsSection">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title">' +
          '<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>' +
          '<span>主题多维研判 (' + insights.length + ')</span>' +
        '</h2>' +
        (insights.length > 1
          ? '<button type="button" class="cluster-btn-subtle" id="clusterInsightsToggleAll" aria-expanded="false">' +
              '全部展开' +
            '</button>'
          : '') +
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
      '<ul class="cluster-ledger-list">' +
        items.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') +
      '</ul>'
    );
  };

  return (
    '<section class="cluster-section">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title">' +
          '<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>' +
          '<span>学术共识与边界分歧</span>' +
        '</h2>' +
      '</div>' +
      '<div class="cluster-consensus-grid">' +
        '<div class="consensus-panel is-agreed">' +
          '<div class="consensus-panel-header">' +
            '<svg class="consensus-icon icon-agreed" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>' +
            '<h3 class="consensus-panel-title">现有学术共识</h3>' +
            '<span class="consensus-count-pill tabular-num">' + consensus.length + '</span>' +
          '</div>' +
          renderItems(consensus, '暂无明确收敛的学术共识') +
        '</div>' +
        '<div class="consensus-panel is-controversial">' +
          '<div class="consensus-panel-header">' +
            '<svg class="consensus-icon icon-controversial" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
            '<h3 class="consensus-panel-title">主要分歧与条件张力</h3>' +
            '<span class="consensus-count-pill tabular-num">' + controversies.length + '</span>' +
          '</div>' +
          renderItems(controversies, '暂未探测到显著的条件性争论') +
        '</div>' +
      '</div>' +
    '</section>'
  );
}
