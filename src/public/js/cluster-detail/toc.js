// ============================================
// 主题洞察详情页 - 章节导航目录 (TOC) 与锚点联动
// 支持：桌面端右侧吸顶目录轨 + 移动端顶部折叠目录
// ============================================

import { escapeHtml } from './utils.js';

/**
 * 构建 Tab 1（综述与洞察）章节目录结构
 */
export function buildSynthesisToc(detail) {
  if (!detail) return null;

  const groups = [];
  const analysis = detail.analysis;
  const hasSummary = Boolean(
    analysis &&
      (analysis.overview ||
        (analysis.trend && analysis.trend.summary) ||
        analysis.historySummary)
  );

  if (hasSummary) {
    groups.push({
      title: '导读',
      count: null,
      items: [
        {
          id: 'cluster-summary-dossier',
          label: '主题综述导读',
          meta: '',
          indexLabel: ''
        }
      ]
    });
  }

  const reviews = detail.reviews || [];
  if (reviews.length > 0) {
    groups.push({
      title: '子群深度综述',
      count: reviews.length,
      items: reviews.map((review, idx) => ({
        id: 'cluster-review-' + (idx + 1),
        label: review.title || '子群综述 #' + (idx + 1),
        meta: typeof review.memberCount === 'number' ? review.memberCount + ' 篇' : '',
        indexLabel: String(idx + 1).padStart(2, '0')
      }))
    });
  }

  const insights = detail.insights || [];
  if (insights.length > 0) {
    groups.push({
      title: '主题多维研判',
      count: insights.length,
      items: insights.map((report, idx) => ({
        id: 'cluster-insight-' + (idx + 1),
        label: report.title || '多维研判 #' + (idx + 1),
        meta: report.version ? 'v' + report.version : '',
        indexLabel: String(idx + 1).padStart(2, '0')
      }))
    });
  }

  const consensusCount = analysis && Array.isArray(analysis.consensus) ? analysis.consensus.length : 0;
  const controversyCount = analysis && Array.isArray(analysis.controversies) ? analysis.controversies.length : 0;
  if (consensusCount > 0 || controversyCount > 0) {
    groups.push({
      title: '收敛与分歧',
      count: null,
      items: [
        {
          id: 'cluster-consensus-section',
          label: '学术共识与边界分歧',
          meta: consensusCount + controversyCount + ' 条',
          indexLabel: ''
        }
      ]
    });
  }

  const totalItems = groups.reduce((sum, group) => sum + group.items.length, 0);
  const hasMultiEntry = reviews.length >= 2 || insights.length >= 2 || totalItems >= 3;
  if (!hasMultiEntry) return null;

  return {
    panelId: 'synthesis',
    totalItems,
    groups
  };
}

/**
 * 构建 Tab 2（研究脉络）章节目录结构
 */
export function buildEvolutionToc(detail) {
  if (!detail) return null;

  const groups = [];
  const angles = detail.angles || [];
  if (angles.length > 0) {
    groups.push({
      title: '研究脉络',
      count: angles.length,
      items: angles.map((angle, idx) => ({
        id: 'cluster-angle-' + (idx + 1),
        label: angle.angleLabel || '未命名子课题',
        meta: (angle.patternType === 'divergent' ? '分面 · ' : '脉络 · ') + angle.articleCount + ' 篇',
        indexLabel: String(idx + 1).padStart(2, '0')
      }))
    });
  }

  const loose = detail.looseArticles || [];
  if (loose.length > 0) {
    groups.push({
      title: '补充文献',
      count: null,
      items: [
        {
          id: 'cluster-loose-section',
          label: '零散研究（未归链）',
          meta: loose.length + ' 篇',
          indexLabel: ''
        }
      ]
    });
  }

  const totalItems = groups.reduce((sum, group) => sum + group.items.length, 0);
  if (totalItems < 2) return null;

  return {
    panelId: 'evolution',
    totalItems,
    groups
  };
}

/**
 * 若当前 Tab 具备多章节，包一层响应式双栏目录骨架；否则保持原样单栏
 */
export function wrapWithTocLayout(panelId, mainHtml, tocModel) {
  if (!tocModel || !mainHtml) return mainHtml;

  return (
    '<div class="cluster-toc-layout">' +
      renderTocAside(panelId, tocModel) +
      '<div class="cluster-toc-main">' +
        mainHtml +
      '</div>' +
    '</div>'
  );
}

