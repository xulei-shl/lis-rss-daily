// ============================================
// 主题洞察详情页 - Tab 5: 全量聚类文献
// 包含：按语义子域分组的全量底册、即时搜索、学术角色/子域筛选、渐进分页
// ============================================

import {
  escapeHtml,
  ROLE_LABELS
} from './utils.js';

const CATALOG_PAGE_SIZE = 30;
const UNASSIGNED_ANGLE = '__unassigned';

export function renderCatalog(detail) {
  const items = detail.allArticles || [];
  if (items.length === 0) {
    return (
      '<section class="cluster-section">' +
        '<div class="cluster-section-header">' +
          '<h2 class="cluster-section-title"><span class="section-icon" aria-hidden="true">📑</span> 全量聚类文献 (0)</h2>' +
        '</div>' +
        '<div class="cluster-empty-inline">该主题暂无归属文献。</div>' +
      '</section>'
    );
  }

  // 角色统计（跨子域的第二维筛选）
  const roleCounts = { all: items.length };
  items.forEach((item) => {
    const roleKey = item.role || 'other';
    roleCounts[roleKey] = (roleCounts[roleKey] || 0) + 1;
  });

  // 子域统计：以角度划分为准，未入链的文献单独归组
  const angles = detail.angles || [];
  const angleCounts = new Map();
  let unassignedCount = 0;
  items.forEach((item) => {
    if (!item.angleKey) {
      unassignedCount += 1;
      return;
    }
    angleCounts.set(item.angleKey, (angleCounts.get(item.angleKey) || 0) + 1);
  });

  const angleOptions = angles
    .map((angle) => {
      const count = angleCounts.get(angle.angleKey) || 0;
      if (count === 0) return '';
      const label = angle.angleLabel || '未命名子域';
      return (
        '<option value="' + escapeHtml(angle.angleKey) + '">' +
          escapeHtml(label) + '（' + count + ' 篇）' +
        '</option>'
      );
    })
    .join('') +
    (unassignedCount > 0
      ? '<option value="' + UNASSIGNED_ANGLE + '">未归入子域（' + unassignedCount + ' 篇）</option>'
      : '');

  return (
    '<section class="cluster-section cluster-catalog-section" id="catalogSection">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title">' +
          '<span class="section-icon" aria-hidden="true">📑</span> 全量聚类文献' +
          '<span class="cluster-count-badge" id="catalogTotalBadge">' + items.length + ' 篇</span>' +
        '</h2>' +
      '</div>' +
      '<div class="cluster-note">' +
        '按主题内语义子域分组展示；每篇文献都标注所属子域，便于和「演进脉络」中的角度对照。支持本地即时检索，以及按学术角色或子域过滤。' +
      '</div>' +
      '<div class="cluster-catalog-toolbar">' +
        '<div class="cluster-catalog-search-wrap">' +
          '<svg class="catalog-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
            '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' +
          '</svg>' +
          '<input type="text" id="catalogSearchInput" class="cluster-catalog-input" placeholder="在底册中快速搜索文献标题、方法、研究对象或子域..." aria-label="搜索聚类文献">' +
        '</div>' +
        '<div class="cluster-catalog-subfilters">' +
          '<label class="cluster-catalog-filter-label" for="catalogAngleFilter">子域</label>' +
          '<select id="catalogAngleFilter" class="cluster-catalog-select" aria-label="按语义子域筛选">' +
            '<option value="all">全部子域（' + items.length + '）</option>' +
            angleOptions +
          '</select>' +
        '</div>' +
        '<div class="cluster-catalog-filters" id="catalogRoleFilters" role="radiogroup" aria-label="按学术角色筛选">' +
          '<button type="button" class="catalog-filter-btn active" data-role="all" aria-pressed="true">全部 <span class="filter-count">(' + items.length + ')</span></button>' +
          (roleCounts.backbone ? '<button type="button" class="catalog-filter-btn" data-role="backbone" aria-pressed="false">演进主干 <span class="filter-count">(' + roleCounts.backbone + ')</span></button>' : '') +
          (roleCounts.divergent ? '<button type="button" class="catalog-filter-btn" data-role="divergent" aria-pressed="false">子域一般成员 <span class="filter-count">(' + roleCounts.divergent + ')</span></button>' : '') +
          (roleCounts.satellite ? '<button type="button" class="catalog-filter-btn" data-role="satellite" aria-pressed="false">边际卫星 <span class="filter-count">(' + roleCounts.satellite + ')</span></button>' : '') +
          (roleCounts.frontier ? '<button type="button" class="catalog-filter-btn" data-role="frontier" aria-pressed="false">前沿探针 <span class="filter-count">(' + roleCounts.frontier + ')</span></button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="cluster-catalog-results-info" id="catalogResultsInfo">显示共 ' + items.length + ' 篇文献</div>' +
      '<ol class="cluster-catalog-list" id="catalogList"></ol>' +
      '<div class="cluster-catalog-footer" id="catalogFooter">' +
        '<button type="button" class="cluster-catalog-more" id="catalogMoreBtn">' +
          '加载更多文献' +
        '</button>' +
      '</div>' +
    '</section>'
  );
}

export function bindCatalogEvents(root, detail) {
  const allItems = detail.allArticles || [];
  const searchInput = root.querySelector('#catalogSearchInput');
  const angleSelect = root.querySelector('#catalogAngleFilter');
  const roleFilters = root.querySelector('#catalogRoleFilters');
  const catalogList = root.querySelector('#catalogList');
  const catalogMoreBtn = root.querySelector('#catalogMoreBtn');
  const catalogFooter = root.querySelector('#catalogFooter');
  const resultsInfo = root.querySelector('#catalogResultsInfo');

  if (!catalogList) return;

  const angleMeta = new Map(
    (detail.angles || []).map((angle, index) => [
      angle.angleKey,
      { ...angle, order: index }
    ])
  );

  let currentSearch = '';
  let currentRole = 'all';
  let currentAngle = 'all';
  let displayedCount = 0;
  let filteredItems = allItems;
  let lastGroupKey = null;

  function groupKeyOf(item) {
    return item.angleKey || UNASSIGNED_ANGLE;
  }

  function groupLabelOf(item) {
    return item.angleLabel || '未归入子域';
  }

  function groupOrderOf(item) {
    return angleMeta.get(item.angleKey)?.order ?? 9999;
  }

  function filterData() {
    const query = currentSearch.trim().toLowerCase();
    filteredItems = allItems.filter((item) => {
      // 角色筛选
      if (currentRole !== 'all' && item.role !== currentRole) {
        return false;
      }
      // 子域筛选
      if (currentAngle !== 'all' && groupKeyOf(item) !== currentAngle) {
        return false;
      }
      // 搜索筛选
      if (query) {
        const titleMatch = (item.title || '').toLowerCase().includes(query);
        const methodMatch = (item.method || '').toLowerCase().includes(query);
        const objectMatch = (item.object || '').toLowerCase().includes(query);
        const angleMatch = (item.angleLabel || '').toLowerCase().includes(query);
        if (!titleMatch && !methodMatch && !objectMatch && !angleMatch) return false;
      }
      return true;
    });

    // 先按子域（角度顺序），再按年份倒序；组内保持可读的时间线
    filteredItems = [...filteredItems].sort(
      (a, b) =>
        groupOrderOf(a) - groupOrderOf(b) ||
        (b.year ?? 0) - (a.year ?? 0) ||
        b.id - a.id
    );

    displayedCount = 0;
    lastGroupKey = null;
    catalogList.innerHTML = '';
    renderNextBatch();
    updateFooter();
  }

  function renderGroupHeader(key, firstItem) {
    const meta = angleMeta.get(key);
    const label = meta?.angleLabel || groupLabelOf(firstItem);
    const count = filteredItems.filter((item) => groupKeyOf(item) === key).length;
    const pattern = meta?.patternType || firstItem.patternType;
    const patternTag = pattern === 'linear'
      ? '<span class="cluster-tag cluster-tag-linear">时序</span>'
      : pattern === 'divergent'
        ? '<span class="cluster-tag cluster-tag-divergent">并列</span>'
        : '';

    return (
      '<li class="cluster-catalog-group-head" role="presentation">' +
        '<div class="cluster-catalog-group-title">' + escapeHtml(label) + '</div>' +
        '<div class="cluster-catalog-group-meta">' +
          '<span class="cluster-count-badge">' + count + ' 篇</span>' +
          patternTag +
        '</div>' +
      '</li>'
    );
  }

  function renderNextBatch() {
    const nextBatch = filteredItems.slice(displayedCount, displayedCount + CATALOG_PAGE_SIZE);
    if (nextBatch.length === 0 && displayedCount === 0) {
      catalogList.innerHTML = '<li class="cluster-empty-inline">未找到匹配的文献。</li>';
      return;
    }

    let html = '';
    nextBatch.forEach((item) => {
      const key = groupKeyOf(item);
      if (key !== lastGroupKey) {
        html += renderGroupHeader(key, item);
        lastGroupKey = key;
      }

      const role = ROLE_LABELS[item.role] || item.role;
      const pattern = item.patternType === 'divergent' ? '并列' : item.patternType === 'linear' ? '时序' : '未归链';
      const facetDesc = [item.method, item.object].filter(Boolean).map(escapeHtml).join(' / ');
      const angleLabel = item.angleLabel || '未归入子域';

      html +=
        '<li class="cluster-catalog-item" data-id="' + item.id + '" data-angle="' + escapeHtml(item.angleKey || UNASSIGNED_ANGLE) + '">' +
          '<div class="cluster-catalog-main">' +
            '<a class="cluster-catalog-title" href="/articles/' + item.id + '" target="_blank" rel="noopener">' +
              escapeHtml(item.title) +
            '</a>' +
            '<div class="cluster-catalog-sub">' +
              '<span class="cluster-tag cluster-tag-angle">' + escapeHtml(angleLabel) + '</span>' +
              (item.year ? '<span class="cluster-catalog-year tabular-num">' + item.year + '</span>' : '') +
              (facetDesc ? '<span class="cluster-catalog-facet">' + facetDesc + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="cluster-catalog-tags">' +
            '<span class="cluster-tag">' + escapeHtml(pattern) + '</span>' +
            '<span class="cluster-tag cluster-tag-role">' + escapeHtml(role) + '</span>' +
            (item.isPrimary ? '<span class="cluster-tag cluster-tag-primary">主归属</span>' : '') +
          '</div>' +
        '</li>';
    });

    catalogList.insertAdjacentHTML('beforeend', html);
    displayedCount += nextBatch.length;
  }

  function updateFooter() {
    const total = filteredItems.length;
    const hasFilter = Boolean(currentSearch) || currentRole !== 'all' || currentAngle !== 'all';
    if (resultsInfo) {
      resultsInfo.textContent = hasFilter
        ? '筛选匹配 ' + total + ' 篇（底册共 ' + allItems.length + ' 篇）'
        : '显示共 ' + total + ' 篇文献';
    }

    if (!catalogFooter || !catalogMoreBtn) return;
    const remaining = total - displayedCount;
    if (remaining > 0) {
      catalogFooter.style.display = 'flex';
      catalogMoreBtn.textContent = '加载更多（剩余 ' + remaining + ' 篇）';
    } else {
      catalogFooter.style.display = 'none';
    }
  }

  // 绑定搜索输入 (简易防抖)
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        currentSearch = e.target.value;
        filterData();
      }, 150);
    });
  }

  // 绑定子域切换
  if (angleSelect) {
    angleSelect.addEventListener('change', (e) => {
      currentAngle = e.target.value || 'all';
      filterData();
    });
  }

  // 绑定角色切换
  if (roleFilters) {
    roleFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('.catalog-filter-btn');
      if (!btn) return;
      const role = btn.dataset.role || 'all';
      if (role === currentRole) return;

      roleFilters.querySelectorAll('.catalog-filter-btn').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');

      currentRole = role;
      filterData();
    });
  }

  // 绑定加载更多
  if (catalogMoreBtn) {
    catalogMoreBtn.addEventListener('click', () => {
      renderNextBatch();
      updateFooter();
    });
  }

  // 初始渲染首屏
  filterData();
}
