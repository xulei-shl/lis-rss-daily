// ============================================
// 主题洞察详情页 - 工具与词典模块
// ============================================

export const RELATION_LABELS = {
  origin: '线索起点',
  continue: '承接',
  shift: '转向'
};

export const ROLE_LABELS = {
  backbone: '演进主干',
  divergent: '子课题成员',
  satellite: '边际卫星',
  frontier: '前沿探针'
};

export const TRIGGER_LABELS = {
  cron: '定时',
  manual: '手动',
  cold_start: '冷启动',
  rebuild: '重建'
};

export const RUN_STATUS_LABELS = {
  running: '进行中',
  completed: '完成',
  failed: '失败'
};

export const BASIS_LABELS = {
  matrix_hole: '依据：方法×对象覆盖空缺',
  cross_topic_gap: '依据：邻近主题间的交叉空白',
  adjacent_topic: '依据：邻近主题间的空白',
  staleness: '依据：该方向近期无新增',
  limitation: '依据：文献自陈局限'
};

export const GAP_STATE_LABELS = {
  opening: '正在打开',
  closing: '正在被填补',
  unaddressed: '仍无人回应'
};

export function buildArticleIndex(detail) {
  const index = {};
  (detail.angles || []).forEach((angle) => {
    (angle.steps || []).forEach((step) => {
      index[step.articleId] = { title: step.title, url: step.url };
    });
  });
  (detail.looseArticles || []).forEach((step) => {
    index[step.articleId] = { title: step.title, url: step.url };
  });
  (detail.evidenceArticles || []).forEach((item) => {
    if (!index[item.id]) {
      index[item.id] = { title: item.title, url: item.url };
    }
  });
  return index;
}

export function trendLabel(trend) {
  if (trend === 'up') return '升温';
  if (trend === 'down') return '退潮';
  return '平稳';
}

export function formatDateTime(value, overrides) {
  if (!value) return '未知';
  if (typeof window !== 'undefined' && window.timeUtils && typeof window.timeUtils.formatDateTime === 'function') {
    return window.timeUtils.formatDateTime(value, overrides);
  }
  const str = typeof value === 'string' ? value.trim().replace(' ', 'T') : value;
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 16) : date.toLocaleString('zh-CN');
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return ms + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
  const minutes = Math.floor(ms / 60000);
  return minutes + ' 分 ' + Math.round((ms % 60000) / 1000) + ' 秒';
}

export function formatMonth(value) {
  if (!value) return '未知';
  return String(value).slice(0, 7);
}