function renderTocAside(panelId, tocModel) {
  const bodyId = 'cluster-toc-body-' + panelId;
  const firstItem = tocModel.groups[0] && tocModel.groups[0].items[0];
  const initialLabel = firstItem ? firstItem.label : '章节导航';

  const groupsHtml = tocModel.groups
    .map((group) => {
      const countBadge = typeof group.count === 'number'
        ? '<span class="cluster-toc-group-count tabular-num">' + group.count + '</span>'
        : '';
      const groupHead =
        '<div class="cluster-toc-group-title">' +
          '<span>' + escapeHtml(group.title) + '</span>' +
          countBadge +
        '</div>';

      const itemsHtml = group.items
        .map((item, itemIdx) => {
          const isInitial = firstItem && item.id === firstItem.id && itemIdx === 0;
          return (
            '<li class="cluster-toc-item">' +
              '<button type="button" class="cluster-toc-link' + (isInitial ? ' is-active' : '') + '"' +
                ' data-toc-link="' + escapeHtml(item.id) + '"' +
                (isInitial ? ' aria-current="location"' : '') +
                ' title="' + escapeHtml(item.label) + '">' +
                (item.indexLabel
                  ? '<span class="cluster-toc-num tabular-num" aria-hidden="true">' + escapeHtml(item.indexLabel) + '</span>'
                  : '<span class="cluster-toc-dot" aria-hidden="true"></span>') +
                '<span class="cluster-toc-link-body">' +
                  '<span class="cluster-toc-link-title">' + escapeHtml(item.label) + '</span>' +
                  (item.meta ? '<span class="cluster-toc-link-meta tabular-num">' + escapeHtml(item.meta) + '</span>' : '') +
                '</span>' +
              '</button>' +
            '</li>'
          );
        })
        .join('');

      return (
        '<div class="cluster-toc-group">' +
          groupHead +
          '<ul class="cluster-toc-list">' + itemsHtml + '</ul>' +
        '</div>'
      );
    })
    .join('');

  return (
    '<aside class="cluster-toc-aside" aria-label="章节导航目录" data-toc-panel="' + escapeHtml(panelId) + '" data-mobile-open="false">' +
      '<div class="cluster-toc-card">' +
        '<div class="cluster-toc-desktop-head">' +
          '<span class="cluster-toc-heading">' +
            '<svg class="cluster-toc-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<line x1="8" y1="6" x2="21" y2="6"/>' +
              '<line x1="8" y1="12" x2="21" y2="12"/>' +
              '<line x1="8" y1="18" x2="21" y2="18"/>' +
              '<line x1="3" y1="6" x2="3.01" y2="6"/>' +
              '<line x1="3" y1="12" x2="3.01" y2="12"/>' +
              '<line x1="3" y1="18" x2="3.01" y2="18"/>' +
            '</svg>' +
            '<span>章节目录</span>' +
          '</span>' +
          '<span class="cluster-toc-total tabular-num">' + tocModel.totalItems + ' 节</span>' +
        '</div>' +

        '<button type="button" class="cluster-toc-mobile-trigger" aria-expanded="false" aria-controls="' + escapeHtml(bodyId) + '">' +
          '<span class="cluster-toc-mobile-left">' +
            '<svg class="cluster-toc-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<line x1="8" y1="6" x2="21" y2="6"/>' +
              '<line x1="8" y1="12" x2="21" y2="12"/>' +
              '<line x1="8" y1="18" x2="21" y2="18"/>' +
              '<line x1="3" y1="6" x2="3.01" y2="6"/>' +
              '<line x1="3" y1="12" x2="3.01" y2="12"/>' +
              '<line x1="3" y1="18" x2="3.01" y2="18"/>' +
            '</svg>' +
            '<span class="cluster-toc-mobile-label">目录</span>' +
            '<span class="cluster-toc-total tabular-num">' + tocModel.totalItems + '</span>' +
            '<span class="cluster-toc-mobile-sep" aria-hidden="true">·</span>' +
            '<span class="cluster-toc-mobile-current" data-toc-mobile-current>' + escapeHtml(initialLabel) + '</span>' +
          '</span>' +
          '<svg class="cluster-toc-chevron" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<polyline points="6 9 12 15 18 9"/>' +
          '</svg>' +
        '</button>' +

        '<nav class="cluster-toc-body-wrap" id="' + escapeHtml(bodyId) + '" aria-label="章节列表">' +
          '<div class="cluster-toc-body-inner">' +
            '<div class="cluster-toc-body">' +
              groupsHtml +
            '</div>' +
          '</div>' +
        '</nav>' +
      '</div>' +
    '</aside>'
  );
}

/**
 * 展开目标章节内部可能折叠的 details（综述论证、多维研判细节、零散研究）
 */
