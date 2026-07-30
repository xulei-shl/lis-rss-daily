/**
 * Keyboard Shortcuts System
 * Provides global keyboard shortcuts for common actions.
 *
 * Available shortcuts:
 *   ?  - Show/hide shortcuts help
 *   /  - Focus search input (on search, articles, history pages)
 *   g h - Go to home
 *   g a - Go to articles
 *   g s - Go to search
 *   g d - Go to deep search
 *   g i - Go to history
 *   j  - Move to next article (articles list page)
 *   k  - Move to previous article (articles list page)
 *   r  - Toggle read status on focused article
 *   Esc - Close modals / cancel editing
 */

(function () {
  'use strict';

  const SHORTCUTS = [
    { keys: '?', description: '显示/隐藏快捷键帮助' },
    { keys: '/', description: '聚焦搜索框' },
    { keys: 'g h', description: '前往首页' },
    { keys: 'g a', description: '前往文章列表' },
    { keys: 'g s', description: '前往搜索' },
    { keys: 'g d', description: '前往深度检索' },
    { keys: 'g i', description: '前往历史总结' },
    { keys: 'j', description: '下一篇文章' },
    { keys: 'k', description: '上一篇文章' },
    { keys: 'r', description: '切换已读状态' },
    { keys: 'Esc', description: '关闭弹窗/取消编辑' },
  ];

  let buffer = '';
  let bufferTimer = null;
  let shortcutsVisible = false;

  // Create help modal
  function createHelpModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'shortcutsHelpOverlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width: 480px;">
        <div class="modal-header">
          <h3>⌨️ 键盘快捷键</h3>
          <button class="modal-close" id="shortcutsHelpClose">&times;</button>
        </div>
        <div class="modal-body" style="padding: var(--space-4) 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tbody>
              ${SHORTCUTS.map(s => `
                <tr style="border-bottom: 1px solid var(--divider);">
                  <td style="padding: 10px 0; font-family: var(--font-mono); font-size: var(--text-xs);">
                    <kbd style="background: var(--bg-subtle); border: 1px solid var(--border); border-radius: 4px; padding: 2px 8px; font-family: inherit;">${escapeHtml(s.keys)}</kbd>
                  </td>
                  <td style="padding: 10px 0 10px 16px; font-size: var(--text-sm); color: var(--text-secondary);">${escapeHtml(s.description)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <p style="margin-top: 12px; font-size: var(--text-xs); color: var(--text-tertiary);">
            提示：先按 g，再按 h/a/s/d/i 可快速导航
          </p>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('shortcutsHelpClose').addEventListener('click', hideHelp);
    overlay.addEventListener('click', function (e) {
      if (e.target === this) hideHelp();
    });
  }

  function showHelp() {
    if (!document.getElementById('shortcutsHelpOverlay')) {
      createHelpModal();
    }
    document.getElementById('shortcutsHelpOverlay').classList.add('active');
    shortcutsVisible = true;
  }

  function hideHelp() {
    const el = document.getElementById('shortcutsHelpOverlay');
    if (el) el.classList.remove('active');
    shortcutsVisible = false;
  }

  // Focus search input on supported pages
  function focusSearch() {
    const inputs = [
      document.querySelector('.search-input'),
      document.querySelector('#searchInput'),
      document.querySelector('input[type="search"]'),
    ];
    for (const input of inputs) {
      if (input && input.offsetParent !== null) {
        input.focus();
        input.select();
        return true;
      }
    }
    return false;
  }

  // Navigate articles (j/k)
  function navigateArticle(direction) {
    const articles = document.querySelectorAll('.article-card');
    if (articles.length === 0) return;

    // Find currently focused article
    let focusedIndex = -1;
    const focused = document.activeElement;
    articles.forEach((article, i) => {
      if (article.contains(focused)) {
        focusedIndex = i;
      }
    });

    const nextIndex = Math.max(0, Math.min(articles.length - 1, focusedIndex + direction));
    const target = articles[nextIndex];

    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Focus the title link
      const link = target.querySelector('.article-title a') || target;
      if (link) link.focus({ preventScroll: true });
    }
  }

  // Toggle read status on focused article
  function toggleFocusedRead() {
    const article = findFocusedArticle();
    if (!article) return;

    const btn = article.querySelector('.article-actions button');
    if (btn && btn.textContent.includes('已读') || btn.textContent.includes('未读')) {
      btn.click();
    }
  }

  function findFocusedArticle() {
    const focused = document.activeElement;
    if (!focused) return null;
    return focused.closest('.article-card');
  }

  // Close modals - just remove active class, don't trigger click handlers
  function closeModals() {
    const openModals = document.querySelectorAll('.modal-overlay.active');
    openModals.forEach(modal => {
      modal.classList.remove('active');
    });
    hideHelp();
  }

  // Process keyboard buffer for multi-key shortcuts
  function processBuffer() {
    switch (buffer) {
      case 'gh':
        window.location.href = '/';
        break;
      case 'ga':
        window.location.href = '/articles';
        break;
      case 'gs':
        window.location.href = '/search';
        break;
      case 'gd':
        window.location.href = '/deepsearch';
        break;
      case 'gi':
        window.location.href = '/history';
        break;
    }
    buffer = '';
  }

  // Escape HTML for help modal
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Main keydown handler
  document.addEventListener('keydown', function (e) {
    // Don't intercept when typing in input fields
    const tag = e.target.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;

    // Always allow Escape
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModals();
      return;
    }

    // Always allow ? for help (but not when typing)
    if (e.key === '?' && !isInput) {
      e.preventDefault();
      if (shortcutsVisible) {
        hideHelp();
      } else {
        showHelp();
      }
      return;
    }

    // Skip if user is typing in an input
    if (isInput) return;

    switch (e.key) {
      case '/':
        e.preventDefault();
        focusSearch();
        break;

      case 'j':
        e.preventDefault();
        navigateArticle(1);
        break;

      case 'k':
        e.preventDefault();
        navigateArticle(-1);
        break;

      case 'r':
        e.preventDefault();
        toggleFocusedRead();
        break;

      case 'g':
        e.preventDefault();
        buffer = 'g';
        clearTimeout(bufferTimer);
        bufferTimer = setTimeout(() => { buffer = ''; }, 800);
        break;

      default:
        // Handle multi-key shortcuts (g + letter)
        if (buffer === 'g' && /^[hasdi]$/.test(e.key)) {
          e.preventDefault();
          buffer += e.key;
          clearTimeout(bufferTimer);
          processBuffer();
        } else {
          buffer = '';
          clearTimeout(bufferTimer);
        }
        break;
    }
  });

  // Expose API
  window.shortcuts = {
    showHelp,
    hideHelp,
  };

})();
