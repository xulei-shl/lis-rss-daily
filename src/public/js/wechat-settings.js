// 企业微信设置 - 前端 JavaScript
let wechatWebhooks = [];

// 页面加载时自动加载 webhook 列表
document.addEventListener('DOMContentLoaded', function() {
  loadWeChatWebhooks();
});

/**
 * 加载企业微信 Webhooks
 */
async function loadWeChatWebhooks() {
  try {
    const res = await fetch('/api/wechat/webhooks', { cache: 'no-store' });
    if (!res.ok) throw new Error('加载失败');
    wechatWebhooks = await res.json();
    renderWeChatWebhooks();
  } catch (err) {
    console.error('Failed to load WeChat webhooks:', err);
    showWeChatStatus('加载失败: ' + (err.message || '未知错误'), 'error');
  }
}

/**
 * 渲染 Webhook 列表
 */
function renderWeChatWebhooks() {
  const listEl = document.getElementById('wechatWebhooksList');
  const emptyEl = document.getElementById('wechatWebhooksEmpty');

  if (!wechatWebhooks || wechatWebhooks.length === 0) {
    listEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  listEl.style.display = 'flex';
  emptyEl.style.display = 'none';

  listEl.innerHTML = wechatWebhooks.map(function(webhook) {
    const pushTypeTags = [];
    if (webhook.push_types?.daily_summary) {
      pushTypeTags.push('<span class="wechat-webhook-tag daily-summary">每日总结</span>');
    } else if (webhook.push_types?.daily_summary !== undefined) {
      pushTypeTags.push('<span class="wechat-webhook-tag daily-summary disabled">每日总结</span>');
    }
    if (webhook.push_types?.journal_all) {
      pushTypeTags.push('<span class="wechat-webhook-tag journal-all">全部期刊</span>');
    } else if (webhook.push_types?.journal_all !== undefined) {
      pushTypeTags.push('<span class="wechat-webhook-tag journal-all disabled">全部期刊</span>');
    }
    if (webhook.push_types?.new_articles) {
      pushTypeTags.push('<span class="wechat-webhook-tag new-articles">新增文章</span>');
    } else if (webhook.push_types?.new_articles !== undefined) {
      pushTypeTags.push('<span class="wechat-webhook-tag new-articles disabled">新增文章</span>');
    }

    const statusClass = webhook.enabled ? '' : 'inactive';

    return '<div class="wechat-webhook-item ' + statusClass + '">' +
      '<div class="wechat-webhook-info">' +
        '<div class="wechat-webhook-name">' + escapeHtml(webhook.name) + '</div>' +
        '<div class="wechat-webhook-url">' + escapeHtml(truncateUrl(webhook.url)) + '</div>' +
        '<div class="wechat-webhook-details">' +
          '<div class="wechat-webhook-tags">' + pushTypeTags.join('') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="wechat-webhook-actions">' +
        '<button class="btn-icon" onclick="testWeChatWebhook(\'' + escapeHtml(webhook.id) + '\')">测试</button>' +
        '<button class="btn-icon" onclick="editWeChatWebhook(\'' + escapeHtml(webhook.id) + '\')">编辑</button>' +
        '<button class="btn-icon" onclick="deleteWeChatWebhook(\'' + escapeHtml(webhook.id) + '\')">删除</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

/**
 * 截断 URL 显示
 */
function truncateUrl(url) {
  if (!url) return '';
  if (url.length <= 50) return url;
  return url.substring(0, 50) + '...';
}

/**
 * 打开添加 Webhook 模态框
 */
function openWeChatWebhookModal(webhookId) {
  const modal = document.getElementById('wechatWebhookModal');
  const title = document.getElementById('wechatWebhookModalTitle');
  const form = document.getElementById('wechatWebhookForm');

  form.reset();

  if (webhookId) {
    const webhook = wechatWebhooks.find(w => w.id === webhookId);
    if (!webhook) return;

    title.textContent = '编辑 Webhook';
    document.getElementById('wechatWebhookId').value = webhook.id;
    document.getElementById('wechatWebhookName').value = webhook.name;
    document.getElementById('wechatWebhookUrl').value = webhook.url;
    document.getElementById('wechatWebhookDailySummary').checked = webhook.push_types?.daily_summary !== false;
    document.getElementById('wechatWebhookJournalAll').checked = webhook.push_types?.journal_all !== false;
    document.getElementById('wechatWebhookNewArticles').checked = webhook.push_types?.new_articles !== false;
    document.getElementById('wechatWebhookEnabled').checked = webhook.enabled;
  } else {
    title.textContent = '添加 Webhook';
    document.getElementById('wechatWebhookId').value = '';
    document.getElementById('wechatWebhookDailySummary').checked = true;
    document.getElementById('wechatWebhookJournalAll').checked = true;
    document.getElementById('wechatWebhookNewArticles').checked = true;
    document.getElementById('wechatWebhookEnabled').checked = true;
  }

  modal.classList.add('active');
}

/**
 * 关闭模态框
 */
function closeWeChatWebhookModal() {
  document.getElementById('wechatWebhookModal').classList.remove('active');
}

/**
 * 编辑 Webhook
 */
function editWeChatWebhook(id) {
  openWeChatWebhookModal(id);
}

/**
 * 删除 Webhook
 */
async function deleteWeChatWebhook(id) {
  if (!confirm('确定要删除这个 Webhook 吗？')) return;

  try {
    const res = await fetch('/api/wechat/webhooks/' + id, {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error('删除失败');

    showWeChatStatus('删除成功', 'success');
    loadWeChatWebhooks();
  } catch (err) {
    console.error('Failed to delete WeChat webhook:', err);
    showWeChatStatus('删除失败: ' + (err.message || '未知错误'), 'error');
  }
}

/**
 * 测试 Webhook
 */
async function testWeChatWebhook(id) {
  try {
    const res = await fetch('/api/wechat/webhooks/' + id + '/test', {
      method: 'POST'
    });

    if (!res.ok) throw new Error('测试失败');

    const result = await res.json();
    if (result.success) {
      showWeChatStatus(result.message, 'success');
    } else {
      showWeChatStatus(result.message, 'error');
    }
  } catch (err) {
    console.error('Failed to test WeChat webhook:', err);
    showWeChatStatus('测试失败: ' + (err.message || '未知错误'), 'error');
  }
}

/**
 * 显示状态消息
 */
function showWeChatStatus(message, type) {
  const statusEl = document.getElementById('wechatStatus');
  statusEl.textContent = message;
  statusEl.className = 'wechat-status ' + type;
  statusEl.style.display = 'block';

  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 3000);
}

/**
 * 添加按钮点击事件
 */
document.addEventListener('DOMContentLoaded', function() {
  // 添加按钮
  const addBtn = document.getElementById('addWeChatWebhookBtn');
  if (addBtn) {
    addBtn.addEventListener('click', function() {
      openWeChatWebhookModal();
    });
  }

  // 表单提交
  const form = document.getElementById('wechatWebhookForm');
  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();

      const id = document.getElementById('wechatWebhookId').value;
      const name = document.getElementById('wechatWebhookName').value.trim();
      const url = document.getElementById('wechatWebhookUrl').value.trim();
      const enabled = document.getElementById('wechatWebhookEnabled').checked;
      const daily_summary = document.getElementById('wechatWebhookDailySummary').checked;
      const journal_all = document.getElementById('wechatWebhookJournalAll').checked;
      const new_articles = document.getElementById('wechatWebhookNewArticles').checked;

      try {
        const body = {
          name,
          url,
          enabled,
          push_types: {
            daily_summary,
            journal_all,
            new_articles
          }
        };

        let res;
        if (id) {
          res = await fetch('/api/wechat/webhooks/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
        } else {
          res = await fetch('/api/wechat/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
        }

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '保存失败');
        }

        showWeChatStatus(id ? '更新成功' : '添加成功', 'success');
        closeWeChatWebhookModal();
        loadWeChatWebhooks();
      } catch (err) {
        console.error('Failed to save WeChat webhook:', err);
        showWeChatStatus('保存失败: ' + (err.message || '未知错误'), 'error');
      }
    });
  }
});

/**
 * 点击模态框外部关闭
 */
document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('wechatWebhookModal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closeWeChatWebhookModal();
      }
    });
  }
});
