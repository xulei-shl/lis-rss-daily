/**
 * 主题洞察版本文件渲染器（Node 端）。
 *
 * 直接复用详情页前端的纯字符串渲染函数，保证导出的 HTML 与页面
 * 四个 Tab 的口径一致：综述与洞察 / 研究脉络 / 矩阵与空白 / 演化趋势。
 * 这里只额外包一层自包含的文档外壳，并把详情页 CSS 内联进文件，
 * 下载后离线打开即可阅读。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderHeader } from '../public/js/cluster-detail/header.js';
import {
  renderSummary,
  renderReviews,
  renderInsights,
  renderConsensusDualView,
} from '../public/js/cluster-detail/tab-synthesis.js';
import { renderAngles, renderLoose } from '../public/js/cluster-detail/tab-evolution.js';
import { renderMatrix, renderGaps, renderAdjacent } from '../public/js/cluster-detail/tab-matrix.js';
import { renderTrend } from '../public/js/cluster-detail/tab-trends.js';
import { buildArticleIndex, escapeHtml } from '../public/js/cluster-detail/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_DIR = path.join(__dirname, '../public/css/pages/clusters');

const CSS_FILES = [
  'tokens.css',
  'common.css',
  'detail-shell.css',
  'tabs/tab-synthesis.css',
  'tabs/tab-evolution.css',
  'tabs/tab-matrix.css',
  'tabs/tab-trends.css',
  'run-logs.css',
];

const DOCUMENT_CSS = `
.cluster-document {
  max-width: 1100px;
  margin: 0 auto;
  padding: 32px 24px 64px;
  background: var(--color-bg, #fff);
  color: var(--color-text, #1f2937);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  line-height: 1.7;
}
.cluster-document-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 20px;
  padding: 10px 14px;
  border: 1px solid var(--cluster-blue-border, #cbd5e1);
  border-radius: 8px;
  background: var(--cluster-blue-tint, #f8fafc);
  font-size: 13px;
  color: var(--cluster-text-muted, #64748b);
}
.cluster-document-badge {
  font-weight: 600;
  color: var(--cluster-blue, #1a4d7a);
}
.cluster-document-part {
  margin-top: 40px;
}
.cluster-document-part-title {
  font-size: 20px;
  font-weight: 700;
  padding-bottom: 8px;
  margin: 0 0 16px;
  border-bottom: 2px solid var(--cluster-blue-border, #cbd5e1);
  color: var(--cluster-blue, #1a4d7a);
}
.cluster-document a {
  color: var(--cluster-blue, #1a4d7a);
}
@media print {
  .cluster-document { max-width: none; padding: 0; }
  .cluster-document-banner { border-color: #ddd; background: none; }
  .cluster-document-part { break-inside: auto; }
  .cluster-section { break-inside: avoid; }
}
`;

let cachedCss = null;

function readDocumentCss() {
  if (cachedCss !== null) return cachedCss;
  const parts = CSS_FILES.map((file) => {
    const fullPath = path.join(CSS_DIR, file);
    try {
      return fs.readFileSync(fullPath, 'utf-8');
    } catch {
      return '';
    }
  });
  cachedCss = parts.join('\n') + '\n' + DOCUMENT_CSS;
  return cachedCss;
}

/**
 * @param {object} detail getTopicDetail() 的返回值
 * @param {{ version: number, generatedAtLabel: string }} meta
 * @returns {string} 完整、自包含的 HTML 文档
 */
export function renderClusterDocumentHtml(detail, meta) {
  const articleIndex = buildArticleIndex(detail);

  const synthesis =
    renderSummary(detail) +
    renderReviews(detail, articleIndex) +
    renderInsights(detail) +
    renderConsensusDualView(detail);

  const evolution = renderAngles(detail, articleIndex) + renderLoose(detail);

  const matrix = renderMatrix(detail) + renderGaps(detail, articleIndex) + renderAdjacent(detail);

  const trends = renderTrend(detail);

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(detail.name)} · 主题洞察 v${meta.version}</title>
<style>${readDocumentCss()}</style>
</head>
<body>
<main class="cluster-document" id="detailRoot">
  <div class="cluster-document-banner">
    <span class="cluster-document-badge">主题洞察版本 v${meta.version}</span>
    <span>导出时间：${escapeHtml(meta.generatedAtLabel)}</span>
  </div>

  ${renderHeader(detail)}

  <section class="cluster-document-part">
    <h2 class="cluster-document-part-title">一、综述与洞察</h2>
    ${synthesis}
  </section>

  <section class="cluster-document-part">
    <h2 class="cluster-document-part-title">二、研究脉络</h2>
    ${evolution}
  </section>

  <section class="cluster-document-part">
    <h2 class="cluster-document-part-title">三、矩阵与空白</h2>
    ${matrix}
  </section>

  <section class="cluster-document-part">
    <h2 class="cluster-document-part-title">四、演化趋势</h2>
    ${trends}
  </section>
</main>
</body>
</html>
`;
}