function expandTargetDetails(root, targetEl) {
  if (!targetEl) return;

  const detailsList = targetEl.matches('details')
    ? [targetEl]
    : Array.from(targetEl.querySelectorAll('details.cluster-accordion, details.cluster-details'));

  let changed = false;
  detailsList.forEach((details) => {
    if (!details.open) {
      details.open = true;
      changed = true;
    }
  });

  if (changed) {
    root.dispatchEvent(new CustomEvent('cluster:toc-expanded'));
  }
}

/**
 * 同步吸顶偏移 CSS 变量，避免跳锚或吸顶目录被全局页头 / Tab 栏遮挡
 */
function createStickyOffsetController(root) {
  const siteHeader = document.querySelector('.site-header');
  const tabNav = root.querySelector('.cluster-tab-nav');
  let lastKey = '';
  let currentScrollOffset = 120;

  function sync() {
    const headerRect = siteHeader ? siteHeader.getBoundingClientRect() : null;
    const headerHeight = headerRect ? Math.ceil(headerRect.height) : 0;
    const tabNavHeight = tabNav ? Math.ceil(tabNav.getBoundingClientRect().height) : 0;

    const tabNavSticky = tabNav
      ? window.getComputedStyle(tabNav).position === 'sticky'
      : false;
    const stickyTop = headerHeight + (tabNavSticky ? tabNavHeight : 0);
    currentScrollOffset = stickyTop + 20;

    const nextKey = headerHeight + ':' + tabNavHeight + ':' + stickyTop;
    if (nextKey !== lastKey) {
      lastKey = nextKey;
      root.style.setProperty('--cluster-site-header-h', headerHeight + 'px');
      root.style.setProperty('--cluster-tab-nav-h', tabNavHeight + 'px');
      root.style.setProperty('--cluster-toc-sticky-top', stickyTop + 16 + 'px');
      root.style.setProperty('--cluster-scroll-offset', currentScrollOffset + 'px');
    }

    return currentScrollOffset;
  }

  let rafPending = false;
  const scheduleSync = () => {
    if (rafPending) return;
    rafPending = true;
    window.requestAnimationFrame(() => {
      rafPending = false;
      sync();
    });
  };

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(scheduleSync);
    if (siteHeader) observer.observe(siteHeader);
    if (tabNav) observer.observe(tabNav);
  }
  window.addEventListener('resize', scheduleSync, { passive: true });

  sync();
  return {
    sync,
    getScrollOffset() {
      return currentScrollOffset;
    }
  };
}

function setMobileDrawerOpen(aside, isOpen, instant = false) {
  if (!aside) return;
  const trigger = aside.querySelector('.cluster-toc-mobile-trigger');
  if (instant) {
    aside.classList.add('is-instant-toggle');
  }
  aside.setAttribute('data-mobile-open', isOpen ? 'true' : 'false');
  if (trigger) {
    trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }
  if (instant) {
    // 强制同步样式刷新后恢复正常过渡
    void aside.offsetHeight;
    aside.classList.remove('is-instant-toggle');
  }
}

function setActiveTocItem(aside, targetId) {
  if (!aside || !targetId) return;

  const links = Array.from(aside.querySelectorAll('[data-toc-link]'));
  let activeLink = null;
  links.forEach((link) => {
    const isMatch = link.getAttribute('data-toc-link') === targetId;
    link.classList.toggle('is-active', isMatch);
    if (isMatch) {
      link.setAttribute('aria-current', 'location');
      activeLink = link;
    } else {
      link.removeAttribute('aria-current');
    }
  });

  if (activeLink) {
    const currentLabel = aside.querySelector('[data-toc-mobile-current]');
    const titleEl = activeLink.querySelector('.cluster-toc-link-title');
    if (currentLabel && titleEl) {
      currentLabel.textContent = titleEl.textContent || '';
    }

    // 仅当桌面侧栏列表自身出现内部滚动条时才将激活项保持在可视区内
    const scrollContainer = aside.querySelector('.cluster-toc-body-wrap');
    if (
      window.innerWidth >= 1024 &&
      scrollContainer &&
      scrollContainer.scrollHeight > scrollContainer.clientHeight + 4
    ) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const linkRect = activeLink.getBoundingClientRect();
      if (linkRect.top < containerRect.top + 12 || linkRect.bottom > containerRect.bottom - 12) {
        activeLink.scrollIntoView({ block: 'nearest' });
      }
    }
  }
}

