// ============================================
// 主题洞察详情页 - 顶部标题与时空元数据
// ============================================

import { escapeHtml, formatDateTime, formatMonth } from './utils.js';

export function renderHeader(detail) {
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

  const badgeHtml = badges.length
    ? badges.map(([cls, label]) => '<span class="cluster-badge ' + cls + '">' + escapeHtml(label) + '</span>').join(' ')
    : '';

  return (
    '<div class="cluster-detail-header">' +
      '<div class="cluster-header-nav">' +
        '<a href="/clusters" class="cluster-back-link" title="返回全部聚类主题">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>' +
          '<span>返回主题列表</span>' +
        '</a>' +
      '</div>' +
      '<div class="cluster-title-wrap">' +
        '<h1 class="page-title cluster-page-title">' + escapeHtml(detail.name) + '</h1>' +
        (badgeHtml ? '<div class="cluster-title-badges">' + badgeHtml + '</div>' : '') +
      '</div>' +
      '<div class="cluster-card-meta cluster-header-meta">' +
        '<span class="cluster-meta-pill" title="关联文献总数">' +
          '<strong>' + detail.linkedCount + '</strong> 篇' +
          '<span class="cluster-meta-sub">（主归属 ' + detail.primaryCount + '）</span>' +
        '</span>' +
        '<span class="cluster-meta-divider" aria-hidden="true">/</span>' +
        '<span class="cluster-meta-pill" title="文献涵盖时间段">' + escapeHtml(range) + '</span>' +
        '<span class="cluster-meta-divider" aria-hidden="true">/</span>' +
        '<span class="cluster-meta-pill" title="主题集合版本">集合 v' + escapeHtml(String(detail.setVersion)) + '</span>' +
        '<span class="cluster-meta-divider" aria-hidden="true">/</span>' +
        '<span class="cluster-meta-pill cluster-meta-time" title="主题初次创建建立时间">' +
          '<svg class="meta-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
          '创建于 ' + escapeHtml(formatDateTime(detail.createdAt)) +
        '</span>' +
        '<span class="cluster-meta-divider" aria-hidden="true">/</span>' +
        '<span class="cluster-meta-pill cluster-meta-time" title="多维分析最近更新时间">' +
          '<svg class="meta-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>' +
          '最近更新 ' + escapeHtml(formatDateTime(detail.updatedAt)) +
        '</span>' +
      '</div>' +
      (keywords ? '<div class="cluster-keywords-wrap">' + keywords + '</div>' : '') +
    '</div>'
  );
}

export function renderStatusNotice(detail) {
  if (detail.analysisStatus === 'insufficient_data') {
    return (
      '<div class="cluster-note cluster-note-warn">' +
        '<strong>数据提示：</strong>该主题样本量不足，仅展示规则聚合结果（对比矩阵）。为避免过度解读，未生成脉络、趋势与空白结论。' +
      '</div>'
    );
  }
  if (detail.analysisStatus === 'partial') {
    return (
      '<div class="cluster-note cluster-note-warn">' +
        '<strong>分析状态：</strong>综述与角度已更新，范式/前沿/空白部分待下一轮重试。' +
        (detail.analysisError ? '<br>原因：' + escapeHtml(detail.analysisError) : '') +
      '</div>'
    );
  }
  if (detail.analysisStatus === 'failed') {
    return (
      '<div class="cluster-note cluster-note-warn">' +
        '<strong>分析状态：</strong>本主题的多维分析最近一次生成失败，当前展示的是上一次成功结果。系统会在下一轮自动重试。' +
        (detail.analysisError ? '<br>原因：' + escapeHtml(detail.analysisError) : '') +
      '</div>'
    );
  }
  if (detail.analysisStatus === 'missing') {
    return '<div class="cluster-note cluster-note-warn"><strong>待生成：</strong>该主题的多维分析尚未生成，将在下一轮流水线中产出。</div>';
  }
  return '';
}
