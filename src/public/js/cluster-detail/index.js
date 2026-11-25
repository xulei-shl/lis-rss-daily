// ============================================
// 主题洞察详情页 - 模块化入口总装
// ============================================

import { buildArticleIndex, escapeHtml, bindGapEvidenceToggle } from './utils.js';
import { renderHeader } from './header.js';
import { renderTopRunLogs } from './run-logs.js';
import { renderSummary, renderReviews, renderInsights, renderConsensusDualView, bindSynthesisEvents } from './tab-synthesis.js';
import { renderAngles, renderLoose } from './tab-evolution.js';
import { renderMatrix, renderGaps, renderAdjacent } from './tab-matrix.js';
import { renderTrend } from './tab-trends.js';
import { buildSynthesisToc, buildEvolutionToc, wrapWithTocLayout, initTocNavigation } from './toc.js';

const VALID_TABS = ['synthesis', 'evolution', 'matrix', 'trends'];
const DEFAULT_TAB = 'synthesis';

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('detailRoot');
  if (!root) return;

  const slug = decodeURIComponent(window.location.pathname.replace(/^\/clusters\//, '').split('/')[0] || '');
  if (!slug) {
    renderError(root, '缺少主题标识');
    return;
  }
  load(root, slug);
});

async function load(root, slug) {
  try {
    const res = await fetch('/api/cluster-topics/' + encodeURIComponent(slug), {
      credentials: 'same-origin'
    });
    if (res.status === 404) {
      renderError(root, '主题不存在或已归档');
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const detail = await res.json();
    renderPage(root, detail);
  } catch (err) {
    renderError(root, '数据加载失败，请稍后刷新重试');
  }
}

function renderPage(root, detail) {
  const articleIndex = buildArticleIndex(detail);
  const parts = [];

  // 1. 常驻顶层区域：主题标题、时空元数据与状态提示
  parts.push(renderHeader(detail));

  // 2. Tab 导航条
  const tabs = [
    { id: 'synthesis', label: '综述与洞察' },
    { id: 'evolution', label: '研究脉络' },
    { id: 'matrix', label: '矩阵与空白' },
    { id: 'trends', label: '演化趋势' }
  ];

  parts.push(renderTabBar(tabs));

  // 3. 4 大 Tab 面板
  parts.push('<div class="cluster-tab-panels" id="clusterTabPanels">');

  // Tab 1: 综述与洞察
  const synthesisContent =
    renderSummary(detail) +
    renderReviews(detail, articleIndex) +
    renderInsights(detail) +
    renderConsensusDualView(detail);
  parts.push(
    '<div class="cluster-tab-panel" id="panel-synthesis" role="tabpanel" aria-labelledby="tab-synthesis" hidden>' +
      wrapWithTocLayout('synthesis', synthesisContent, buildSynthesisToc(detail)) +
    '</div>'
  );

  // Tab 2: 研究脉络
  const evolutionContent =
    renderAngles(detail, articleIndex) +
    renderLoose(detail);
  parts.push(
    '<div class="cluster-tab-panel" id="panel-evolution" role="tabpanel" aria-labelledby="tab-evolution" hidden>' +
      wrapWithTocLayout('evolution', evolutionContent, buildEvolutionToc(detail)) +
    '</div>'
  );

  // Tab 3: 矩阵与空白
  parts.push(
    '<div class="cluster-tab-panel" id="panel-matrix" role="tabpanel" aria-labelledby="tab-matrix" hidden>' +
      renderMatrix(detail) +
      renderGaps(detail, articleIndex) +
      renderAdjacent(detail) +
    '</div>'
  );

  // Tab 4: 演化趋势
  parts.push(
    '<div class="cluster-tab-panel" id="panel-trends" role="tabpanel" aria-labelledby="tab-trends" hidden>' +
      renderTrend(detail) +
    '</div>'
  );

  parts.push('</div>');

  // 4. 移至底页次级区域的流水线日志抽屉
  parts.push(renderTopRunLogs(detail));

  root.innerHTML = parts.filter(Boolean).join('');

  // 初始化章节目录联动与吸顶偏移
  const tocController = initTocNavigation(root);

  // 绑定 Tab 切换与 Hash 路由
  initTabNavigation(root, tocController);

  // 绑定顶部状态栏日志抽屉唤起
  initRunLogsToggle(root);

  // 绑定综述折叠展开交互
  bindSynthesisEvents(root);

  // 绑定研究空白依据文献清单展开/收起交互
  bindGapEvidenceToggle(root);
}

function initRunLogsToggle(root) {
  const drawer = root.querySelector('#clusterRunDrawer');
  if (!drawer) return;

  const topBtn = root.querySelector('#btnToggleRunLogs');
  if (topBtn) {
    topBtn.addEventListener('click', () => {
      drawer.open = !drawer.open;
      if (drawer.open) {
        drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  root.addEventListener('click', (e) => {
    const noticeTrigger = e.target.closest('[data-open-run-drawer="true"]');
    if (!noticeTrigger) return;
    e.preventDefault();
    e.stopPropagation();
    drawer.open = true;
    drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function renderTabBar(tabs) {
  const tabButtons = tabs
    .map((tab) => {
      const iconSpan = tab.icon
        ? '<span class="cluster-tab-icon" aria-hidden="true">' + tab.icon + '</span>'
        : '';
      const countBadge = typeof tab.count === 'number'
        ? '<span class="cluster-tab-badge tabular-num">' + tab.count + '</span>'
        : '';

      return (
        '<button type="button" class="cluster-tab-btn" id="tab-' + tab.id + '" ' +
          'data-tab="' + tab.id + '" role="tab" aria-selected="false" aria-controls="panel-' + tab.id + '" tabindex="-1">' +
          iconSpan +
          '<span class="cluster-tab-text">' + escapeHtml(tab.label) + '</span>' +
          countBadge +
        '</button>'
      );
    })
    .join('');

  return (
    '<nav class="cluster-tab-nav" aria-label="主题详情模块导航">' +
      '<div class="cluster-tab-bar" role="tablist">' +
        tabButtons +
      '</div>' +
    '</nav>'
  );
}

function initTabNavigation(root, tocController) {
  const tabBar = root.querySelector('.cluster-tab-bar');
  if (!tabBar) return;

  const tabButtons = Array.from(tabBar.querySelectorAll('.cluster-tab-btn'));
  const panels = Array.from(root.querySelectorAll('.cluster-tab-panel'));

  function getTargetTabFromHash() {
    const rawHash = (window.location.hash || '').replace(/^#/, '');
    if (rawHash === 'catalog') return 'evolution';
    return VALID_TABS.includes(rawHash) ? rawHash : DEFAULT_TAB;
  }

  function activateTab(tabId, updateHash = false) {
    if (!VALID_TABS.includes(tabId)) tabId = DEFAULT_TAB;

    tabButtons.forEach((btn) => {
      const isTarget = btn.dataset.tab === tabId;
      btn.classList.toggle('active', isTarget);
      btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
      btn.setAttribute('tabindex', isTarget ? '0' : '-1');
    });

    panels.forEach((panel) => {
      const isTarget = panel.id === 'panel-' + tabId;
      panel.hidden = !isTarget;
      panel.classList.toggle('active', isTarget);
    });

    if (updateHash && window.location.hash !== '#' + tabId) {
      history.replaceState(null, '', '#' + tabId);
    }

    if (tocController && typeof tocController.onTabChange === 'function') {
      tocController.onTabChange(tabId);
    }
  }

  // 点击事件
  tabBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.cluster-tab-btn');
    if (!btn) return;
    const tabId = btn.dataset.tab;
    activateTab(tabId, true);
  });

  // 键盘快捷键导航 (左右箭头、Home、End)
  tabBar.addEventListener('keydown', (e) => {
    const activeBtn = document.activeElement;
    const currentIndex = tabButtons.indexOf(activeBtn);
    if (currentIndex === -1) return;

    let targetIndex = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      targetIndex = (currentIndex + 1) % tabButtons.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      targetIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    } else if (e.key === 'Home') {
      targetIndex = 0;
    } else if (e.key === 'End') {
      targetIndex = tabButtons.length - 1;
    }

    if (targetIndex !== -1) {
      e.preventDefault();
      const targetBtn = tabButtons[targetIndex];
      targetBtn.focus();
      activateTab(targetBtn.dataset.tab, true);
    }
  });

  // Hash 变化时同步
  window.addEventListener('hashchange', () => {
    activateTab(getTargetTabFromHash(), false);
  });

  // 初始激活
  activateTab(getTargetTabFromHash(), false);
}

function renderError(root, message) {
  root.innerHTML = '<div class="cluster-empty">' + escapeHtml(message) + '</div>';
}