function flashTargetSection(targetEl) {
  if (!targetEl) return;
  if (targetEl._tocFlashTimer) {
    window.clearTimeout(targetEl._tocFlashTimer);
  }
  targetEl.classList.remove('is-toc-target-flash');
  void targetEl.offsetWidth;
  targetEl.classList.add('is-toc-target-flash');
  targetEl._tocFlashTimer = window.setTimeout(() => {
    targetEl.classList.remove('is-toc-target-flash');
    targetEl._tocFlashTimer = 0;
  }, 1100);
}

/**
 * 初始化目录点击跳转、折叠自动展开与滚动位置监听
 */
export function initTocNavigation(root) {
  const stickyController = createStickyOffsetController(root);
  const asides = Array.from(root.querySelectorAll('.cluster-toc-aside'));
  if (asides.length === 0) {
    return {
      onTabChange() {
        stickyController.sync();
      }
    };
  }

  let spyLockUntil = 0;
  let spyRaf = 0;

  function getActivePanelAndAside() {
    const activePanel = root.querySelector('.cluster-tab-panel:not([hidden])');
    if (!activePanel) return null;
    const aside = activePanel.querySelector('.cluster-toc-aside');
    if (!aside) return null;
    return { activePanel, aside };
  }

  function updateScrollSpy() {
    if (performance.now() < spyLockUntil) return;
    const pair = getActivePanelAndAside();
    if (!pair) return;

    const { activePanel, aside } = pair;
    const targets = Array.from(activePanel.querySelectorAll('[data-toc-target="true"][id]'));
    if (targets.length === 0) return;

    const scrollOffset = stickyController.getScrollOffset();
    const threshold = scrollOffset + 28;
    let activeId = targets[0].id;

    const docEl = document.documentElement;
    const isScrollable = docEl.scrollHeight > window.innerHeight + 24;
    const atPageBottom =
      isScrollable && window.innerHeight + window.scrollY >= docEl.scrollHeight - 24;

    if (atPageBottom) {
      activeId = targets[targets.length - 1].id;
    } else {
      for (let i = 0; i < targets.length; i += 1) {
        const rect = targets[i].getBoundingClientRect();
        if (rect.top <= threshold) {
          activeId = targets[i].id;
        } else {
          break;
        }
      }
    }

    setActiveTocItem(aside, activeId);
  }

  function scheduleScrollSpy() {
    if (spyRaf) return;
    spyRaf = window.requestAnimationFrame(() => {
      spyRaf = 0;
      updateScrollSpy();
    });
  }

  // 1. 移动端目录折叠按钮点击
  root.addEventListener('click', (e) => {
    const mobileTrigger = e.target.closest('.cluster-toc-mobile-trigger');
    if (mobileTrigger) {
      const aside = mobileTrigger.closest('.cluster-toc-aside');
      if (!aside) return;
      const isOpen = aside.getAttribute('data-mobile-open') === 'true';
      setMobileDrawerOpen(aside, !isOpen, false);
      return;
    }

    // 2. 目录章节点击跳转 + 自动展开折叠内容
    const tocLink = e.target.closest('[data-toc-link]');
    if (!tocLink) return;
    e.preventDefault();

    const targetId = tocLink.getAttribute('data-toc-link');
    const aside = tocLink.closest('.cluster-toc-aside');
    const panel = tocLink.closest('.cluster-tab-panel');
    if (!targetId || !panel) return;

    const targetEl = panel.querySelector('#' + CSS.escape(targetId));
    if (!targetEl) return;

    // 窄屏先瞬时收起目录抽屉，避免高度塌陷导致滚动目标偏移
    if (aside && window.innerWidth < 1024 && aside.getAttribute('data-mobile-open') === 'true') {
      setMobileDrawerOpen(aside, false, true);
    }

    // 展开目标条目内部的折叠详情（并通知顶部「全部展开/收起」按钮同步）
    expandTargetDetails(root, targetEl);

    stickyController.sync();
    setActiveTocItem(aside, targetId);

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    spyLockUntil = performance.now() + (prefersReducedMotion ? 50 : 600);

    window.requestAnimationFrame(() => {
      targetEl.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start'
      });

      if (!targetEl.hasAttribute('tabindex')) {
        targetEl.setAttribute('tabindex', '-1');
      }
      if (typeof targetEl.focus === 'function') {
        targetEl.focus({ preventScroll: true });
      }
      flashTargetSection(targetEl);
    });
  });

  window.addEventListener('scroll', scheduleScrollSpy, { passive: true });
  window.addEventListener('resize', scheduleScrollSpy, { passive: true });

  // 初始同步一次当前激活目录
  updateScrollSpy();

  return {
    onTabChange() {
      stickyController.sync();
      spyLockUntil = 0;
      updateScrollSpy();
    }
  };
}
