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
