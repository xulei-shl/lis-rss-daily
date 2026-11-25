// ============================================
// 主题洞察详情页 - 历史版本文件列表（页面底部）
// 每轮周分析成功后自动生成，包含四个 Tab 的全部内容
// ============================================

import { escapeHtml, formatDateTime } from './utils.js';

function formatSize(bytes) {
  if (!bytes || bytes < 1) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function setStatus(el, message, tone) {
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'cluster-documents-status';
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.className = 'cluster-documents-status' + (tone ? ' is-' + tone : '');
}

export function renderDocuments(detail) {
  const documents = detail.documents || [];

  const body = documents.length
    ? '<div class="cluster-table-responsive">' +
        '<table class="cluster-matrix cluster-documents-table">' +
          '<thead>' +
            '<tr><th>文件名</th><th>版本</th><th>生成时间</th><th>大小</th><th>操作</th></tr>' +
          '</thead>' +
          '<tbody>' +
            documents
              .map((doc) => {
                const downloadUrl =
                  '/api/cluster-topics/' +
                  encodeURIComponent(detail.slug) +
                  '/documents/' +
                  doc.id +
                  '/download';
                return (
                  '<tr>' +
                    '<td class="cluster-document-name">' +
                      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
                      '<span>' + escapeHtml(doc.filename) + '</span>' +
                    '</td>' +
                    '<td class="tabular-num">v' + doc.version + '</td>' +
                    '<td class="tabular-num">' + escapeHtml(formatDateTime(doc.createdAt)) + '</td>' +
                    '<td class="tabular-num">' + escapeHtml(formatSize(doc.sizeBytes)) + '</td>' +
                    '<td>' +
                      '<a class="cluster-document-download" href="' + downloadUrl + '" download>' +
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
                        '<span>下载</span>' +
                      '</a>' +
                    '</td>' +
                  '</tr>'
                );
              })
              .join('') +
          '</tbody>' +
        '</table>' +
      '</div>'
    : '<div class="cluster-empty-inline">暂无版本文件。下一轮周分析完成后会自动生成第一份。</div>';

  return (
    '<section class="cluster-section cluster-documents" id="clusterDocuments" data-slug="' + escapeHtml(detail.slug) + '">' +
      '<div class="cluster-section-header">' +
        '<h2 class="cluster-section-title">' +
          '<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"/><polyline points="3 9 21 9"/><polyline points="9 21 9 9"/></svg>' +
          '<span>历史版本文件 (' + documents.length + ')</span>' +
        '</h2>' +
        '<div class="cluster-documents-actions">' +
          '<button type="button" class="cluster-document-generate" data-generate-document="true">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M4 21h16"/></svg>' +
            '<span>生成当前版本</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<p class="cluster-documents-desc">' +
        '每轮「分析 → 综述 → 洞察」成功后，系统会为内容有变化的主题自动生成一份自包含 HTML 文件；也可点击右上角手动生成当前版本。' +
      '</p>' +
      '<p class="cluster-documents-status" id="clusterDocumentsStatus" role="status" hidden></p>' +
      body +
    '</section>'
  );
}

/**
 * 绑定「手动生成当前版本」按钮（事件委托，重新渲染列表后无需重新绑定）。
 */
export function bindDocumentsEvents(root) {
  if (!root || root._documentsBound) return;
  root._documentsBound = true;

  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-generate-document]');
    if (!button || button.disabled) return;

    const section = button.closest('#clusterDocuments');
    const slug = section && section.getAttribute('data-slug');
    if (!section || !slug) return;

    const label = button.querySelector('span');
    button.disabled = true;
    if (label) label.textContent = '生成中…';
    setStatus(section.querySelector('#clusterDocumentsStatus'), '', null);

    try {
      const res = await fetch('/api/cluster-topics/' + encodeURIComponent(slug) + '/documents', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload && payload.error ? payload.error : 'HTTP ' + res.status);
      }

      // 重新拉一次详情，保证版本号、文件数、空态都更新到最新
      const detailRes = await fetch('/api/cluster-topics/' + encodeURIComponent(slug), {
        credentials: 'same-origin'
      });
      if (detailRes.ok) {
        const detail = await detailRes.json();
        const fresh = document.createElement('div');
        fresh.innerHTML = renderDocuments(detail);
        const next = fresh.firstElementChild;
        if (next) section.replaceWith(next);
      }

      setStatus(
        document.getElementById('clusterDocumentsStatus'),
        payload.message || '已生成版本文件',
        payload.generated === false ? 'info' : 'success'
      );
    } catch (error) {
      setStatus(
        document.getElementById('clusterDocumentsStatus'),
        '生成失败：' + (error && error.message ? error.message : '请稍后重试'),
        'error'
      );
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        if (label) label.textContent = '生成当前版本';
      }
    }
  });
}
