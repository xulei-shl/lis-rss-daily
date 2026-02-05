// ============================================
// UNIFIED CONFIRM DIALOG COMPONENT
// ============================================

let confirmDialog = null;
let confirmResolve = null;

// Initialize confirm dialog on page load
document.addEventListener('DOMContentLoaded', function() {
  // Create confirm dialog element
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'confirmDialog';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3 id="confirmDialogTitle">确认</h3>
        <button class="modal-close" onclick="closeConfirmDialog(false)">&times;</button>
      </div>
      <div class="modal-body">
        <p id="confirmDialogMessage"></p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="closeConfirmDialog(false)">取消</button>
        <button type="button" class="btn btn-danger" id="confirmDialogOk">确认</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  confirmDialog = overlay;

  // Close on overlay click
  overlay.addEventListener('click', function(e) {
    if (e.target === this) {
      closeConfirmDialog(false);
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && confirmDialog && confirmDialog.classList.contains('active')) {
      closeConfirmDialog(false);
    }
  });

  // OK button click
  document.getElementById('confirmDialogOk').addEventListener('click', function() {
    closeConfirmDialog(true);
  });
});

/**
 * Show a confirmation dialog
 * @param {string} message - The confirmation message
 * @param {Object} options - Optional settings
 * @param {string} options.title - Dialog title (default: '确认')
 * @param {string} options.okText - OK button text (default: '确认')
 * @param {string} options.cancelText - Cancel button text (default: '取消')
 * @param {string} options.okButtonType - OK button type (default: 'btn-danger')
 * @returns {Promise<boolean>} - Resolves to true if confirmed, false otherwise
 */
function showConfirm(message, options = {}) {
  return new Promise((resolve) => {
    if (!confirmDialog) {
      // Fallback to native confirm if dialog not ready
      resolve(window.confirm(message));
      return;
    }

    confirmResolve = resolve;

    // Set content
    document.getElementById('confirmDialogTitle').textContent = options.title || '确认';
    document.getElementById('confirmDialogMessage').textContent = message;

    // Configure buttons
    const okBtn = document.getElementById('confirmDialogOk');
    okBtn.textContent = options.okText || '确认';
    okBtn.className = `btn ${options.okButtonType || 'btn-danger'}`;

    const cancelBtn = confirmDialog.querySelector('.modal-footer .btn-secondary');
    if (cancelBtn) {
      cancelBtn.textContent = options.cancelText || '取消';
    }

    // Show dialog
    confirmDialog.classList.add('active');
  });
}

/**
 * Close the confirm dialog
 * @param {boolean} confirmed - Whether user confirmed
 */
function closeConfirmDialog(confirmed) {
  if (confirmDialog) {
    confirmDialog.classList.remove('active');
  }

  if (confirmResolve) {
    confirmResolve(confirmed);
    confirmResolve = null;
  }
}
