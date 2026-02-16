// ============================================
// TOAST NOTIFICATION COMPONENT
// ============================================

(function() {
  'use strict';

  let container = null;
  let activeToasts = [];

  // Icons
  const icons = {
    success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>`,
    error: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="15" y1="9" x2="9" y2="15"></line>
      <line x1="9" y1="9" x2="15" y2="15"></line>
    </svg>`,
    info: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>`
  };

  // Create container if not exists
  function ensureContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
  }

  // Show toast notification
  function toast(message, type = 'info', duration = 3000) {
    ensureContainer();

    const toastEl = document.createElement('div');
    toastEl.className = `toast toast-${type}`;
    toastEl.innerHTML = `
      ${icons[type] || icons.info}
      <span class="toast-message">${escapeHtml(message)}</span>
    `;

    container.appendChild(toastEl);
    activeToasts.push(toastEl);

    // Trigger animation
    requestAnimationFrame(() => {
      toastEl.classList.add('show');
    });

    // Auto dismiss
    setTimeout(() => {
      dismiss(toastEl);
    }, duration);

    return toastEl;
  }

  // Dismiss toast
  function dismiss(toastEl) {
    if (!toastEl || !toastEl.parentNode) return;

    toastEl.classList.remove('show');

    setTimeout(() => {
      if (toastEl.parentNode) {
        toastEl.parentNode.removeChild(toastEl);
      }
      activeToasts = activeToasts.filter(t => t !== toastEl);
    }, 300);
  }

  // Dismiss all toasts
  function dismissAll() {
    activeToasts.forEach(dismiss);
    activeToasts = [];
  }

  // Utility function to escape HTML
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Export API
  window.toast = {
    show: toast,
    success: (message, duration) => toast(message, 'success', duration),
    error: (message, duration) => toast(message, 'error', duration),
    info: (message, duration) => toast(message, 'info', duration),
    dismiss,
    dismissAll
  };

})();
