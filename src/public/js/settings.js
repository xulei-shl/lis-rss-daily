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
let rssPagination = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0
};

// 类型定义缓存
let typeDefinitions = null;

// 加载类型定义（从 YAML 配置）
async function loadTypeDefinitions() {
  try {
    const res = await fetch('/api/types', { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load types');
    typeDefinitions = await res.json();
    populateTypeSelects();
  } catch (err) {
    console.error('加载类型定义失败:', err);
    populateFallbackTypeOptions();
  }
}

// 填充类型选择框
function populateTypeSelects() {
  if (!typeDefinitions) return;

  // 填充源类型
  const sourceTypeSelect = document.getElementById('sourceType');
  if (sourceTypeSelect) {
    sourceTypeSelect.innerHTML = '';
    typeDefinitions.source_types.forEach(type => {
      const option = document.createElement('option');
      option.value = type.code;
      option.textContent = type.label;
      if (type.default) option.selected = true;
      sourceTypeSelect.appendChild(option);
    });
  }

  // 填充任务类型（LLM 配置）
  const taskTypeSelect = document.getElementById('llmTaskType');
  if (taskTypeSelect) {
    // 保留"通用配置"选项
    const defaultOption = taskTypeSelect.querySelector('option[value=""]');
    taskTypeSelect.innerHTML = '';
    if (defaultOption) taskTypeSelect.appendChild(defaultOption);

    typeDefinitions.task_types.forEach(type => {
      const option = document.createElement('option');
      option.value = type.code;
      option.textContent = `${type.code} - ${type.label}`;
      taskTypeSelect.appendChild(option);
    });
  }

  // 更新系统提示词类型选择
  const promptTypeSelect = document.getElementById('promptType');
  if (promptTypeSelect) {
    promptTypeSelect.innerHTML = '';
    typeDefinitions.task_types.forEach(type => {
      const option = document.createElement('option');
      option.value = type.code;
      option.textContent = type.code;
      promptTypeSelect.appendChild(option);
    });
  }
}

// 回退选项（API 失败时使用硬编码选项）
function populateFallbackTypeOptions() {
  console.warn('使用硬编码类型选项作为回退');

  // 回退源类型
  const sourceTypeSelect = document.getElementById('sourceType');
  if (sourceTypeSelect) {
    sourceTypeSelect.innerHTML = '';
    const sourceTypes = [
      { code: 'blog', label: '博客', default: true },
      { code: 'journal', label: '期刊', default: false },
      { code: 'news', label: '资讯', default: false }
    ];
    sourceTypes.forEach(type => {
      const option = document.createElement('option');
      option.value = type.code;
      option.textContent = type.label;
      if (type.default) option.selected = true;
      sourceTypeSelect.appendChild(option);
    });
  }

  // 回退任务类型
  const taskTypeSelect = document.getElementById('llmTaskType');
  if (taskTypeSelect) {
    const defaultOption = taskTypeSelect.querySelector('option[value=""]');
    taskTypeSelect.innerHTML = '';
    if (defaultOption) taskTypeSelect.appendChild(defaultOption);

    const taskTypes = ['filter', 'summary', 'keywords', 'translation', 'daily_summary', 'analysis'];
    const taskLabels = {
      'filter': '文章过滤',
      'summary': '文章摘要',
      'keywords': '关键词提取',
      'translation': '中英翻译',
      'daily_summary': '当日总结',
      'analysis': '文章分析'
    };
    taskTypes.forEach(code => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = `${code} - ${taskLabels[code]}`;
      taskTypeSelect.appendChild(option);
    });
  }

  // 回退提示词类型
  const promptTypeSelect = document.getElementById('promptType');
  if (promptTypeSelect) {
    promptTypeSelect.innerHTML = '';
    ['filter', 'summary', 'keywords', 'translation', 'daily_summary', 'analysis'].forEach(code => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = code;
      promptTypeSelect.appendChild(option);
    });
  }
}

// 获取源类型标签（用于表格显示）
function getSourceTypeLabel(sourceType) {
  if (typeDefinitions && typeDefinitions.source_types) {
    const type = typeDefinitions.source_types.find(t => t.code === sourceType);
    return type ? type.label : '博客';
  }
  // 回退到硬编码映射
  const labels = { 'journal': '期刊', 'blog': '博客', 'news': '资讯' };
  return labels[sourceType] || '博客';
}

// 获取默认源类型
function getDefaultSourceType() {
  if (typeDefinitions && typeDefinitions.source_types) {
    const defaultType = typeDefinitions.source_types.find(t => t.default);
    return defaultType ? defaultType.code : 'blog';
  }
  return 'blog';
}

// Load RSS sources on page load
loadRSSSources();