export function formatDate(value) {
  if (!value) return '时间未知';
  return String(value).slice(0, 10);
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ANALYSIS_NOTICE_ICONS = {
  warn: '<svg class="notice-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  error: '<svg class="notice-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  info: '<svg class="notice-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  success: '<svg class="notice-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>'
};

export function getAnalysisStatusNotice(detail) {
  if (!detail) return null;
  const reasonSuffix = detail.analysisError
    ? '（原因：' + escapeHtml(detail.analysisError) + '）'
    : '';

  if (detail.analysisStatus === 'insufficient_data') {
    return {
      tone: 'warn',
      iconSvg: ANALYSIS_NOTICE_ICONS.warn,
      shortText: '样本较少 · 仅展示规则矩阵',
      fullHtml: '<strong>数据提示：</strong>该主题当前聚合样本量较少，仅展示规则聚合对比矩阵，未推断脉络与空白结论。'
    };
  }
  if (detail.analysisStatus === 'partial') {
    return {
      tone: 'warn',
      iconSvg: ANALYSIS_NOTICE_ICONS.warn,
      shortText: '部分结论待下轮更新',
      fullHtml: '<strong>分析状态：</strong>部分综合研判结论待下轮流水线更新。' + reasonSuffix
    };
  }
  if (detail.analysisStatus === 'failed') {
    return {
      tone: 'error',
      iconSvg: ANALYSIS_NOTICE_ICONS.error,
      shortText: '分析生成失败 · 显示上期结果',
      fullHtml: '<strong>分析状态：</strong>本主题最近一次分析生成失败，当前显示为上期结果，系统将在下一轮重试。' + reasonSuffix
    };
  }
  if (detail.analysisStatus === 'missing') {
    return {
      tone: 'info',
      iconSvg: ANALYSIS_NOTICE_ICONS.info,
      shortText: '多维分析待下轮生成',
      fullHtml: '<strong>待生成：</strong>该主题的多维学术分析尚未生成，将在下一轮流水线中产出。'
    };
  }
  if (detail.analysisStatus === 'ok') {
    return {
      tone: 'success',
      iconSvg: ANALYSIS_NOTICE_ICONS.success,
      shortText: null,
      fullHtml: '<strong>最终状态：</strong>本主题多维学术分析已完整生成，当前展示最新研判结果。'
    };
  }
  return null;
}

export function renderInlineNoticeChip({ tone, shortText, fullText, extraClass = '', id = '' }) {
  const iconSvg = ANALYSIS_NOTICE_ICONS[tone] || ANALYSIS_NOTICE_ICONS.info;
  const cls = 'cluster-ambient-notice cluster-inline-notice cluster-notice-' + tone + (extraClass ? ' ' + extraClass : '');
  const idAttr = id ? 'id="' + id + '" ' : '';
  const tip = fullText + '（点击查看底部「流水线状态」完整说明）';

  return (
    '<button type="button" class="' + cls + '" ' + idAttr +
      'data-open-run-drawer="true" aria-controls="clusterRunDrawer" title="' + escapeHtml(tip) + '">' +
      iconSvg +
      '<span class="notice-body">' + escapeHtml(shortText) + '</span>' +
    '</button>'
  );
}

export function countInsufficientReviewSections(detail) {
  let count = 0;
  (detail && detail.reviews ? detail.reviews : []).forEach((review) => {
    (review.sections || []).forEach((section) => {
      if (section && section.insufficient) count += 1;
    });
  });
  return count;
}

export function isTrendMetricsInsufficient(detail) {
  const metrics = (detail && detail.metrics) || [];
  if (metrics.length === 0) return false;
  return metrics.filter((row) => row.addedLinkedCount > 0).length < 3;
}

export function getDetailNotices(detail) {
  const notices = [];
  const mainNotice = getAnalysisStatusNotice(detail);
  if (mainNotice) {
    notices.push(mainNotice);
  }

  const insufficientSections = countInsufficientReviewSections(detail);
  if (insufficientSections > 0) {
    notices.push({
      tone: 'warn',
      iconSvg: ANALYSIS_NOTICE_ICONS.warn,
      fullHtml:
        '<strong>综述与洞察（' + insufficientSections + ' 处证据不足）：</strong>' +
        '部分子群综述章节暂无直接支撑文献，已按原文声明标记为「证据不足」，未强行归纳结论。'
    });
  }

  const looseCount = ((detail && detail.looseArticles) || []).length;
  if (looseCount > 0) {
    notices.push({
      tone: 'info',
      iconSvg: ANALYSIS_NOTICE_ICONS.info,
      fullHtml:
        '<strong>研究脉络 · 零散研究（' + looseCount + ' 篇）：</strong>' +
        '这些文献隶属于本主题，但由于彼此承接关系不成立或篇数不足以聚合成独立角度，故保留平铺展示，不强制附会演进线索。'
    });
  }

  const adjacentCount = ((detail && detail.adjacent) || []).length;
  if (adjacentCount > 0) {
    notices.push({
      tone: 'info',
      iconSvg: ANALYSIS_NOTICE_ICONS.info,
      fullHtml:
        '<strong>矩阵与空白 · 邻近交叉主题（' + adjacentCount + ' 个）：</strong>' +
        '与当前研究方向共享方法或研究对象、但归属于平行分支的关联主题。'
    });
  }

  if (isTrendMetricsInsufficient(detail)) {
    notices.push({
      tone: 'warn',
      iconSvg: ANALYSIS_NOTICE_ICONS.warn,
      fullHtml:
        '<strong>演化趋势：</strong>覆盖有效月份不足 3 个月，样本暂不足以推断平滑趋势。'
    });
  }

  return notices;
}

/**
 * 绑定「依据 X 篇文献」抽屉展开/收起交互（综述空白与矩阵空白共用）。
 * 必须在 root 上只绑定一次，避免重复监听导致单次点击被连续翻转两次。
 */
export function bindGapEvidenceToggle(root) {
  if (!root || root._gapEvidenceBound) return;
  root._gapEvidenceBound = true;

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
