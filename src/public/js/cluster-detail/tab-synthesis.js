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

      // 统计引用的独立文献数量
      const uniqueArticleIds = new Set();
      sectionsList.forEach((s) => {
        (s.basisArticleIds || []).forEach((id) => uniqueArticleIds.add(id));
      });
      const evidenceCount = uniqueArticleIds.size;

      // 首篇默认展开提供视觉线索与范例，其余默认收起以避免海量内容霸屏；仅 1 篇时亦默认展开
      const isOpen = idx === 0;

      const detailsHtml = sectionsList.length > 0
        ? '<details class="cluster-details cluster-review-details"' + (isOpen ? ' open' : '') + '>' +
            '<summary class="cluster-details-summary cluster-review-summary">' +
              '<span class="cluster-review-summary-main">' +
                '<span class="cluster-review-summary-icon" aria-hidden="true">📖</span>' +
                '<span class="cluster-review-summary-title">详细论证与支撑论据</span>' +
                '<span class="cluster-tag cluster-tag-neutral">' + sectionsList.length + ' 节</span>' +
                (evidenceCount > 0 ? '<span class="cluster-tag cluster-tag-neutral">' + evidenceCount + ' 篇引用</span>' : '') +
              '</span>' +
              '<span class="cluster-review-summary-hint">' +
                '<span class="hint-collapsed">展开章节 ↓</span>' +
                '<span class="hint-expanded">收起章节 ↑</span>' +
              '</span>' +
            '</summary>' +
            '<div class="cluster-details-body cluster-review-body">' +
              sections +
            '</div>' +
          '</details>'
        : '';

      return (
        '<article class="cluster-review-card" id="cluster-review-' + (idx + 1) + '">' +
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
          detailsHtml +
        '</article>'
      );
    })
    .join('');

  return (
    '<section class="cluster-section" id="clusterReviewsSection">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">📚</span> 深度综述 (' + reviews.length + ')</h2>' +
        (reviews.length > 1
          ? '<button type="button" class="cluster-btn-subtle" id="clusterReviewsToggleAll" aria-expanded="false">' +
              '全部展开' +
            '</button>'
          : '') +
      '</div>' +
      '<div class="cluster-note">' +
        '每篇综述对应主题内部由高维向量聚类产出的语义子群；引用编号（#id）均可直连回溯文献。' +
        '综述由每周流水线增量维护，成员变动幅度在安全阈值内时持续在同一篇上增订续写。' +
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
          ? '<ul class="cluster-list cluster-insight-list">' +
            entries.map((entry) => {
              const refs = []
                .concat((entry.reviewIds || []).map((id) => '综述 #' + id))
                .concat((entry.gapIds || []).map((id) => '空白 #' + id))
                .map((label) => '<span class="cluster-tag cluster-tag-neutral">' + escapeHtml(label) + '</span>')
                .join(' ');
              return (
                '<li class="cluster-insight-list-item">' +
                  '<div class="cluster-insight-list-text">' + escapeHtml(entry.text) + '</div>' +
                  (refs ? '<div class="cluster-insight-refs">' + refs + '</div>' : '') +
                '</li>'
              );
            }).join('') +
            '</ul>'
          : '';

      const subBlocks = [];

      if ((report.convergences || []).length) {
        subBlocks.push(
          '<div class="cluster-insight-subgroup">' +
            '<div class="cluster-insight-section-label"><span class="subgroup-icon" aria-hidden="true">🤝</span> 子簇间收敛趋势 (' + report.convergences.length + ')</div>' +
            list(report.convergences) +
          '</div>'
        );
      }

      if ((report.tensions || []).length) {
        subBlocks.push(
          '<div class="cluster-insight-subgroup">' +
            '<div class="cluster-insight-section-label"><span class="subgroup-icon" aria-hidden="true">⚖️</span> 张力与适用边界差异 (' + report.tensions.length + ')</div>' +
            list(report.tensions) +
          '</div>'
        );
      }

      if ((report.gapMaturity || []).length) {
        subBlocks.push(
          '<div class="cluster-insight-subgroup">' +
            '<div class="cluster-insight-section-label"><span class="subgroup-icon" aria-hidden="true">🕳️</span> 研究空白成熟度评估 (' + report.gapMaturity.length + ')</div>' +
            '<div class="cluster-gaps-mini-list">' +
              report.gapMaturity
                .map(
                  (item) =>
                    '<div class="cluster-gap-mini">' +
                      '<div class="cluster-gap-mini-head">' +
                        '<span class="gap-state-tag gap-state-' + escapeHtml(item.state || 'unaddressed') + '">' +
                          escapeHtml(GAP_STATE_LABELS[item.state] || item.state) +
                        '</span>' +
                        (item.gapId ? '<span class="cluster-tag cluster-tag-neutral">空白 #' + escapeHtml(item.gapId) + '</span>' : '') +
                      '</div>' +
                      '<div class="cluster-gap-mini-content">' + escapeHtml(item.gap || '') + '</div>' +
                      (item.reason ? '<div class="cluster-gap-mini-reason">' + escapeHtml(item.reason) + '</div>' : '') +
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
            '<div class="cluster-insight-section-label"><span class="subgroup-icon" aria-hidden="true">🧭</span> 未来研究议程建议 (' + report.agenda.length + ')</div>' +
            list(report.agenda) +
          '</div>'
        );
      }

      // 与综述一致：首篇默认展开，其余折叠；仅 1 篇时亦默认展开
      const isOpen = idx === 0;

      const detailsHtml = subBlocks.length > 0
        ? '<details class="cluster-details cluster-review-details cluster-insight-details"' + (isOpen ? ' open' : '') + '>' +
            '<summary class="cluster-details-summary cluster-review-summary">' +
              '<span class="cluster-review-summary-main">' +
                '<span class="cluster-review-summary-icon" aria-hidden="true">🔍</span>' +
                '<span class="cluster-review-summary-title">展开洞察细分论述与空白评估</span>' +
                '<span class="cluster-tag cluster-tag-neutral">' + subBlocks.length + ' 个研判维度</span>' +
              '</span>' +
              '<span class="cluster-review-summary-hint">' +
                '<span class="hint-collapsed">展开细节 ↓</span>' +
                '<span class="hint-expanded">收起细节 ↑</span>' +
              '</span>' +
            '</summary>' +
            '<div class="cluster-details-body cluster-insight-body">' +
              subBlocks.join('') +
            '</div>' +
          '</details>'
        : '';

      return (
        '<article class="cluster-insight-card" id="cluster-insight-' + (idx + 1) + '">' +
          '<div class="cluster-insight-head">' +
            (report.version
              ? '<div class="cluster-card-meta"><span class="cluster-tag cluster-tag-accent">洞察报告 v' + report.version + '</span></div>'
              : '') +
            '<h3 class="cluster-insight-title">' + escapeHtml(report.title) + '</h3>' +
          '</div>' +
          (report.thesis
            ? '<blockquote class="cluster-insight-thesis">' + escapeHtml(report.thesis) + '</blockquote>'
            : '') +
          (topics ? '<div class="cluster-card-meta cluster-insight-topics">' + topics + '</div>' : '') +
          detailsHtml +
        '</article>'
      );
    })
    .join('');

  return (
    '<section class="cluster-section" id="clusterInsightsSection">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">💡</span> 主题洞察 (' + insights.length + ')</h2>' +
        (insights.length > 1
          ? '<button type="button" class="cluster-btn-subtle" id="clusterInsightsToggleAll" aria-expanded="false">' +
              '全部展开' +
            '</button>'
          : '') +
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
