const tabButtons = Array.from(document.querySelectorAll('.settings-tab'));
const tabPanels = Array.from(document.querySelectorAll('.settings-panel'));

function setActiveTab(tabName) {
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
  });
  tabPanels.forEach((panel) => {
    const isActive = panel.dataset.tab === tabName;
    panel.classList.toggle('active', isActive);
  });
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    setActiveTab(btn.dataset.tab);
  });
});

setActiveTab('rss');

let rssSources = [];

// Load RSS sources on page load
loadRSSSources();

async function loadRSSSources() {
  try {
    const res = await fetch('/api/rss-sources', { cache: 'no-store' });
    if (!res.ok) throw new Error('加载失败');
    const data = await res.json();
    rssSources = data.sources || [];
    console.log('Loaded RSS sources:', rssSources);
    console.log('Source with id=1:', rssSources.find(s => s.id === 1));
    renderTable();
  } catch (err) {
    console.error('Failed to load RSS sources:', err);
  }
}

function renderTable() {
  const tbody = document.getElementById('rssSourcesBody');
  const emptyState = document.getElementById('emptyState');
  const table = document.getElementById('rssSourcesTable');

  if (rssSources.length === 0) {
    table.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  table.style.display = 'table';
  emptyState.style.display = 'none';

  const sourceTypeLabels = {
    'journal': '期刊',
    'blog': '博客',
    'news': '资讯'
  };

  console.log('Rendering table with sources:', rssSources);

  tbody.innerHTML = rssSources.map(function(source) {
    const typeLabel = sourceTypeLabels[source.source_type] || '博客';
    console.log(`Source ${source.id}: source_type=${source.source_type}, label=${typeLabel}`);
    return '<tr>' +
      '<td class="rss-name">' + escapeHtml(source.name) + '</td>' +
      '<td class="rss-url">' +
        '<a href="' + escapeHtml(source.url) + '" target="_blank" rel="noopener" title="' + escapeHtml(source.url) + '">' +
          escapeHtml(truncate(source.url, 35)) +
        '</a>' +
      '</td>' +
      '<td><span class="type-badge">' + typeLabel + '</span></td>' +
      '<td>' +
        '<span class="status-badge ' + source.status + '">' + (source.status === 'active' ? '启用' : '禁用') + '</span>' +
      '</td>' +
      '<td>' + formatInterval(source.fetch_interval) + '</td>' +
      '<td>' + formatDate(source.last_fetched_at) + '</td>' +
      '<td>' +
        '<div class="action-buttons">' +
          '<button class="btn-icon" onclick="editSource(' + source.id + ')">编辑</button>' +
          '<button class="btn-icon" onclick="fetchNow(' + source.id + ')">抓取</button>' +
          '<button class="btn-icon" onclick="deleteSource(' + source.id + ')">删除</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function showAddModal() {
  document.getElementById('modalTitle').textContent = '添加 RSS 订阅源';
  document.getElementById('sourceId').value = '';
  document.getElementById('sourceName').value = '';
  document.getElementById('sourceUrl').value = '';
  document.getElementById('sourceType').value = 'blog';
  document.getElementById('fetchInterval').value = '3600';
  document.getElementById('sourceStatus').value = 'active';
  document.getElementById('validationResult').className = 'validation-result';
  document.getElementById('validationResult').textContent = '';
  document.getElementById('sourceModal').classList.add('active');
  document.getElementById('sourceName').focus();
}

function editSource(id) {
  const source = rssSources.find(s => s.id === id);
  if (!source) return;

  console.log('Editing source:', source);
  console.log('source.source_type:', source.source_type);

  document.getElementById('modalTitle').textContent = '编辑 RSS 订阅源';
  document.getElementById('sourceId').value = source.id;
  document.getElementById('sourceName').value = source.name;
  document.getElementById('sourceUrl').value = source.url;
  document.getElementById('sourceType').value = source.source_type || 'blog';
  document.getElementById('fetchInterval').value = source.fetch_interval.toString();
  document.getElementById('sourceStatus').value = source.status;
  document.getElementById('validationResult').className = 'validation-result';
  document.getElementById('validationResult').textContent = '';
  document.getElementById('sourceModal').classList.add('active');

  console.log('Set sourceType value to:', source.source_type || 'blog');
  console.log('Current sourceType element value:', document.getElementById('sourceType').value);
}

function closeModal() {
  document.getElementById('sourceModal').classList.remove('active');
}

// URL validation
let validationTimeout;
document.getElementById('sourceUrl').addEventListener('input', function() {
  clearTimeout(validationTimeout);
  const url = this.value.trim();
  const resultDiv = document.getElementById('validationResult');

  if (!url || !url.startsWith('http')) {
    resultDiv.className = 'validation-result';
    resultDiv.textContent = '';
    return;
  }

  validationTimeout = setTimeout(async () => {
    resultDiv.className = 'validation-result checking';
    resultDiv.textContent = '正在验证...';

    try {
      const res = await fetch('/api/rss-sources/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await res.json();

      if (data.valid) {
        resultDiv.className = 'validation-result valid';
        resultDiv.textContent = '✓ ' + (data.feedTitle || '有效 RSS 源') + ' (' + (data.itemCount || 0) + ' 条目)';
      } else {
        resultDiv.className = 'validation-result invalid';
        resultDiv.textContent = '✗ ' + (data.error || '无法验证 RSS 源');
      }
    } catch (err) {
      resultDiv.className = 'validation-result invalid';
      resultDiv.textContent = '✗ 验证失败，请稍后重试';
    }
  }, 500);
});

// Form submit
document.getElementById('sourceForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  const id = document.getElementById('sourceId').value;
  const data = {
    name: document.getElementById('sourceName').value.trim(),
    url: document.getElementById('sourceUrl').value.trim(),
    sourceType: document.getElementById('sourceType').value,
    fetchInterval: parseInt(document.getElementById('fetchInterval').value),
    status: document.getElementById('sourceStatus').value
  };

  // Debug logging
  console.log('Form submit data:', data);
  console.log('sourceType value:', data.sourceType);
  console.log('sourceType element value:', document.getElementById('sourceType').value);

  try {
    const url = id ? '/api/rss-sources/' + id : '/api/rss-sources';
    const method = id ? 'PUT' : 'POST';

    console.log('Sending request:', method, url);
    console.log('Request body:', JSON.stringify(data));

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    console.log('Response status:', res.status);

    if (res.ok) {
      console.log('Update successful, reloading sources...');
      closeModal();
      await loadRSSSources();
      console.log('Sources reloaded');
      // Show success message
      await showConfirm('RSS 源已更新', {
        title: '成功',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
    } else {
      const result = await res.json();
      console.log('Update failed:', result);
      await showConfirm(result.error || '保存失败', {
        title: '错误',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
    }
  } catch (err) {
    console.log('Update error:', err);
    await showConfirm('保存失败，请稍后重试', {
      title: '错误',
      okText: '知道了',
      okButtonType: 'btn-secondary'
    });
  }
});

async function deleteSource(id) {
  const confirmed = await showConfirm('确定要删除这个 RSS 订阅源吗？', {
    title: '删除订阅源',
    okText: '删除',
    cancelText: '取消'
  });
  if (!confirmed) return;

  try {
    const res = await fetch('/api/rss-sources/' + id, { method: 'DELETE' });
    if (res.ok) {
      loadRSSSources();
    } else {
      const result = await res.json();
      await showConfirm(result.error || '删除失败', {
        title: '错误',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
    }
  } catch (err) {
    await showConfirm('删除失败，请稍后重试', {
      title: '错误',
      okText: '知道了',
      okButtonType: 'btn-secondary'
    });
  }
}

async function fetchNow(id) {
  try {
    const res = await fetch('/api/rss-sources/' + id + '/fetch', { method: 'POST' });
    const result = await res.json();
    await showConfirm(result.message || '抓取任务已加入队列', {
      title: '抓取 RSS',
      okText: '知道了',
      okButtonType: 'btn-secondary'
    });
  } catch (err) {
    await showConfirm('操作失败，请稍后重试', {
      title: '错误',
      okText: '知道了',
      okButtonType: 'btn-secondary'
    });
  }
}

// Utility functions
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, len) {
  if (!str) return '';
  if (str.length <= len) return str;
  return str.substring(0, len - 3) + '...';
}

function formatInterval(seconds) {
  if (seconds < 3600) return Math.floor(seconds / 60) + ' 分钟';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' 小时';
  return Math.floor(seconds / 86400) + ' 天';
}

function formatDate(dateStr) {
  if (!dateStr) return '从未';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';

  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Close modal on overlay click
document.getElementById('sourceModal').addEventListener('click', function(e) {
  if (e.target === this) {
    closeModal();
  }
});

// Close modal on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeModal();
    closeLLMModal();
    closePromptModal();
  }
});

let llmConfigs = [];
let systemPrompts = [];

const DEFAULT_PROMPT_VARIABLES = {
  TOPIC_DOMAINS: '主题领域列表（从 topic_domains 和 topic_keywords 表动态构建）',
  ARTICLE_TITLE: '文章标题',
  ARTICLE_URL: '文章链接',
  ARTICLE_CONTENT: '正文内容（截取前 2000 字符）',
  SOURCE_TYPE: 'RSS 源类型（journal/blog/news）',
  ARTICLES_LIST: '文章列表（标题、摘要、来源）- 用于 daily_summary 类型',
  DATE_RANGE: '日期范围（YYYY-MM-DD 格式）- 用于 daily_summary 类型',
  SUMMARY_LENGTH: '期望的摘要长度（默认 800-1000 字）- 用于 daily_summary 类型'
};

function getDefaultPromptVariablesJSON() {
  return JSON.stringify(DEFAULT_PROMPT_VARIABLES, null, 2);
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
  // Load data on page load
  loadLLMConfigs();
  loadSystemPrompts();
  loadPromptVariables();
});

async function loadLLMConfigs() {
  try {
    const res = await fetch('/api/llm-configs', { cache: 'no-store' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error('LLM configs API error:', res.status, errData);
      throw new Error(errData.error || '加载失败');
    }
    const data = await res.json();
    console.log('LLM configs loaded:', data);
    llmConfigs = data.configs || [];
    renderLLMTable();
  } catch (err) {
    console.error('Failed to load LLM configs:', err);
    const tbody = document.getElementById('llmConfigsBody');
    const emptyState = document.getElementById('llmEmptyState');
    const table = document.getElementById('llmConfigsTable');
    table.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.innerHTML = '<p style="color: var(--red);">加载失败: ' + (err instanceof Error ? err.message : '未知错误') + '</p>';
  }
}

function renderLLMTable() {
  const tbody = document.getElementById('llmConfigsBody');
  const emptyState = document.getElementById('llmEmptyState');
  const table = document.getElementById('llmConfigsTable');

  if (llmConfigs.length === 0) {
    table.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  table.style.display = 'table';
  emptyState.style.display = 'none';

  tbody.innerHTML = llmConfigs.map(function(config) {
    return '<tr>' +
      '<td>' +
        '<div class="llm-provider">' +
          '<span class="provider-badge ' + config.provider + '">' + config.provider + '</span>' +
          (config.is_default ? '<span class="default-badge">默认</span>' : '') +
        '</div>' +
      '</td>' +
      '<td><span class="type-badge">' + (config.config_type || 'llm') + '</span></td>' +
      '<td><span class="llm-model">' + escapeHtml(config.model) + '</span></td>' +
      '<td><span class="rss-url">' + escapeHtml(truncate(config.base_url, 35)) + '</span></td>' +
      '<td>' + escapeHtml(String(config.priority ?? 100)) + '</td>' +
      '<td>' +
        (config.config_type === 'rerank'
          ? (config.enabled ? '<span class="status-badge active">已启用</span>' : '<span class="status-badge inactive">未启用</span>')
          : '<span class="status-badge active">已启用</span>'
        ) +
      '</td>' +
      '<td>' +
        '<div class="action-buttons">' +
          (!config.is_default ? '<button class="btn-icon" onclick="setDefaultLLMConfig(' + config.id + ')">设为默认</button>' : '') +
          '<button class="btn-icon" onclick="editLLMConfig(' + config.id + ')">编辑</button>' +
          '<button class="btn-icon" onclick="deleteLLMConfig(' + config.id + ')">删除</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function showLLMAddModal() {
  document.getElementById('llmModalTitle').textContent = '添加 LLM 配置';
  document.getElementById('llmConfigId').value = '';
  document.getElementById('llmConfigType').value = 'llm';
  document.getElementById('llmProvider').value = 'openai';
  document.getElementById('llmBaseURL').value = 'https://api.openai.com/v1';
  document.getElementById('llmApiKey').value = '';
  document.getElementById('llmModel').value = 'gpt-4o-mini';
  document.getElementById('llmTimeout').value = '30000';
  document.getElementById('llmMaxRetries').value = '3';
  document.getElementById('llmPriority').value = '100';
  document.getElementById('llmIsDefault').checked = llmConfigs.length === 0;
  document.getElementById('llmRerankEnabled').checked = false;
  document.getElementById('llmTestResult').className = 'test-result';
  document.getElementById('llmTestResult').textContent = '';
  updateConfigTypeUI();
  document.getElementById('llmConfigModal').classList.add('active');
  document.getElementById('llmConfigType').focus();
}

function editLLMConfig(id) {
  const config = llmConfigs.find(c => c.id === id);
  if (!config) return;

  document.getElementById('llmModalTitle').textContent = '编辑 LLM 配置';
  document.getElementById('llmConfigId').value = config.id;
  document.getElementById('llmConfigType').value = config.config_type || 'llm';
  document.getElementById('llmProvider').value = config.provider;
  document.getElementById('llmBaseURL').value = config.base_url;
  document.getElementById('llmApiKey').value = '';
  document.getElementById('llmModel').value = config.model;
  document.getElementById('llmTimeout').value = config.timeout;
  document.getElementById('llmMaxRetries').value = config.max_retries;
  document.getElementById('llmPriority').value = config.priority ?? 100;
  document.getElementById('llmIsDefault').checked = config.is_default === 1;
  document.getElementById('llmRerankEnabled').checked = config.enabled === 1;
  document.getElementById('llmTestResult').className = 'test-result';
  document.getElementById('llmTestResult').textContent = '';
  updateConfigTypeUI();
  document.getElementById('llmConfigModal').classList.add('active');
}

function closeLLMModal() {
  document.getElementById('llmConfigModal').classList.remove('active');
}

async function showPromptAddModal() {
  document.getElementById('promptModalTitle').textContent = '添加系统提示词';
  document.getElementById('systemPromptId').value = '';
  document.getElementById('promptName').value = '';
  document.getElementById('promptType').value = 'filter';
  document.getElementById('promptTemplate').value = '';
  document.getElementById('promptVariables').value = getDefaultPromptVariablesJSON();
  document.getElementById('promptActive').checked = true;
  document.getElementById('systemPromptModal').classList.add('active');
  document.getElementById('promptName').focus();
}

function editPrompt(id) {
  const prompt = systemPrompts.find((p) => p.id === id);
  if (!prompt) return;

  document.getElementById('promptModalTitle').textContent = '编辑系统提示词';
  document.getElementById('systemPromptId').value = prompt.id;
  document.getElementById('promptName').value = prompt.name || '';
  document.getElementById('promptType').value = prompt.type || 'filter';
  document.getElementById('promptTemplate').value = prompt.template || '';
  document.getElementById('promptActive').checked = prompt.is_active === 1;

  if (prompt.variables) {
    try {
      const parsed = JSON.parse(prompt.variables);
      document.getElementById('promptVariables').value = JSON.stringify(parsed, null, 2);
    } catch (err) {
      document.getElementById('promptVariables').value = prompt.variables;
    }
  } else {
    document.getElementById('promptVariables').value = getDefaultPromptVariablesJSON();
  }

  document.getElementById('systemPromptModal').classList.add('active');
}

function closePromptModal() {
  document.getElementById('systemPromptModal').classList.remove('active');
}


async function bootstrapSystemPrompts() {
  const confirmed = await showConfirm('将为当前用户初始化默认提示词（缺失的类型会自动补全）。继续？', {
    title: '初始化默认模板',
    okText: '初始化',
    cancelText: '取消'
  });
  if (!confirmed) return;

  try {
    const res = await fetch('/api/system-prompts/bootstrap', { method: 'POST' });
    if (res.ok) {
      const result = await res.json();
      await showConfirm(
        '初始化完成：新增 ' + (result.created || 0) + ' 条，跳过 ' + (result.skipped || 0) + ' 条。',
        { title: '完成', okText: '知道了', okButtonType: 'btn-secondary' }
      );
      loadSystemPrompts();
    } else {
      const errData = await res.json().catch(() => ({}));
      await showConfirm(errData.error || '初始化失败', {
        title: '错误',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
    }
  } catch (err) {
    await showConfirm('初始化失败，请稍后重试', {
      title: '错误',
      okText: '知道了',
      okButtonType: 'btn-secondary'
    });
  }
}

async function loadSystemPrompts() {
  try {
    const res = await fetch('/api/system-prompts', { cache: 'no-store' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error('System prompts API error:', res.status, errData);
      throw new Error(errData.error || '加载失败');
    }
    const data = await res.json();
    console.log('System prompts loaded:', data);
    systemPrompts = data.prompts || [];
    renderSystemPromptsTable();
  } catch (err) {
    console.error('Failed to load system prompts:', err);
    const tbody = document.getElementById('systemPromptsBody');
    const emptyState = document.getElementById('systemPromptsEmpty');
    const table = document.getElementById('systemPromptsTable');
    table.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.innerHTML = '<p style="color: var(--red);">加载失败: ' + (err instanceof Error ? err.message : '未知错误') + '</p>';
  }
}

/**
 * 从 API 加载变量定义并动态渲染到页面
 */
async function loadPromptVariables() {
  try {
    const res = await fetch('/api/system-prompts/variables', { cache: 'no-store' });
    if (!res.ok) {
      console.warn('Failed to load prompt variables, using fallback');
      return;
    }
    const data = await res.json();
    console.log('Prompt variables loaded:', data);
    renderPromptVariables(data.variables || {});
  } catch (err) {
    console.error('Failed to load prompt variables:', err);
  }
}

/**
 * 动态渲染变量说明表格
 */
function renderPromptVariables(variables) {
  const tableBody = document.getElementById('promptVariablesTableBody');
  if (!tableBody) return;

  // 按类型分组收集所有变量
  const allVariables = new Map();

  for (const [type, typeVars] of Object.entries(variables)) {
    for (const [varName, varInfo] of Object.entries(typeVars)) {
      if (!allVariables.has(varName)) {
        allVariables.set(varName, varInfo);
      }
    }
  }

  // 渲染表格
  let html = '';
  for (const [varName, varInfo] of allVariables) {
    const description = typeof varInfo === 'object' ? varInfo.description : varInfo;
    html += `<tr><td><code>{{${varName}}}</code></td><td>${escapeHtml(description)}</td></tr>`;
  }

  tableBody.innerHTML = html || '<tr><td colspan="2">暂无变量定义</td></tr>';
}

/**
 * HTML 转义，防止 XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderSystemPromptsTable() {
  const tbody = document.getElementById('systemPromptsBody');
  const emptyState = document.getElementById('systemPromptsEmpty');
  const table = document.getElementById('systemPromptsTable');

  if (systemPrompts.length === 0) {
    table.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  table.style.display = 'table';
  emptyState.style.display = 'none';

  tbody.innerHTML = systemPrompts.map(function(prompt) {
    return '<tr>' +
      '<td>' + escapeHtml(prompt.name || '') + '</td>' +
      '<td><span class="type-badge">' + escapeHtml(prompt.type || '') + '</span></td>' +
      '<td>' +
        '<span class="status-badge ' + (prompt.is_active === 1 ? 'active' : 'inactive') + '">' +
          (prompt.is_active === 1 ? '启用' : '禁用') +
        '</span>' +
      '</td>' +
      '<td>' + formatDate(prompt.updated_at) + '</td>' +
      '<td>' +
        '<div class="action-buttons">' +
          '<button class="btn-icon" onclick="toggleSystemPromptActive(' + prompt.id + ', ' + (prompt.is_active === 1 ? 'false' : 'true') + ')">' +
            (prompt.is_active === 1 ? '禁用' : '启用') +
          '</button>' +
          '<button class="btn-icon" onclick="editPrompt(' + prompt.id + ')">编辑</button>' +
          '<button class="btn-icon" onclick="deleteSystemPrompt(' + prompt.id + ')">删除</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }).join('');
}

document.getElementById('systemPromptForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  const id = document.getElementById('systemPromptId').value;
  const variablesInput = document.getElementById('promptVariables').value.trim();
  if (variablesInput) {
    try {
      JSON.parse(variablesInput);
    } catch (err) {
      await showConfirm('变量必须是合法的 JSON', {
        title: '错误',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
      return;
    }
  }

  const payload = {
    name: document.getElementById('promptName').value.trim(),
    type: document.getElementById('promptType').value.trim(),
    template: document.getElementById('promptTemplate').value,
    variables: variablesInput || null,
    isActive: document.getElementById('promptActive').checked,
  };

  try {
    const url = id ? '/api/system-prompts/' + id : '/api/system-prompts';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      closePromptModal();
      loadSystemPrompts();
    } else {
      const result = await res.json();
      await showConfirm(result.error || '保存失败', {
        title: '错误',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
    }
  } catch (err) {
    await showConfirm('保存失败，请稍后重试', {
      title: '错误',
      okText: '知道了',
      okButtonType: 'btn-secondary'
    });
  }
});

async function toggleSystemPromptActive(id, isActive) {
  try {
    const res = await fetch('/api/system-prompts/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive }),
    });

    if (res.ok) {
      loadSystemPrompts();
    } else {
      const result = await res.json();
      await showConfirm(result.error || '更新失败', {
        title: '错误',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
    }
  } catch (err) {
    await showConfirm('更新失败，请稍后重试', {
      title: '错误',
      okText: '知道了',
      okButtonType: 'btn-secondary'
    });
  }
}

async function deleteSystemPrompt(id) {
  const confirmed = await showConfirm('确定要删除这个系统提示词吗？', {
    title: '删除系统提示词',
    okText: '删除',
    cancelText: '取消'
  });
  if (!confirmed) return;

  try {
    const res = await fetch('/api/system-prompts/' + id, { method: 'DELETE' });
    if (res.ok) {
      loadSystemPrompts();
    } else {
      const result = await res.json();
      await showConfirm(result.error || '删除失败', {
        title: '错误',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
    }
  } catch (err) {
    await showConfirm('删除失败，请稍后重试', {
      title: '错误',
      okText: '知道了',
      okButtonType: 'btn-secondary'
    });
  }
}

document.getElementById('systemPromptModal').addEventListener('click', function(e) {
  if (e.target === this) {
    closePromptModal();
  }
});

function updateProviderDefaults() {
  const configType = document.getElementById('llmConfigType').value;
  const provider = document.getElementById('llmProvider').value;
  const baseURLInput = document.getElementById('llmBaseURL');
  const modelInput = document.getElementById('llmModel');

  switch (provider) {
    case 'openai':
      baseURLInput.value = 'https://api.openai.com/v1';
      if (configType === 'llm') {
        modelInput.value = 'gpt-4o-mini';
      }
      break;
    case 'gemini':
      baseURLInput.value = 'https://generativelanguage.googleapis.com/v1beta';
      if (configType === 'llm') {
        modelInput.value = 'gemini-1.5-flash';
      }
      break;
    case 'custom':
      baseURLInput.value = '';
      if (configType === 'llm') {
        modelInput.value = '';
      }
      break;
  }
}

function updateConfigTypeUI() {
  const configType = document.getElementById('llmConfigType').value;
  const rerankGroup = document.getElementById('rerankEnabledGroup');
  const rerankCheckbox = document.getElementById('llmRerankEnabled');

  if (configType === 'rerank') {
    rerankGroup.style.display = 'block';
  } else {
    rerankGroup.style.display = 'none';
    rerankCheckbox.checked = false;
  }
}

async function testLLMConnection() {
  const resultDiv = document.getElementById('llmTestResult');
  resultDiv.className = 'test-result testing';
  resultDiv.textContent = '正在测试连接...';

  const id = document.getElementById('llmConfigId').value;
  const data = {
    configType: document.getElementById('llmConfigType').value,
    provider: document.getElementById('llmProvider').value,
    baseURL: document.getElementById('llmBaseURL').value,
    apiKey: document.getElementById('llmApiKey').value,
    model: document.getElementById('llmModel').value,
    enabled: document.getElementById('llmRerankEnabled').checked,
  };

  try {
    let res;
    if (id) {
      // Test existing config
      res = await fetch('/api/llm-configs/' + id + '/test', { method: 'POST' });
    } else {
      // Create temporary config for testing
      res = await fetch('/api/llm-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          isDefault: false,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        const testRes = await fetch('/api/llm-configs/' + result.id + '/test', { method: 'POST' });
        // Clean up test config
        await fetch('/api/llm-configs/' + result.id, { method: 'DELETE' });

        const testData = await testRes.json();
        if (testData.success) {
          resultDiv.className = 'test-result success';
          resultDiv.textContent = '✓ 连接成功';
        } else {
          resultDiv.className = 'test-result error';
          resultDiv.textContent = '✗ 连接失败: ' + testData.error;
        }
        return;
      }
    }

    const testData = await res.json();
    if (testData.success) {
      resultDiv.className = 'test-result success';
      resultDiv.textContent = '✓ 连接成功';
    } else {
      resultDiv.className = 'test-result error';
      resultDiv.textContent = '✗ 连接失败: ' + testData.error;
    }
  } catch (err) {
    resultDiv.className = 'test-result error';
    resultDiv.textContent = '✗ 测试失败，请稍后重试';
  }
}

document.getElementById('llmConfigForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  const id = document.getElementById('llmConfigId').value;
  const data = {
    configType: document.getElementById('llmConfigType').value,
    provider: document.getElementById('llmProvider').value,
    baseURL: document.getElementById('llmBaseURL').value,
    apiKey: document.getElementById('llmApiKey').value,
    model: document.getElementById('llmModel').value,
    timeout: parseInt(document.getElementById('llmTimeout').value),
    maxRetries: parseInt(document.getElementById('llmMaxRetries').value),
    priority: parseInt(document.getElementById('llmPriority').value),
    isDefault: document.getElementById('llmIsDefault').checked,
    enabled: document.getElementById('llmRerankEnabled').checked,
  };

  try {
    const url = id ? '/api/llm-configs/' + id : '/api/llm-configs';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (res.ok) {
      closeLLMModal();
      loadLLMConfigs();
    } else {
      const result = await res.json();
      await showConfirm(result.error || '保存失败', {
        title: '错误',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
    }
  } catch (err) {
    await showConfirm('保存失败，请稍后重试', {
      title: '错误',
      okText: '知道了',
      okButtonType: 'btn-secondary'
    });
  }
});

async function deleteLLMConfig(id) {
  const confirmed = await showConfirm('确定要删除这个 LLM 配置吗？', {
    title: '删除 LLM 配置',
    okText: '删除',
    cancelText: '取消'
  });
  if (!confirmed) return;

  try {
    const res = await fetch('/api/llm-configs/' + id, { method: 'DELETE' });
    if (res.ok) {
      loadLLMConfigs();
    } else {
      const result = await res.json();
      await showConfirm(result.error || '删除失败', {
        title: '错误',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
    }
  } catch (err) {
    await showConfirm('删除失败，请稍后重试', {
      title: '错误',
      okText: '知道了',
      okButtonType: 'btn-secondary'
    });
  }
}

async function setDefaultLLMConfig(id) {
  try {
    const res = await fetch('/api/llm-configs/' + id + '/set-default', { method: 'POST' });
    if (res.ok) {
      loadLLMConfigs();
    } else {
      const result = await res.json();
      await showConfirm(result.error || '设置失败', {
        title: '错误',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
    }
  } catch (err) {
    await showConfirm('设置失败，请稍后重试', {
      title: '错误',
      okText: '知道了',
      okButtonType: 'btn-secondary'
    });
  }
}

document.getElementById('llmConfigModal').addEventListener('click', function(e) {
  if (e.target === this) {
    closeLLMModal();
  }
});

// Chroma settings
loadChromaSettings();

async function loadChromaSettings() {
  try {
    const res = await fetch('/api/settings/chroma', { cache: 'no-store' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error('Chroma settings API error:', res.status, errData);
      throw new Error(errData.error || '加载失败');
    }
    const data = await res.json();
    console.log('Chroma settings loaded:', data);
    document.getElementById('chromaHost').value = data.host || '127.0.0.1';
    document.getElementById('chromaPort').value = data.port || 8000;
    document.getElementById('chromaCollection').value = data.collection || 'articles';
    document.getElementById('chromaMetric').value = data.distanceMetric || 'cosine';
    setChromaStatus('');
  } catch (err) {
    console.error('Failed to load Chroma settings:', err);
    setChromaStatus('加载失败: ' + (err instanceof Error ? err.message : '未知错误'));
  }
}

function setChromaStatus(message) {
  const el = document.getElementById('chromaStatus');
  el.textContent = message || '';
}

document.getElementById('chromaForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  const payload = {
    host: document.getElementById('chromaHost').value.trim(),
    port: parseInt(document.getElementById('chromaPort').value),
    collection: document.getElementById('chromaCollection').value.trim(),
    distanceMetric: document.getElementById('chromaMetric').value,
  };

  try {
    const res = await fetch('/api/settings/chroma', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setChromaStatus('设置已保存');
    } else {
      const result = await res.json();
      setChromaStatus(result.error || '保存失败');
    }
  } catch (err) {
    setChromaStatus('保存失败，请稍后重试');
  }
});
