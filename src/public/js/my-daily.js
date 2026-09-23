/**
 * 我的每日 (My Daily) 交互逻辑
 */

(function () {
  /** 摘要折叠阈值，与首页一致 */
  const SUMMARY_TRUNCATE_LENGTH = 400;

  let currentDate = '';
  let todayDate = '';
  let articles = [];

  const dateSelect = document.getElementById('myDailyDateSelect');
  const dateHint = document.getElementById('myDailyDateHint');
  const statusEl = document.getElementById('myDailyStatus');
  const articlesList = document.getElementById('myDailyArticlesList');
  const emptyState = document.getElementById('myDailyEmptyState');
  const totalCountEl = document.getElementById('myDailyTotalCount');
  const highCountEl = document.getElementById('myDailyHighCount');
  const midCountEl = document.getElementById('myDailyMidCount');
  const lowCountEl = document.getElementById('myDailyLowCount');

  // 初始化
  async function init() {
    // 先上骨架屏，避免首屏空白后突然出现内容
    renderSkeleton();

    await loadAvailableDates();
    await loadArticles(currentDate);

    if (dateSelect) {
      dateSelect.addEventListener('change', (e) => {
        // 用户清空控件时回退到今天，避免日期状态与控件显示不一致
        const value = e.target.value || todayDate || getLocalToday();
        currentDate = value;
        dateSelect.value = value;
        updateDateHint();
        loadArticles(currentDate);
      });
    }
  }

  // 加载可评分的日期范围（原生日期控件用 min/max 限定，不再逐项列出可选日期）
  async function loadAvailableDates() {
    try {
      const res = await fetch('/api/my-daily/dates');
      if (!res.ok) throw new Error('获取日期失败');
      const data = await res.json();
      const dates = data.dates || [];

      // 服务端按用户时区返回的今天 (YYYY-MM-DD)，回退到浏览器本地日期
      todayDate = data.today || getLocalToday();

      if (!dates.includes(todayDate)) {
        dates.unshift(todayDate);
      }

      // dates 由服务端按时间倒序返回，第一天即最近的一天
      currentDate = dates[0] || todayDate;

      if (dateSelect) {
        dateSelect.value = currentDate;
        // 有效范围：可评分窗口内最早的一天 ~ 今天（不允许选未来日期）
        dateSelect.min = dates[dates.length - 1] || todayDate;
        dateSelect.max = todayDate;
      }
    } catch (err) {
      console.error('加载日期出错:', err);
      todayDate = getLocalToday();
      currentDate = todayDate;
      if (dateSelect) {
        dateSelect.value = todayDate;
        dateSelect.min = todayDate;
        dateSelect.max = todayDate;
      }
    }

    updateDateHint();
  }

  // 选中「今天」时给出胶囊标记（原生日期控件无法在选项里标注）
  function updateDateHint() {
    if (!dateHint) return;
    dateHint.style.display = currentDate === todayDate ? '' : 'none';
  }

  // 加载指定日期的评分文章
  async function loadArticles(date) {
    if (!articlesList) return;

    renderSkeleton();
    if (emptyState) emptyState.style.display = 'none';

    try {
      const url = date ? `/api/my-daily?date=${encodeURIComponent(date)}` : '/api/my-daily';
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '加载文章失败');
      }

      const data = await res.json();
      articles = data.articles || [];

      renderArticles();
    } catch (err) {
      console.error('加载每日文章失败:', err);
      articlesList.innerHTML = `
        <div style="text-align:center; padding: 40px; color: var(--danger, #e53e3e);">
          ❌ 加载失败: ${escapeHtml(err.message)}
        </div>
      `;
    }
  }

  // 加载中的骨架屏：按真实卡片的版式占位（标签行 / 标题 / 摘要 / 页脚）
  function renderSkeleton(count = 3) {
    if (!articlesList) return;

    // 外壳直接复用 .article-card，骨架与真实卡片的尺寸/间距天然一致
    const card = `
        <div class="article-card">
          <div class="article-card-header">
            <span class="my-daily-skeleton-bar" style="width: 62%; height: 22px;"></span>
            <span class="my-daily-skeleton-bar" style="width: 58px; height: 22px;"></span>
          </div>
          <span class="my-daily-skeleton-bar" style="width: 42%; height: 12px;"></span>
          <div class="my-daily-skeleton-lines">
            <span class="my-daily-skeleton-bar"></span>
            <span class="my-daily-skeleton-bar" style="width: 86%;"></span>
          </div>
          <div class="article-footer">
            <div class="article-tags">
              <span class="my-daily-skeleton-bar" style="width: 92px; height: 18px;"></span>
            </div>
          </div>
        </div>`;

    articlesList.innerHTML = `
      <div role="status">
        <span class="my-daily-sr-only">正在加载评分文章…</span>
        ${card.repeat(count)}
      </div>`;
  }

  // 渲染文章列表及统计
  function renderArticles() {
    if (!articlesList) return;

    const total = articles.length;
    const high = articles.filter(a => a.relevance_score >= 0.7).length;
    const mid = articles.filter(a => a.relevance_score >= 0.3 && a.relevance_score < 0.7).length;
    const low = articles.filter(a => a.relevance_score < 0.3).length;

    if (totalCountEl) totalCountEl.textContent = total;
    if (highCountEl) highCountEl.textContent = high;
    if (midCountEl) midCountEl.textContent = mid;
    if (lowCountEl) lowCountEl.textContent = low;

    // 三档之和必须等于总数，否则说明分档逻辑有洞
    if (high + mid + low !== total) {
      console.error('评分分档统计不一致:', { total, high, mid, low });
    }

    if (total === 0) {
      articlesList.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    articlesList.innerHTML = articles.map(article => {
      const score = article.relevance_score || 0;
      const isLow = score < 0.3;
      
      let scoreClass = 'my-daily-score-low';
      if (score >= 0.7) {
        scoreClass = 'my-daily-score-high';
      } else if (score >= 0.3) {
        scoreClass = 'my-daily-score-mid';
      }

      const scorePercent = Math.round(score * 100);
      // 标题固定用数据本身的 title：部分外文条目的 title_zh 实际存的是中文摘要，
      // 用它会和下面的 article-summary 重复。首页卡片同样只渲染 title。
      const title = article.title;
      const summary = article.summary_zh || article.summary || '';
      const domain = article.matched_domain;
      const originLabels = {
        rss: 'RSS',
        journal: '期刊',
        keyword: '关键词',
        email: '邮件',
        web: '网站爬虫',
      };
      const originLabel = originLabels[article.source_origin] || article.source_origin || '文章';
      const timeStr = formatDate(article.published_at || article.created_at);

      // 卡片结构与类名与「首页」一致（components/articles.css）
      return `
        <article class="article-card fade-in-up ${isLow ? 'is-low-score' : ''}">
          <div class="article-card-header">
            <h3 class="article-title">
              <a href="/articles/${article.id}">${escapeHtml(title)}</a>
            </h3>
            <span class="badge ${scoreClass}" title="JEV 综合相关性评分">★ ${scorePercent}%</span>
          </div>

          <div class="article-meta">
            <span>${escapeHtml(originLabel)}</span>
            <span>·</span>
            <span>${escapeHtml(timeStr)}</span>
            <span>·</span>
            <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener">原文链接</a>
          </div>

          ${renderSummary(summary)}

          <div class="article-footer">
            <div class="article-tags">
              ${domain ? `<span class="article-tag">🎯 ${escapeHtml(domain)}</span>` : ''}
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // 摘要：与首页卡片一致，超过 400 字折叠并可展开/收起
  function renderSummary(summary) {
    if (!summary) return '';

    if (summary.length <= SUMMARY_TRUNCATE_LENGTH) {
      return `<div class="article-summary">${escapeHtml(summary)}</div>`;
    }

    return `
      <div class="article-summary">
        <span class="summary-short">${escapeHtml(truncate(summary, SUMMARY_TRUNCATE_LENGTH))}</span>
        <span class="summary-full" style="display: none;">${escapeHtml(summary)}</span>
        <button class="summary-toggle" onclick="toggleSummary(this)">展开</button>
      </div>`;
  }

  function truncate(str, len) {
    if (!str) return '';
    if (str.length <= len) return str;
    return str.substring(0, len - 3) + '...';
  }

  // meta 行的日期文案与首页保持一致（今天 / 昨天 / 前天 / N 天前 / 日期）
  function formatDate(dateStr) {
    if (!dateStr) return '未知日期';

    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '未知日期';

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.floor((today - target) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays === 2) return '前天';
    if (diffDays < 7) return `${diffDays} 天前`;

    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // 与首页同名同行为（首页定义在 home.js，本页只加载 my-daily.js）
  window.toggleSummary = function (btn) {
    const container = btn.parentElement;
    const shortText = container.querySelector('.summary-short');
    const fullText = container.querySelector('.summary-full');

    if (fullText.style.display === 'none') {
      shortText.style.display = 'none';
      fullText.style.display = 'inline';
      btn.textContent = '收起';
    } else {
      fullText.style.display = 'none';
      shortText.style.display = 'inline';
      btn.textContent = '展开';
    }
  };

  // 浏览器本地时区下的今天 (YYYY-MM-DD)
  function getLocalToday() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  // 运行/排队进度写入状态行（role=status），不写进按钮文案
  function setStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.hidden = !text;
  }

  function showToastMessage(message, type) {
    if (window.toast && typeof window.toast[type] === 'function') {
      window.toast[type](message);
      return;
    }

    window.alert(message);
  }

  // 重新评分处理
  window.triggerRefreshDaily = async function () {
    const btn = document.getElementById('myDailyRefreshBtn');
    if (!btn || btn.disabled) return;

    // 按钮只置灰、不改文案；进度提示统一显示在按钮下方的状态行
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
    setStatus('正在调用 JEV 评分…');

    // 服务端是 FIFO 排队：若前面已有任务在执行，本请求会在服务端挂住等待。
    // 超过 2 秒仍未返回就补充说明正在排队，避免看起来像卡死。
    const queueHintTimer = setTimeout(() => {
      setStatus('正在排队等待（前面有任务在执行）…');
    }, 2000);

    try {
      const res = await fetch('/api/my-daily/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: currentDate }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '重新评分失败');
      }

      const failed = data.failed ?? 0;
      if (data.reason === 'duplicate') {
        showToastMessage(data.message || '该日期的评分正在进行中，请稍候', 'info');
      } else if (data.reason === 'no_articles') {
        showToastMessage(data.message || '该日期暂无新增文章，无需评分', 'info');
      } else if (failed > 0) {
        // 失败的文章会被写成占位 0 分，必须告诉用户，不能谎报全部成功
        showToastMessage(
          `评分完成：成功 ${data.scored ?? 0} 篇，失败 ${failed} 篇（JEV 调用失败，可稍后重新评分）`,
          'error'
        );
      } else {
        showToastMessage(`评分完成！已为 ${data.scored ?? 0} 篇文章完成个性化排序`, 'success');
      }

      // 结果由 toast 提示，状态行只负责"进行中"
      setStatus('');

      // 重新加载文章并同步日期控件的可选范围
      await loadAvailableDates();
      await loadArticles(currentDate);
    } catch (err) {
      console.error('重新评分失败:', err);
      setStatus('');
      showToastMessage(err.message, 'error');
    } finally {
      clearTimeout(queueHintTimer);
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.removeAttribute('aria-busy');
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