async function loadRSSSources(page = 1) {
  try {
    const res = await fetch(`/api/rss-sources?page=${page}&limit=${rssPagination.limit}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('加载失败');
    const data = await res.json();
    rssSources = data.sources || [];
    rssPagination.page = data.page || 1;
    rssPagination.total = data.total || 0;
    rssPagination.totalPages = data.totalPages || 0;
    console.log('Loaded RSS sources:', rssSources);
    console.log('Source with id=1:', rssSources.find(s => s.id === 1));
    renderTable();
    renderPagination('rss');
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

  console.log('Rendering table with sources:', rssSources);

  tbody.innerHTML = rssSources.map(function (source) {
    const typeLabel = getSourceTypeLabel(source.source_type);
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
  document.getElementById('sourceType').value = getDefaultSourceType();
  document.getElementById('fetchInterval').value = '3600';
  document.getElementById('sourceStatus').checked = true;
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
  document.getElementById('sourceStatus').checked = source.status === 'active';
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
document.getElementById('sourceUrl').addEventListener('input', function () {
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
document.getElementById('sourceForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const id = document.getElementById('sourceId').value;
  const data = {
    name: document.getElementById('sourceName').value.trim(),
    url: document.getElementById('sourceUrl').value.trim(),
    sourceType: document.getElementById('sourceType').value,
    fetchInterval: parseInt(document.getElementById('fetchInterval').value),
    status: document.getElementById('sourceStatus').checked ? 'active' : 'inactive'
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
      await loadRSSSources(rssPagination.page);
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
      // If current page is now empty (after delete), go to previous page
      const newPage = rssSources.length === 1 && rssPagination.page > 1
        ? rssPagination.page - 1
        : rssPagination.page;
      loadRSSSources(newPage);
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
  if (window.timeUtils && typeof window.timeUtils.formatRelativeTime === 'function') {
    return window.timeUtils.formatRelativeTime(dateStr);
  }
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

// Render pagination controls
function renderPagination(type) {
  const paginationMap = {
    'rss': rssPagination,
    'llm': llmPagination,
    'journals': journalsPagination
  };
  const pagination = paginationMap[type];
  if (!pagination) return;
  const container = document.getElementById(type + 'Pagination');
  if (!container) return;

  // Only show pagination if there's more than one page
  if (pagination.totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '<div class="pagination">';

  // Previous button
  if (pagination.page > 1) {
    html += `<a href="#" onclick="goToPage('${type}', ${pagination.page - 1}); return false;">&laquo; 上一页</a>`;
  } else {
    html += '<span class="disabled">&laquo; 上一页</span>';
  }

  // Page numbers (show max 5 pages)
  const startPage = Math.max(1, pagination.page - 2);
  const endPage = Math.min(pagination.totalPages, startPage + 4);

  // Always show first page
  if (startPage > 1) {
    html += `<a href="#" onclick="goToPage('${type}', 1); return false;">1</a>`;
    if (startPage > 2) {
      html += '<span>...</span>';
    }
  }

  // Page range
  for (let i = startPage; i <= endPage; i++) {
    if (i === pagination.page) {
      html += `<span class="current">${i}</span>`;
    } else {
      html += `<a href="#" onclick="goToPage('${type}', ${i}); return false;">${i}</a>`;
    }
  }

  // Always show last page
  if (endPage < pagination.totalPages) {
    if (endPage < pagination.totalPages - 1) {
      html += '<span>...</span>';
    }
    html += `<a href="#" onclick="goToPage('${type}', ${pagination.totalPages}); return false;">${pagination.totalPages}</a>`;
  }

  // Next button
  if (pagination.page < pagination.totalPages) {
    html += `<a href="#" onclick="goToPage('${type}', ${pagination.page + 1}); return false;">下一页 &raquo;</a>`;
  } else {
    html += '<span class="disabled">下一页 &raquo;</span>';
  }

  html += '</div>';
  container.innerHTML = html;
}

// Navigate to specific page
function goToPage(type, page) {
  if (type === 'rss') {
    loadRSSSources(page);
  } else if (type === 'llm') {
    loadLLMConfigs(page);
  }
}

// Close modal on overlay click
document.getElementById('sourceModal').addEventListener('click', function (e) {
  if (e.target === this) {
    closeModal();
  }
});

// Close modal on Escape key
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    closeModal();
    closeLLMModal();
    closePromptModal();
  }
});

let llmConfigs = [];
let llmPagination = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0
};
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
document.addEventListener('DOMContentLoaded', function () {
  // 加载类型定义（优先加载，其他函数依赖它）
  loadTypeDefinitions();

  // Load data on page load
  loadLLMConfigs();
  loadSystemPrompts();
  loadPromptVariables();
});

async function loadLLMConfigs(page = 1) {
  try {
    const res = await fetch(`/api/llm-configs?page=${page}&limit=${llmPagination.limit}`, { cache: 'no-store' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error('LLM configs API error:', res.status, errData);
      throw new Error(errData.error || '加载失败');
    }
    const data = await res.json();
    console.log('LLM configs loaded:', data);
    llmConfigs = data.configs || [];
    llmPagination.page = data.page || 1;
    llmPagination.total = data.total || 0;
    llmPagination.totalPages = data.totalPages || 0;
    renderLLMTable();
    renderPagination('llm');
  } catch (err) {
    console.error('Failed to load LLM configs:', err);
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

  // 任务类型显示名称映射
  const taskTypeLabels = {
    'filter': 'filter',
    'summary': 'summary',
    'keywords': 'keywords',
    'translation': 'translation',
    'daily_summary': 'daily_summary',
    'analysis': 'analysis'
  };

  tbody.innerHTML = llmConfigs.map(function (config) {
    const taskTypeDisplay = config.task_type
      ? '<span class="type-badge">' + escapeHtml(taskTypeLabels[config.task_type] || config.task_type) + '</span>'
      : '<span style="color: var(--dim);">—</span>';

    return '<tr>' +
      '<td>' +
      '<div class="llm-provider">' +
      '<span class="provider-badge ' + config.provider + '">' + config.provider + '</span>' +
      (config.is_default ? '<span class="default-badge">默认</span>' : '') +
      '</div>' +
      '</td>' +
      '<td><span class="type-badge">' + (config.config_type || 'llm') + '</span></td>' +
      '<td>' + taskTypeDisplay + '</td>' +
      '<td><span class="llm-model">' + escapeHtml(config.model) + '</span></td>' +
      '<td><span class="rss-url">' + escapeHtml(truncate(config.base_url, 35)) + '</span></td>' +
      '<td>' + escapeHtml(String(config.priority ?? 100)) + '</td>' +
      '<td>' +
      (config.enabled
        ? '<span class="status-badge active">已启用</span>'
        : '<span class="status-badge inactive">未启用</span>'
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
  document.getElementById('llmTaskType').value = '';
  document.getElementById('llmProvider').value = 'openai';
  document.getElementById('llmBaseURL').value = 'https://api.openai.com/v1';
  document.getElementById('llmApiKey').value = '';
  document.getElementById('llmModel').value = 'gpt-4o-mini';
  document.getElementById('llmTimeout').value = '30000';
  document.getElementById('llmMaxRetries').value = '3';
  document.getElementById('llmPriority').value = '100';
  document.getElementById('llmIsDefault').checked = llmConfigs.length === 0;
  document.getElementById('llmEnabled').checked = false;
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
  document.getElementById('llmTaskType').value = config.task_type || '';
  document.getElementById('llmProvider').value = config.provider;
  document.getElementById('llmBaseURL').value = config.base_url;
  document.getElementById('llmApiKey').value = '';
  document.getElementById('llmModel').value = config.model;
  document.getElementById('llmTimeout').value = config.timeout;
  document.getElementById('llmMaxRetries').value = config.max_retries;
  document.getElementById('llmPriority').value = config.priority ?? 100;
  document.getElementById('llmIsDefault').checked = config.is_default === 1;
  document.getElementById('llmEnabled').checked = config.enabled === 1;
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

  tbody.innerHTML = systemPrompts.map(function (prompt) {
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

document.getElementById('systemPromptForm').addEventListener('submit', async function (e) {
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

document.getElementById('systemPromptModal').addEventListener('click', function (e) {
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
  // 所有类型的配置都可以启用，不需要特殊处理
  // 启用选项始终显示
}

/**
 * 当任务类型改变时，自动取消"设为默认"选项
 * taskType 和 isDefault 是互斥的
 */
function updateTaskTypeChanged() {
  const taskType = document.getElementById('llmTaskType').value;
  const isDefaultCheckbox = document.getElementById('llmIsDefault');

  if (taskType) {
    // 选择了任务类型，自动取消"设为默认"
    isDefaultCheckbox.checked = false;
  }
}

/**
 * 当"设为默认"改变时，自动清空任务类型
 * taskType 和 isDefault 是互斥的
 */
function updateIsDefaultChanged() {
  const isDefaultCheckbox = document.getElementById('llmIsDefault');
  const taskTypeSelect = document.getElementById('llmTaskType');

  if (isDefaultCheckbox.checked) {
    // 设为默认，自动清空任务类型
    taskTypeSelect.value = '';
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
    enabled: document.getElementById('llmEnabled').checked,
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

document.getElementById('llmConfigForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const id = document.getElementById('llmConfigId').value;
  const data = {
    configType: document.getElementById('llmConfigType').value,
    taskType: document.getElementById('llmTaskType').value || null,
    provider: document.getElementById('llmProvider').value,
    baseURL: document.getElementById('llmBaseURL').value,
    apiKey: document.getElementById('llmApiKey').value,
    model: document.getElementById('llmModel').value,
    timeout: parseInt(document.getElementById('llmTimeout').value),
    maxRetries: parseInt(document.getElementById('llmMaxRetries').value),
    priority: parseInt(document.getElementById('llmPriority').value),
    isDefault: document.getElementById('llmIsDefault').checked,
    enabled: document.getElementById('llmEnabled').checked,
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
      loadLLMConfigs(llmPagination.page);
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
      // If current page is now empty (after delete), go to previous page
      const newPage = llmConfigs.length === 1 && llmPagination.page > 1
        ? llmPagination.page - 1
        : llmPagination.page;
      loadLLMConfigs(newPage);
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
      loadLLMConfigs(llmPagination.page);
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

document.getElementById('llmConfigModal').addEventListener('click', function (e) {
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

document.getElementById('chromaForm').addEventListener('submit', async function (e) {
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

// ============================================
// Journal Management
// ============================================

let journals = [];
let journalsPagination = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0
};

// Load journals on page load
loadJournals();

async function loadJournals(page = 1) {
  try {
    const res = await fetch(`/api/journals?page=${page}&limit=${journalsPagination.limit}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('加载失败');
    const data = await res.json();
    journals = data.journals || [];
    journalsPagination.page = data.page || 1;
    journalsPagination.total = data.total || 0;
    journalsPagination.totalPages = data.totalPages || 0;
    renderJournalsTable();
    renderPagination('journals');
  } catch (err) {
    console.error('Failed to load journals:', err);
  }
}

function renderJournalsTable() {
  const tbody = document.getElementById('journalsBody');
  const emptyState = document.getElementById('journalsEmptyState');
  const table = document.getElementById('journalsTable');

  if (!tbody) return;

  if (journals.length === 0) {
    table.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  table.style.display = 'table';
  emptyState.style.display = 'none';

  const sourceTypeLabels = {
    'cnki': 'CNKI',
    'rdfybk': '人大报刊',
    'lis': 'LIS',
    'wanfang': '万方'
  };

  const cycleLabels = {
    'monthly': '月刊',
    'bimonthly': '双月刊',
    'semimonthly': '半月刊',
    'quarterly': '季刊'
  };

  tbody.innerHTML = journals.map(function (journal) {
    const lastCrawl = journal.last_year && journal.last_issue
      ? journal.last_year + '-' + journal.last_issue
      : '从未';

    return '<tr>' +
      '<td class="rss-name">' + escapeHtml(journal.name) + '</td>' +
      '<td><span class="type-badge">' + (sourceTypeLabels[journal.source_type] || journal.source_type) + '</span></td>' +
      '<td>' + (cycleLabels[journal.publication_cycle] || journal.publication_cycle) + '</td>' +
      '<td>' + lastCrawl + '</td>' +
      '<td>' +
      '<span class="status-badge ' + journal.status + '">' + (journal.status === 'active' ? '启用' : '禁用') + '</span>' +
      '</td>' +
      '<td>' +
      '<div class="action-buttons">' +
      '<button class="btn-icon" onclick="showCrawlJournalModal(' + journal.id + ')">爬取</button>' +
      '<button class="btn-icon" onclick="editJournal(' + journal.id + ')">编辑</button>' +
      '<button class="btn-icon" onclick="deleteJournal(' + journal.id + ')">删除</button>' +
      '</div>' +
      '</td>' +
      '</tr>';
  }).join('');
}

function showJournalAddModal() {
  document.getElementById('journalModalTitle').textContent = '添加期刊';
  document.getElementById('journalId').value = '';
  document.getElementById('journalName').value = '';
  document.getElementById('journalSourceType').value = 'cnki';
  document.getElementById('journalUrl').value = '';
  document.getElementById('journalCode').value = '';
  document.getElementById('journalPublicationCycle').value = 'monthly';
  document.getElementById('journalIssuesPerYear').value = '12';
  document.getElementById('journalStatus').checked = true;
  updateJournalSourceUI();
  document.getElementById('journalModal').classList.add('active');
  document.getElementById('journalName').focus();
}

function editJournal(id) {
  const journal = journals.find(j => j.id === id);
  if (!journal) return;

  document.getElementById('journalModalTitle').textContent = '编辑期刊';
  document.getElementById('journalId').value = journal.id;
  document.getElementById('journalName').value = journal.name;
  document.getElementById('journalSourceType').value = journal.source_type;
  document.getElementById('journalUrl').value = journal.source_url || '';
  document.getElementById('journalCode').value = journal.journal_code || '';
  document.getElementById('journalPublicationCycle').value = journal.publication_cycle;
  document.getElementById('journalIssuesPerYear').value = journal.issues_per_year;
  document.getElementById('journalStatus').checked = journal.status === 'active';
  updateJournalSourceUI();
  document.getElementById('journalModal').classList.add('active');
}

function closeJournalModal() {
  document.getElementById('journalModal').classList.remove('active');
}

function updateJournalSourceUI() {
  const sourceType = document.getElementById('journalSourceType').value;
  const urlGroup = document.getElementById('journalUrlGroup');
  const codeGroup = document.getElementById('journalCodeGroup');
  const urlInput = document.getElementById('journalUrl');
  const codeInput = document.getElementById('journalCode');

  // rdfybk 和 wanfang 使用 journal code，其他类型使用 source url
  if (sourceType === 'rdfybk' || sourceType === 'wanfang') {
    urlGroup.style.display = 'none';
    codeGroup.style.display = 'block';
    urlInput.removeAttribute('required');
    codeInput.setAttribute('required', 'required');
  } else {
    urlGroup.style.display = 'block';
    codeGroup.style.display = 'none';
    urlInput.setAttribute('required', 'required');
    codeInput.removeAttribute('required');
  }

  // Update issues per year based on publication cycle
  const cycle = document.getElementById('journalPublicationCycle').value;
  const issuesMap = {
    'monthly': 12,
    'bimonthly': 6,
    'semimonthly': 24,
    'quarterly': 4
  };
  document.getElementById('journalIssuesPerYear').value = issuesMap[cycle] || 12;
}

// Sync issues per year when publication cycle changes
document.getElementById('journalPublicationCycle')?.addEventListener('change', function () {
  const cycle = this.value;
  const issuesMap = {
    'monthly': 12,
    'bimonthly': 6,
    'semimonthly': 24,
    'quarterly': 4
  };
  document.getElementById('journalIssuesPerYear').value = issuesMap[cycle] || 12;
});

// Journal form submit
document.getElementById('journalForm')?.addEventListener('submit', async function (e) {
  e.preventDefault();

  const id = document.getElementById('journalId').value;
  const sourceType = document.getElementById('journalSourceType').value;

  const data = {
    name: document.getElementById('journalName').value.trim(),
    sourceType: sourceType,
    sourceUrl: (sourceType === 'cnki' || sourceType === 'lis') ? document.getElementById('journalUrl').value.trim() : null,
    journalCode: (sourceType === 'rdfybk' || sourceType === 'wanfang') ? document.getElementById('journalCode').value.trim() : null,
    publicationCycle: document.getElementById('journalPublicationCycle').value,
    issuesPerYear: parseInt(document.getElementById('journalIssuesPerYear').value),
    status: document.getElementById('journalStatus').checked ? 'active' : 'inactive'
  };

  try {
    const url = id ? '/api/journals/' + id : '/api/journals';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      closeJournalModal();
      await loadJournals(journalsPagination.page);
      await showConfirm('期刊已保存', {
        title: '成功',
        okText: '知道了',
        okButtonType: 'btn-secondary'
      });
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

async function deleteJournal(id) {
  const confirmed = await showConfirm('确定要删除这个期刊吗？相关的爬取日志也会被删除。', {
    title: '删除期刊',
    okText: '删除',
    cancelText: '取消'
  });
  if (!confirmed) return;

  try {
    const res = await fetch('/api/journals/' + id, { method: 'DELETE' });
    if (res.ok) {
      const newPage = journals.length === 1 && journalsPagination.page > 1
        ? journalsPagination.page - 1
        : journalsPagination.page;
      loadJournals(newPage);
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

// Crawl Journal Modal
function showCrawlJournalModal(id) {
  const journal = journals.find(j => j.id === id);
  if (!journal) return;

  document.getElementById('crawlJournalId').value = journal.id;
  document.getElementById('crawlJournalNameDisplay').textContent = journal.name;

  // Set default year and issue
  const now = new Date();
  document.getElementById('crawlYear').value = now.getFullYear();
  document.getElementById('crawlIssue').value = 1;

  document.getElementById('crawlResult').className = 'test-result';
  document.getElementById('crawlResult').textContent = '';
  document.getElementById('crawlJournalModal').classList.add('active');
}

function closeCrawlJournalModal() {
  document.getElementById('crawlJournalModal').classList.remove('active');
}

// Crawl Journal form submit
document.getElementById('crawlJournalForm')?.addEventListener('submit', async function (e) {
  e.preventDefault();

  const id = document.getElementById('crawlJournalId').value;
  const year = parseInt(document.getElementById('crawlYear').value);
  const issue = parseInt(document.getElementById('crawlIssue').value);

  // 立即关闭弹窗
  closeCrawlJournalModal();

  // 发起爬取请求（后台执行，不显示结果弹窗）
  fetch('/api/journals/' + id + '/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year, issue })
  })
    .then(async (res) => {
      const result = await res.json();
      // 无论成功失败，都只刷新期刊列表
      await loadJournals(journalsPagination.page);
    })
    .catch(async () => {
      // 即使出错也刷新列表
      await loadJournals(journalsPagination.page);
    });
});

// Close modals on overlay click
document.getElementById('journalModal')?.addEventListener('click', function (e) {
  if (e.target === this) {
    closeJournalModal();
  }
});

document.getElementById('crawlJournalModal')?.addEventListener('click', function (e) {
  if (e.target === this) {
    closeCrawlJournalModal();
  }
});

// Update goToPage to handle journals
const originalGoToPage = goToPage;
goToPage = function (type, page) {
  if (type === 'journals') {
    loadJournals(page);
  } else {
    originalGoToPage(type, page);
  }
};

// ============================================
// Blacklist Settings
// ============================================

let blacklistConfig = null;

// Load blacklist settings on page load
loadBlacklistConfig();

async function loadBlacklistConfig() {
  try {
    const res = await fetch('/api/blacklist', { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('加载黑名单配置失败');
    }
    blacklistConfig = await res.json();
    populateBlacklistForm();
  } catch (err) {
    console.error('Failed to load blacklist config:', err);
    showBlacklistStatus('加载黑名单配置失败', 'error');
  }
}

function populateBlacklistForm() {
  if (!blacklistConfig) return;

  document.getElementById('blacklist-enabled').checked = blacklistConfig.title_keywords.enabled || false;
  document.getElementById('blacklist-keywords').value = blacklistConfig.title_keywords.keywords || '';
}

function resetBlacklistForm() {
  if (blacklistConfig) {
    populateBlacklistForm();
  }
  showBlacklistStatus('', '');
}

async function saveBlacklistConfig(e) {
  e.preventDefault();

  const payload = {
    title_keywords: {
      enabled: document.getElementById('blacklist-enabled').checked,
      keywords: document.getElementById('blacklist-keywords').value.trim(),
    },
  };

  try {
    const res = await fetch('/api/blacklist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      blacklistConfig = await res.json();
      showBlacklistStatus('黑名单配置已保存', 'success');
    } else {
      const result = await res.json();
      showBlacklistStatus(result.error || '保存失败', 'error');
    }
  } catch (err) {
    showBlacklistStatus('保存失败，请稍后重试', 'error');
  }
}

function showBlacklistStatus(message, type) {
  const el = document.getElementById('blacklist-status');
  if (!el) return;

  el.textContent = message || '';
  el.className = 'status-message ' + type;
  el.style.display = message ? 'block' : 'none';
}

// Blacklist form event listeners
document.getElementById('save-blacklist-btn')?.addEventListener('click', saveBlacklistConfig);
document.getElementById('reset-blacklist-btn')?.addEventListener('click', resetBlacklistForm);

// ============================================
// Telegram Settings
// ============================================

let telegramConfig = null;
// Track if credentials are already configured (exist in database)
let hasExistingCredentials = false;

// Load Telegram settings on page load
loadTelegramSettings();

async function loadTelegramSettings() {
  try {
    const res = await fetch('/api/settings/telegram', { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('加载 Telegram 配置失败');
    }
    telegramConfig = await res.json();
    populateTelegramForm();
  } catch (err) {
    console.error('Failed to load Telegram config:', err);
    showTelegramStatus('加载 Telegram 配置失败', 'error');
  }
}

function populateTelegramForm() {
  if (!telegramConfig) return;

  const enabledCheckbox = document.getElementById('telegramEnabled');
  const botTokenInput = document.getElementById('telegramBotToken');
  const chatIdInput = document.getElementById('telegramChatId');
  const dailySummaryCheckbox = document.getElementById('telegramDailySummary');
  const newArticlesCheckbox = document.getElementById('telegramNewArticles');
  const testBtn = document.getElementById('telegramTestBtn');
  const configFields = document.getElementById('telegramConfigFields');

  // Set form values
  enabledCheckbox.checked = telegramConfig.enabled || false;

  // Use hasCredentials flag from backend to check if credentials are configured
  hasExistingCredentials = telegramConfig.hasCredentials || false;

  // Handle botToken input
  // Only show masked placeholder if input is currently empty (user hasn't just entered a value)
  if (telegramConfig.botToken && !botTokenInput.value) {
    botTokenInput.placeholder = '已配置（点击修改）';
  }

  // Handle chatId input
  // Only show masked placeholder if input is currently empty (user hasn't just entered a value)
  if (telegramConfig.chatId && !chatIdInput.value) {
    chatIdInput.placeholder = '已配置（点击修改）';
  }

  dailySummaryCheckbox.checked = telegramConfig.dailySummary || false;
  newArticlesCheckbox.checked = telegramConfig.newArticles || false;

  // Enable/disable config fields based on enabled state
  if (configFields) {
    configFields.style.opacity = enabledCheckbox.checked ? '1' : '0.5';
    configFields.style.pointerEvents = enabledCheckbox.checked ? 'auto' : 'none';
  }

  // Enable/disable test button based on configuration
  if (testBtn) {
    const hasInputValues = botTokenInput.value || chatIdInput.value;
    testBtn.disabled = !enabledCheckbox.checked || (!hasInputValues && !hasExistingCredentials);
  }
}

async function saveTelegramSettings(e) {
  e.preventDefault();
  const success = await saveTelegramSettingsInternal();
  if (success) {
    showTelegramStatus('Telegram 配置已保存', 'success');
    // telegramConfig 已在 saveTelegramSettingsInternal 中从后端更新
    // 直接使用后端返回的数据重新填充表单
    populateTelegramForm();
  }
}

async function testTelegramConnection() {
  const testBtn = document.getElementById('telegramTestBtn');
  const originalText = testBtn.textContent;

  testBtn.textContent = '测试中...';
  testBtn.disabled = true;
  showTelegramStatus('', '');

  try {
    // Check if user has entered new values that need to be saved first
    const botTokenInput = document.getElementById('telegramBotToken');
    const chatIdInput = document.getElementById('telegramChatId');
    const botToken = botTokenInput.value.trim();
    const chatId = chatIdInput.value.trim();
    const enabled = document.getElementById('telegramEnabled').checked;

    // If user entered new values, save them first
    if (botToken || chatId) {
      const saveResult = await saveTelegramSettingsInternal();
      if (!saveResult) {
        showTelegramStatus('请先正确填写配置', 'error');
        testBtn.textContent = originalText;
        testBtn.disabled = false;
        return;
      }
      // telegramConfig 已在 saveTelegramSettingsInternal 中从后端更新
      // 直接重新填充表单
      populateTelegramForm();
    }

    // Now test the connection
    const res = await fetch('/api/settings/telegram/test', {
      method: 'POST',
    });

    const result = await res.json();

    if (result.success) {
      showTelegramStatus(result.message, 'success');
    } else {
      showTelegramStatus(result.message || '连接测试失败', 'error');
    }
  } catch (err) {
    console.error('Test connection error:', err);
    showTelegramStatus('连接测试失败，请稍后重试', 'error');
  } finally {
    testBtn.textContent = originalText;
    testBtn.disabled = false;
  }
}

// Internal save function that returns success/failure
async function saveTelegramSettingsInternal() {
  const enabled = document.getElementById('telegramEnabled').checked;
  const botTokenInput = document.getElementById('telegramBotToken');
  const chatIdInput = document.getElementById('telegramChatId');
  const botToken = botTokenInput.value.trim();
  const chatId = chatIdInput.value.trim();
  const dailySummary = document.getElementById('telegramDailySummary').checked;
  const newArticles = document.getElementById('telegramNewArticles').checked;

  // Check if fields were previously configured
  // Backend returns masked values (or empty) when credentials exist
  const hasExistingToken = !!(telegramConfig?.botToken);
  const hasExistingChatId = !!(telegramConfig?.chatId);

  // Validation - only require new values if enabling and no existing value
  if (enabled && !botToken && !hasExistingToken) {
    showTelegramStatus('请填写 Bot Token', 'error');
    return false;
  }
  if (enabled && !chatId && !hasExistingChatId) {
    showTelegramStatus('请填写 Chat ID', 'error');
    return false;
  }

  // Build payload - only include fields that have new values
  const payload = {
    enabled,
    dailySummary,
    newArticles,
  };

  if (botToken) payload.botToken = botToken;
  if (chatId) payload.chatId = chatId;

  try {
    const res = await fetch('/api/settings/telegram', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      telegramConfig = await res.json();
      // Clear input fields after successful save so placeholder shows
      if (botToken) botTokenInput.value = '';
      if (chatId) chatIdInput.value = '';
      return true;
    } else {
      const result = await res.json();
      showTelegramStatus(result.error || '保存失败', 'error');
      return false;
    }
  } catch (err) {
    showTelegramStatus('保存失败，请稍后重试', 'error');
    return false;
  }
}

function showTelegramStatus(message, type) {
  const el = document.getElementById('telegramStatus');
  if (!el) return;

  el.textContent = message || '';
  el.className = 'status-message ' + type;
  el.style.display = message ? 'block' : 'none';

  // Auto-hide success messages after 5 seconds
  if (type === 'success') {
    setTimeout(() => {
      el.textContent = '';
      el.className = 'status-message';
      el.style.display = 'none';
    }, 5000);
  }
}

function handleTelegramEnabledChange() {
  const enabled = document.getElementById('telegramEnabled').checked;
  const configFields = document.getElementById('telegramConfigFields');
  const botTokenInput = document.getElementById('telegramBotToken');
  const chatIdInput = document.getElementById('telegramChatId');
  const testBtn = document.getElementById('telegramTestBtn');

  // Enable/disable config fields
  if (configFields) {
    configFields.style.opacity = enabled ? '1' : '0.5';
    configFields.style.pointerEvents = enabled ? 'auto' : 'none';
  }

  // Update test button state
  if (testBtn) {
    const hasInputValues = botTokenInput.value || chatIdInput.value;
    testBtn.disabled = !enabled || (!hasInputValues && !hasExistingCredentials);
  }
}

// Telegram form event listeners
document.getElementById('telegramForm')?.addEventListener('submit', saveTelegramSettings);
document.getElementById('telegramEnabled')?.addEventListener('change', handleTelegramEnabledChange);
document.getElementById('telegramTestBtn')?.addEventListener('click', testTelegramConnection);

// Enable/disable test button when inputs change
document.getElementById('telegramBotToken')?.addEventListener('input', () => {
  const enabled = document.getElementById('telegramEnabled').checked;
  const botToken = document.getElementById('telegramBotToken').value.trim();
  const chatId = document.getElementById('telegramChatId').value.trim();
  const testBtn = document.getElementById('telegramTestBtn');
  if (testBtn) {
    const hasInputValues = botToken || chatId;
    testBtn.disabled = !enabled || (!hasInputValues && !hasExistingCredentials);
  }
});
document.getElementById('telegramChatId')?.addEventListener('input', () => {
  const enabled = document.getElementById('telegramEnabled').checked;
  const botToken = document.getElementById('telegramBotToken').value.trim();
  const chatId = document.getElementById('telegramChatId').value.trim();
  const testBtn = document.getElementById('telegramTestBtn');
  if (testBtn) {
    const hasInputValues = botToken || chatId;
    testBtn.disabled = !enabled || (!hasInputValues && !hasExistingCredentials);
  }
});

// ============================================================================
// 关键词订阅管理
// ============================================================================

let keywords = [];
let keywordsPagination = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0
};

// 加载关键词列表
async function loadKeywords(page = 1) {
  try {
    const res = await fetch(`/api/keywords?page=${page}&limit=${keywordsPagination.limit}`);
    if (!res.ok) throw new Error('Failed to load keywords');
    const data = await res.json();
    keywords = data.keywords || [];
    keywordsPagination.page = data.page;
    keywordsPagination.limit = data.limit;
    keywordsPagination.total = data.total;
    keywordsPagination.totalPages = data.totalPages;
    renderKeywordsTable();
    renderKeywordsPagination();
  } catch (err) {
    console.error('加载关键词失败:', err);
    showStatusMessage('加载关键词失败', 'error');
  }
}

// 渲染关键词表格
function renderKeywordsTable() {
  const tbody = document.getElementById('keywordsBody');
  const emptyState = document.getElementById('keywordsEmptyState');
  const table = document.getElementById('keywordsTable');

  if (keywords.length === 0) {
    table.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  table.style.display = 'table';
  emptyState.style.display = 'none';

  tbody.innerHTML = keywords.map(kw => `
    <tr>
      <td>${escapeHtml(kw.keyword)}</td>
      <td>${formatYearRange(kw.year_start, kw.year_end)}</td>
      <td>${getSpiderTypeLabel(kw.spider_type)}</td>
      <td>${kw.num_results}</td>
      <td>${kw.last_crawl_time ? formatDate(kw.last_crawl_time) : '<span style="color: #999">未爬取</span>'}</td>
      <td>${kw.total_articles || 0}</td>
      <td>${kw.is_active ? '<span class="badge-active">启用</span>' : '<span class="badge-inactive">停用</span>'}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="crawlKeywordNow(${kw.id})" title="立即爬取">爬取</button>
        <button class="btn btn-sm btn-secondary" onclick="showKeywordEditModal(${kw.id})" title="编辑">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="deleteKeyword(${kw.id})" title="删除">删除</button>
      </td>
    </tr>
  `).join('');
}

// 渲染分页
function renderKeywordsPagination() {
  const container = document.getElementById('keywordsPagination');
  if (keywordsPagination.totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const pages = [];
  for (let i = 1; i <= keywordsPagination.totalPages; i++) {
    pages.push(i);
  }

  container.innerHTML = `
    <div class="pagination">
      ${keywordsPagination.page > 1 ? `<button onclick="loadKeywords(${keywordsPagination.page - 1})">上一页</button>` : ''}
      ${pages.map(p => `
        <button class="${p === keywordsPagination.page ? 'active' : ''}" onclick="loadKeywords(${p})">${p}</button>
      `).join('')}
      ${keywordsPagination.page < keywordsPagination.totalPages ? `<button onclick="loadKeywords(${keywordsPagination.page + 1})">下一页</button>` : ''}
    </div>
  `;
}

// 格式化年份范围
function formatYearRange(start, end) {
  if (!start && !end) return '不限';
  const currentYear = new Date().getFullYear();
  const displayStart = start || (currentYear - 2);
  const displayEnd = end || '至今';
  return `${displayStart} - ${displayEnd}`;
}

// 获取爬虫类型标签
function getSpiderTypeLabel(type) {
  const labels = {
    'google_scholar': 'Google Scholar',
    'cnki': 'CNKI'
  };
  return labels[type] || type;
}

// 显示添加关键词模态框
function showKeywordAddModal() {
  document.getElementById('keywordModalTitle').textContent = '添加关键词订阅';
  document.getElementById('keywordId').value = '';
  document.getElementById('keywordText').value = '';
  document.getElementById('yearStart').value = '';
  document.getElementById('yearEnd').value = '';
  document.getElementById('spiderType').value = 'google_scholar';
  document.getElementById('numResults').value = '20';
  document.getElementById('keywordActive').checked = true;
  document.getElementById('keywordModal').style.display = 'flex';
}

// 显示编辑关键词模态框
async function showKeywordEditModal(id) {
  const keyword = keywords.find(k => k.id === id);
  if (!keyword) return;

  document.getElementById('keywordModalTitle').textContent = '编辑关键词订阅';
  document.getElementById('keywordId').value = keyword.id;
  document.getElementById('keywordText').value = keyword.keyword;
  document.getElementById('yearStart').value = keyword.year_start || '';
  document.getElementById('yearEnd').value = keyword.year_end || '';
  document.getElementById('spiderType').value = keyword.spider_type;
  document.getElementById('numResults').value = keyword.num_results;
  document.getElementById('keywordActive').checked = keyword.is_active === 1;
  document.getElementById('keywordModal').style.display = 'flex';
}

// 关闭关键词模态框
function closeKeywordModal() {
  document.getElementById('keywordModal').style.display = 'none';
}

// 保存关键词
async function saveKeyword() {
  const id = document.getElementById('keywordId').value;
  const keyword = document.getElementById('keywordText').value.trim();
  const yearStart = document.getElementById('yearStart').value;
  const yearEnd = document.getElementById('yearEnd').value;
  const spiderType = document.getElementById('spiderType').value;
  const numResults = parseInt(document.getElementById('numResults').value);
  const isActive = document.getElementById('keywordActive').checked;

  // 验证
  if (!keyword) {
    showStatusMessage('请输入关键词', 'error');
    return;
  }

  if (numResults < 10 || numResults > 100) {
    showStatusMessage('每次爬取结果数必须在 10-100 之间', 'error');
    return;
  }

  const data = {
    keyword,
    yearStart: yearStart ? parseInt(yearStart) : null,
    yearEnd: yearEnd ? parseInt(yearEnd) : null,
    spiderType,
    numResults,
    isActive
  };

  try {
    const url = id ? `/api/keywords/${id}` : '/api/keywords';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save keyword');
    }

    closeKeywordModal();
    await loadKeywords(keywordsPagination.page);
    showStatusMessage(id ? '关键词已更新' : '关键词已添加', 'success');
  } catch (err) {
    console.error('保存关键词失败:', err);
    showStatusMessage(err.message || '保存关键词失败', 'error');
  }
}

// 删除关键词
async function deleteKeyword(id) {
  if (!confirm('确定要删除这个关键词订阅吗？')) return;

  try {
    const res = await fetch(`/api/keywords/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete keyword');

    await loadKeywords(keywordsPagination.page);
    showStatusMessage('关键词已删除', 'success');
  } catch (err) {
    console.error('删除关键词失败:', err);
    showStatusMessage('删除关键词失败', 'error');
  }
}

// 手动触发爬取
async function crawlKeywordNow(id) {
  const keyword = keywords.find(k => k.id === id);
  if (!keyword) return;

  if (!confirm(`确定要立即爬取关键词 "${keyword.keyword}" 吗？`)) return;

  try {
    showStatusMessage('正在爬取，请稍候...', 'info');

    const res = await fetch(`/api/keywords/${id}/crawl`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to crawl keyword');

    const result = await res.json();

    if (result.success) {
      await loadKeywords(keywordsPagination.page);
      showStatusMessage(`爬取完成！获取 ${result.articlesCount} 篇文章，新增 ${result.newArticlesCount} 篇`, 'success');
    } else {
      showStatusMessage(`爬取失败：${result.error || '未知错误'}`, 'error');
    }
  } catch (err) {
    console.error('爬取关键词失败:', err);
    showStatusMessage('爬取关键词失败', 'error');
  }
}

// 加载关键词（当切换到关键词 tab 时）
const keywordsTabBtn = document.querySelector('.settings-tab[data-tab="keywords"]');
if (keywordsTabBtn) {
  keywordsTabBtn.addEventListener('click', () => {
    loadKeywords();
  });
}

// 初始加载（如果默认在关键词 tab）
if (document.querySelector('.settings-tab.active')?.dataset.tab === 'keywords') {
  loadKeywords();
}
