// ============================================
// 主题洞察详情页
// ============================================

(function () {
  'use strict';

  const root = document.getElementById('detailRoot');

  const RELATION_LABELS = {
    origin: '线索起点',
    continue: '承接',
    shift: '转向'
  };

  const ROLE_LABELS = {
    backbone: '演进主干',
    divergent: '子域成员',
    satellite: '边际卫星',
    frontier: '前沿探针'
  };

  const BASIS_LABELS = {
    matrix_hole: '依据：方法×对象覆盖空缺',
    cross_topic_gap: '依据：邻近主题间的交叉空白',
    adjacent_topic: '依据：邻近主题间的空白',
    staleness: '依据：该方向近期无新增',
    limitation: '依据：文献自陈局限'
  };

  document.addEventListener('DOMContentLoaded', () => {
    const slug = decodeURIComponent(window.location.pathname.replace(/^\/clusters\//, '').split('/')[0] || '');
    if (!slug) {
      renderError('缺少主题标识');
      return;
    }
    load(slug);
  });

  async function load(slug) {
    try {
      const res = await fetch('/api/cluster-topics/' + encodeURIComponent(slug), {
        credentials: 'same-origin'
      });
      if (res.status === 404) {
        renderError('主题不存在或已归档');
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      render(await res.json());
    } catch (err) {
      renderError('加载失败，请稍后重试');
    }
  }

  function render(detail) {
    const articleIndex = buildArticleIndex(detail);
    const parts = [];

    parts.push(renderHeader(detail));
    parts.push(renderStatusNotice(detail));
    parts.push(renderSummary(detail));
    parts.push(renderAngles(detail, articleIndex));
    parts.push(renderMatrix(detail));
    parts.push(renderGaps(detail, articleIndex));
    parts.push(renderConsensus(detail));
    parts.push(renderTrend(detail));
    parts.push(renderAdjacent(detail));
    parts.push(renderCatalog(detail));
    parts.push(renderLoose(detail));

    root.innerHTML = parts.filter(Boolean).join('');
    bindCatalog();
  }

  /* ── 头部 ── */

  function renderHeader(detail) {
    const badges = [];
    if (detail.status === 'NEW') badges.push(['cluster-badge-new', '新主题']);
    if (detail.status === 'DORMANT') badges.push(['cluster-badge-dormant', '已冷却']);
    if (detail.analysis && detail.analysis.trend && detail.analysis.trend.direction === 'up') {
      badges.push(['cluster-badge-rising', '升温']);
    }
    if (detail.analysis && detail.analysis.trend && detail.analysis.trend.direction === 'down') {
      badges.push(['cluster-badge-cooling', '退潮']);
    }

    const keywords = (detail.keywords || [])
      .map((word) => '<span class="cluster-tag">' + escapeHtml(word) + '</span>')
      .join('');

    const range = detail.firstEventDate || detail.lastEventDate
      ? escapeHtml(formatMonth(detail.firstEventDate)) + ' ~ ' + escapeHtml(formatMonth(detail.lastEventDate))
      : '时间范围未知';

    return (
      '<div class="cluster-detail-header">' +
      '<div style="margin-bottom:8px"><a href="/clusters" class="cluster-tag">← 返回主题列表</a></div>' +
      '<h1 class="page-title">' + escapeHtml(detail.name) + '</h1>' +
      '<div class="cluster-card-meta" style="margin-top:8px">' +
      '<span>' + detail.linkedCount + ' 篇（主归属 ' + detail.primaryCount + '）</span>' +
      '<span>' + escapeHtml(range) + '</span>' +
      '<span>主题集合 v' + escapeHtml(String(detail.setVersion)) + '</span>' +
      (badges.length
        ? badges.map(([cls, label]) => '<span class="cluster-badge ' + cls + '">' + escapeHtml(label) + '</span>').join('')
        : '') +
      '</div>' +
      (keywords ? '<div class="cluster-card-meta" style="margin-top:8px">' + keywords + '</div>' : '') +
      '</div>'
    );
  }

  function renderStatusNotice(detail) {
    if (detail.analysisStatus === 'insufficient_data') {
      return (
        '<div class="cluster-note cluster-note-warn">' +
        '该主题样本量不足，仅展示规则聚合结果（对比矩阵）。为避免过度解读，未生成脉络、趋势与空白结论。' +
        '</div>'
      );
    }
    if (detail.analysisStatus === 'partial') {
      return (
        '<div class="cluster-note cluster-note-warn">' +
        '综述与角度已更新，范式/前沿/空白部分待下一轮重试。' +
        (detail.analysisError ? '<br>原因：' + escapeHtml(detail.analysisError) : '') +
        '</div>'
      );
    }
    if (detail.analysisStatus === 'failed') {
      return (
        '<div class="cluster-note cluster-note-warn">' +
        '本主题的多维分析最近一次生成失败，当前展示的是上一次成功结果。系统会在下一轮自动重试。' +
        (detail.analysisError ? '<br>原因：' + escapeHtml(detail.analysisError) : '') +
        '</div>'
      );
    }
    if (detail.analysisStatus === 'missing') {
      return '<div class="cluster-note cluster-note-warn">该主题的多维分析尚未生成，将在下一轮流水线中产出。</div>';
    }
    return '';
  }

  /* ── 概览 / 趋势叙述 / 历史 ── */

  function renderSummary(detail) {
    const analysis = detail.analysis;
    if (!analysis) return '';
    const blocks = [];

    if (analysis.overview) {
      blocks.push('<p style="line-height:1.8">' + escapeHtml(analysis.overview) + '</p>');
    }
    if (analysis.trend && analysis.trend.summary) {
      blocks.push('<p style="line-height:1.8">' + escapeHtml(analysis.trend.summary) + '</p>');
    }
    if (analysis.historySummary) {
      blocks.push(
        '<div class="cluster-note">研究历史概括：' + escapeHtml(analysis.historySummary) + '</div>'
      );
    }
    if (blocks.length === 0) return '';

    return (
      '<section class="cluster-section">' +
      '<h2 class="cluster-section-title">📌 主题概览</h2>' +
      blocks.join('') +
      '</section>'
    );
  }

  /* ── 研究角度与脉络 ── */

  function renderAngles(detail, articleIndex) {
    if (!detail.angles || detail.angles.length === 0) return '';

    const angles = detail.angles
      .map((angle) => {
        const head =
          '<div class="cluster-angle-head">' +
          '<span class="cluster-angle-name">' +
          escapeHtml(angle.angleLabel || '未命名角度') +
          '</span>' +
          (angle.patternType === 'divergent'
            ? '<span class="cluster-tag">发散子域</span>'
            : '<span class="cluster-tag">时序脉络</span>') +
          '<span class="cluster-tag">' + angle.articleCount + ' 篇</span>' +
          (angle.trend ? '<span class="cluster-tag">' + trendLabel(angle.trend) + '</span>' : '') +
          '</div>';

        const narrative = angle.narrative
          ? '<div class="cluster-angle-narrative">' + escapeHtml(angle.narrative) + '</div>'
          : '';

        const allSteps = angle.steps || [];
        const representativeSteps =
          angle.patternType === 'divergent'
            ? allSteps.filter((step) => step.isRepresentative)
            : allSteps;
        const restSteps =
          angle.patternType === 'divergent'
            ? allSteps.filter((step) => !step.isRepresentative)
            : [];
        const steps = representativeSteps.map((step) => renderStep(step)).join('');
        const rest =
          restSteps.length > 0
            ? '<details class="cluster-details">' +
              '<summary>其余 ' + restSteps.length + ' 篇子域成员</summary>' +
              '<ol class="cluster-thread">' +
              restSteps.map((step) => renderStep(step)).join('') +
              '</ol>' +
              '</details>'
            : '';
        const divergentNote =
          angle.patternType === 'divergent'
            ? '<div class="cluster-note">该子域内部未形成连续演进，先列代表作；其余成员可展开查看，均不代表时间上的承接关系。</div>'
            : '';

        return (
          '<div class="cluster-angle">' +
          head +
          narrative +
          divergentNote +
          '<ol class="cluster-thread">' + steps + '</ol>' +
          rest +
          '</div>'
        );
      })
      .join('');

    return (
      '<section class="cluster-section">' +
      '<h2 class="cluster-section-title">🧭 研究角度与研究脉络</h2>' +
      '<div class="cluster-note">' +
      '以下脉络由「切面语义相似度 + 方法/研究对象延续性 + 时间先后」规则推断，<strong>不是引文关系</strong>。' +
      '本系统不含参考文献数据，请据此理解承接关系。' +
      '</div>' +
      angles +
      '</section>'
    );
  }

  function renderStep(step) {
    const relation = step.relation === 'loose' ? 'shift' : step.relation || 'divergent';
    const tags = [];
    if (step.isRepresentative) {
      tags.push('<span class="cluster-tag">子域代表</span>');
    }
    if (ROLE_LABELS[step.academicRole]) {
      tags.push('<span class="cluster-tag">' + ROLE_LABELS[step.academicRole] + '</span>');
    }
    if (RELATION_LABELS[step.relation]) {
      tags.push('<span class="cluster-tag">' + RELATION_LABELS[step.relation] + '</span>');
    }
    if (step.sharedMethod) tags.push('<span class="cluster-tag">方法延续</span>');
    if (step.sharedObject) tags.push('<span class="cluster-tag">对象延续</span>');
    if (step.crossPrecision) tags.push('<span class="cluster-tag">时间精度不同</span>');
    if (typeof step.similarityToPrev === 'number') {
      tags.push('<span class="cluster-tag">与上篇相似度 ' + step.similarityToPrev.toFixed(2) + '</span>');
    }

    const facet = step.facet;
    const facetLine = facet
      ? escapeHtml(facet.research_question) +
        ' ｜ 方法：' + escapeHtml(facet.method) +
        ' ｜ 对象：' + escapeHtml(facet.study_object)
      : '';

    return (
      '<li class="cluster-thread-item" data-relation="' + escapeHtml(relation) + '">' +
      '<a class="cluster-thread-title" href="/articles/' + step.articleId + '" target="_blank" rel="noopener">' +
      escapeHtml(step.title) +
      '</a>' +
      '<div class="cluster-thread-sub">' +
      escapeHtml(formatDate(step.eventDate)) +
      (step.precision === 'year' ? '（年级精度）' : step.precision === 'ingest' ? '（入库时间）' : '') +
      '</div>' +
      (facetLine ? '<div class="cluster-thread-sub">' + facetLine + '</div>' : '') +
      (tags.length ? '<div class="cluster-thread-sub">' + tags.join(' ') + '</div>' : '') +
      '</li>'
    );
  }

  /* ── 对比矩阵 ── */

  /* ── 全量底册 ── */

  const CATALOG_PAGE_SIZE = 30;

  function renderCatalog(detail) {
    const items = detail.allArticles || [];
    if (items.length === 0) return '';

    const rows = items
      .map((item, index) => {
        const role = ROLE_LABELS[item.role] || item.role;
        const pattern = item.patternType === 'divergent' ? '发散' : item.patternType === 'linear' ? '时序' : '未归链';
        return (
          '<li class="cluster-thread-item" data-catalog-item' + (index >= CATALOG_PAGE_SIZE ? ' hidden' : '') + '>' +
          '<a class="cluster-thread-title" href="/articles/' + item.id + '" target="_blank" rel="noopener">' +
          escapeHtml(item.title) +
          '</a>' +
          '<div class="cluster-thread-sub">' +
          (item.year ? item.year + ' · ' : '') +
          escapeHtml(item.method) + ' / ' + escapeHtml(item.object) +
          '</div>' +
          '<div class="cluster-thread-sub">' +
          '<span class="cluster-tag">' + escapeHtml(pattern) + '</span> ' +
          '<span class="cluster-tag">' + escapeHtml(role) + '</span>' +
          (item.isPrimary ? ' <span class="cluster-tag">主归属</span>' : '') +
          '</div>' +
          '</li>'
        );
      })
      .join('');

    return (
      '<section class="cluster-section">' +
      '<details class="cluster-details">' +
      '<summary><h2 class="cluster-section-title" style="display:inline">📚 全量文献底册（' + items.length + ' 篇）</h2></summary>' +
      '<ol class="cluster-thread">' + rows + '</ol>' +
      (items.length > CATALOG_PAGE_SIZE
        ? '<button type="button" class="cluster-catalog-more" data-catalog-more data-total="' + items.length + '">' +
          '显示更多（剩余 ' + (items.length - CATALOG_PAGE_SIZE) + ' 篇）</button>'
        : '') +
      '</details>' +
      '</section>'
    );
  }

  function bindCatalog() {
    const button = root.querySelector('[data-catalog-more]');
    if (!button) return;
    button.addEventListener('click', () => {
      const hidden = root.querySelectorAll('[data-catalog-item][hidden]');
      for (let i = 0; i < hidden.length && i < CATALOG_PAGE_SIZE; i += 1) {
        hidden[i].removeAttribute('hidden');
      }
      const remaining = root.querySelectorAll('[data-catalog-item][hidden]').length;
      if (remaining === 0) button.remove();
      else button.textContent = '显示更多（剩余 ' + remaining + ' 篇）';
    });
  }

  function renderMatrix(detail) {
    const matrix = detail.matrix;
    if (!matrix) return '';
    if ((matrix.methods || []).length === 0 || (matrix.objects || []).length === 0) {
      return (
        '<section class="cluster-section">' +
        '<h2 class="cluster-section-title">📊 方法 × 研究对象 对比矩阵</h2>' +
        '<div class="cluster-note">样本不足，暂无法形成可比较的方法与研究对象分布。</div>' +
        '</section>'
      );
    }

    const cellMap = {};
    (matrix.cells || []).forEach((cell) => {
      cellMap[cell.method + '\u0000' + cell.object] = cell;
    });

    const header =
      '<tr><th>方法 \\ 对象</th>' +
      matrix.objects.map((object) => '<th>' + escapeHtml(object) + '</th>').join('') +
      '</tr>';

    const rows = matrix.methods
      .map((method) => {
        const cells = matrix.objects
          .map((object) => {
            const cell = cellMap[method + '\u0000' + object];
            if (!cell) return '<td class="is-hole" title="空缺">·</td>';
            return '<td class="has-value" title="' + escapeHtml(cell.articleIds.join(', ')) + '">' + cell.count + '</td>';
          })
          .join('');
        return '<tr><th>' + escapeHtml(method) + '</th>' + cells + '</tr>';
      })
      .join('');

    const holes = (matrix.holes || []).length
      ? '<div class="cluster-note">覆盖空缺（该方法与研究对象从未组合，按显著度排序）：' +
        matrix.holes
          .slice(0, 8)
          .map((hole) => escapeHtml(hole.method + ' × ' + hole.object))
          .join('，') +
        '</div>'
      : '';

    return (
      '<section class="cluster-section">' +
      '<h2 class="cluster-section-title">📊 方法 × 研究对象 对比矩阵</h2>' +
      '<div class="cluster-note">纯规则聚合，未使用模型生成。单元格为文献篇数，鼠标悬停可看文章 id。</div>' +
      '<div style="overflow-x:auto"><table class="cluster-matrix">' + header + rows + '</table></div>' +
      holes +
      '</section>'
    );
  }

  /* ── 研究空白 ── */

  function renderGaps(detail, articleIndex) {
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
            '依据 ' + evidenceIds.length + ' 篇</a>'
          : '';

        return (
          '<div class="cluster-gap">' +
          '<div class="cluster-gap-basis">' + escapeHtml(BASIS_LABELS[gap.basis] || gap.basis) +
          (gap.evidenceScope === 'adjacent' ? ' <span class="cluster-tag">跨主题证据</span>' : '') +
          '</div>' +
          '<div>' + escapeHtml(gap.gap) + '</div>' +
          (evidence ? '<div class="cluster-evidence">' + evidence + '</div>' : '') +
          '</div>'
        );
      })
      .join('');

    return (
      '<section class="cluster-section">' +
      '<h2 class="cluster-section-title">🔍 研究空白</h2>' +
      '<div class="cluster-note">' +
      '空白不是模型凭印象提出的，而是从「覆盖矩阵的空格 / 邻近主题差异 / 时效缺口 / 文献自陈局限」推导，' +
      '每条都必须能回链到具体文献。' +
      '</div>' +
      items +
      '</section>'
    );
  }

  function renderConsensus(detail) {
    const analysis = detail.analysis;
    if (!analysis) return '';
    const consensus = analysis.consensus || [];
    const controversies = analysis.controversies || [];
    if (consensus.length === 0 && controversies.length === 0) return '';

    const list = (items) => '<ul class="cluster-list">' + items.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul>';

    return (
      '<section class="cluster-section">' +
      (consensus.length
        ? '<h2 class="cluster-section-title">✅ 共识</h2>' + list(consensus)
        : '') +
      (controversies.length
        ? '<h2 class="cluster-section-title">⚖️ 分歧</h2>' + list(controversies)
        : '') +
      '</section>'
    );
  }

  /* ── 趋势 ── */

  function renderTrend(detail) {
    const metrics = detail.metrics || [];
    if (metrics.length === 0) return '';

    const maxAdded = Math.max.apply(null, metrics.map((row) => row.addedLinkedCount).concat([1]));
    const maxCumulative = Math.max.apply(null, metrics.map((row) => row.cumulativeLinkedCount).concat([1]));
    const width = Math.max(360, metrics.length * 32);
    const height = 150;
    const padX = 10;
    const padTop = 12;
    const padBottom = 8;
    const plotW = width - padX * 2;
    const plotH = height - padTop - padBottom;
    const step = plotW / metrics.length;
    const barW = Math.min(18, Math.max(8, step * 0.55));
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

    const chart =
      '<div class="cluster-chart-wrap">' +
      '<svg class="cluster-chart" viewBox="0 0 ' + width + ' ' + height +
      '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="月度新增与累计趋势">' +
      area + line + bars +
      '<line x1="' + padX + '" y1="' + baseline + '" x2="' + (padX + plotW) +
      '" y2="' + baseline + '" class="cluster-axis" />' +
      '</svg>' +
      '<div class="cluster-chart-labels" style="grid-template-columns:repeat(' + metrics.length + ',1fr)">' +
      metrics.map((row) => '<span>' + escapeHtml(row.period.slice(5)) + '</span>').join('') +
      '</div>' +
      '</div>';

    const rows = metrics
      .map(
        (row) =>
          '<tr>' +
          '<td>' + escapeHtml(row.period) + '</td>' +
          '<td>' + row.addedLinkedCount + '</td>' +
          '<td>' + row.cumulativeLinkedCount + '</td>' +
          '<td>' + (row.avgSimilarity === null ? '—' : row.avgSimilarity.toFixed(3)) + '</td>' +
          '<td>' + (row.centroidDrift === null ? '—' : row.centroidDrift.toFixed(3)) + '</td>' +
          '<td>' + (row.methodEntropy === null ? '—' : row.methodEntropy.toFixed(2)) + '</td>' +
          '</tr>'
      )
      .join('');

    const insufficient = metrics.filter((row) => row.addedLinkedCount > 0).length < 3;

    return (
      '<section class="cluster-section">' +
      '<h2 class="cluster-section-title">📈 月度趋势</h2>' +
      (insufficient
        ? '<div class="cluster-note cluster-note-warn">覆盖月份不足 3 个月，样本不足以判断趋势，仅列出原始指标。</div>'
        : '') +
      chart +
      '<div style="overflow-x:auto"><table class="cluster-matrix">' +
      '<tr><th>月份</th><th>新增</th><th>累计</th><th>平均相似度</th><th>质心漂移（窗口）</th><th>方法熵</th></tr>' +
      rows +
      '</table></div>' +
      '</section>'
    );
  }

  /* ── 邻近主题 / 零散研究 ── */

  function renderAdjacent(detail) {
    const adjacent = detail.adjacent || [];
    if (adjacent.length === 0) return '';
    const items = adjacent
      .map(
        (topic) =>
          '<a class="cluster-tag" href="/clusters/' + encodeURIComponent(topic.slug) + '">' +
          escapeHtml(topic.name) +
          (topic.sharedMethod ? ' · 同方法' : '') +
          (topic.sharedObject ? ' · 同对象' : '') +
          '</a>'
      )
      .join(' ');
    return (
      '<section class="cluster-section">' +
      '<h2 class="cluster-section-title">🔗 邻近主题</h2>' +
      '<div class="cluster-note">与本研究方向共享方法或研究对象、但属于不同主题的方向。</div>' +
      '<div class="cluster-card-meta">' + items + '</div>' +
      '</section>'
    );
  }

  function renderLoose(detail) {
    const loose = detail.looseArticles || [];
    if (loose.length === 0) return '';

    const items = loose
      .map(
        (step) =>
          '<li class="cluster-thread-item" data-relation="shift">' +
          '<a class="cluster-thread-title" href="/articles/' + step.articleId + '" target="_blank" rel="noopener">' +
          escapeHtml(step.title) +
          '</a>' +
          '<div class="cluster-thread-sub">' + escapeHtml(formatDate(step.eventDate)) +
          (step.facet ? ' ｜ ' + escapeHtml(step.facet.study_object) : '') +
          '</div></li>'
      )
      .join('');

    return (
      '<section class="cluster-section">' +
      '<h2 class="cluster-section-title">🗂️ 零散研究（未构成脉络）</h2>' +
      '<div class="cluster-note">这些文献隶属于本主题，但彼此承接关系不成立或篇数不足，故平铺展示而不编造演进线索。</div>' +
      '<ol class="cluster-thread">' + items + '</ol>' +
      '</section>'
    );
  }

  /* ── 工具 ── */

  function buildArticleIndex(detail) {
    const index = {};
    (detail.angles || []).forEach((angle) => {
      (angle.steps || []).forEach((step) => {
        index[step.articleId] = { title: step.title, url: step.url };
      });
    });
    (detail.looseArticles || []).forEach((step) => {
      index[step.articleId] = { title: step.title, url: step.url };
    });
    return index;
  }

  function trendLabel(trend) {
    if (trend === 'up') return '升温';
    if (trend === 'down') return '退潮';
    return '平稳';
  }

  function formatMonth(value) {
    if (!value) return '未知';
    return String(value).slice(0, 7);
  }

  function formatDate(value) {
    if (!value) return '时间未知';
    return String(value).slice(0, 10);
  }

  function renderError(message) {
    root.innerHTML = '<div class="cluster-empty">' + escapeHtml(message) + '</div>';
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
