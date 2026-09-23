/**
 * 我的每日 (My Daily) 交互逻辑
 */

(function () {
  let currentDate = '';
  let articles = [];

  const dateSelect = document.getElementById('myDailyDateSelect');
  const articlesList = document.getElementById('myDailyArticlesList');
  const emptyState = document.getElementById('myDailyEmptyState');
  const totalCountEl = document.getElementById('myDailyTotalCount');
  const highCountEl = document.getElementById('myDailyHighCount');
  const lowCountEl = document.getElementById('myDailyLowCount');

  // 初始化
  async function init() {
    await loadAvailableDates();
    await loadArticles(currentDate);

    if (dateSelect) {
      dateSelect.addEventListener('change', (e) => {
        currentDate = e.target.value;
        loadArticles(currentDate);
      });
    }
  }

  // 加载有评分结果的日期列表
  async function loadAvailableDates() {
    try {
      const res = await fetch('/api/my-daily/dates');
      if (!res.ok) throw new Error('获取日期失败');
      const data = await res.json();
      const dates = data.dates || [];

      // 获取今天的日期 (YYYY-MM-DD)
      const today = new Date().toISOString().split('T')[0];

      if (!dates.includes(today)) {
        dates.unshift(today);
      }

      currentDate = dates[0] || today;

      if (dateSelect) {
        dateSelect.innerHTML = dates.map(d => {
          const isToday = d === today;
          const label = isToday ? `${d} (今天)` : d;
          return `<option value="${d}" ${d === currentDate ? 'selected' : ''}>${label}</option>`;
        }).join('');
      }
    } catch (err) {
      console.error('加载日期出错:', err);
      const today = new Date().toISOString().split('T')[0];
      currentDate = today;
      if (dateSelect) {
        dateSelect.innerHTML = `<option value="${today}">${today} (今天)</option>`;
      }
    }
  }

  // 加载指定日期的评分文章
  async function loadArticles(date) {
    if (!articlesList) return;

    articlesList.innerHTML = '<div style="text-align:center; padding: 40px; color: var(--text-secondary);">⏳ 正在加载评分文章...</div>';
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

  // 渲染文章列表及统计
  function renderArticles() {
    if (!articlesList) return;

    const total = articles.length;
    const high = articles.filter(a => a.relevance_score >= 0.7).length;
    const low = articles.filter(a => a.relevance_score < 0.3).length;

    if (totalCountEl) totalCountEl.textContent = total;
    if (highCountEl) highCountEl.textContent = high;
    if (lowCountEl) lowCountEl.textContent = low;

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
      const title = article.title_zh || article.title;
      const summary = article.summary_zh || article.summary || '暂无摘要';
      const domain = article.matched_domain;
      const originLabels = {
        rss: 'RSS',
        journal: '期刊',
        keyword: '关键词',
        email: '邮件',
        web: '网站爬虫',
      };
      const originLabel = originLabels[article.source_origin] || article.source_origin || '文章';
      const timeStr = article.published_at 
        ? new Date(article.published_at).toLocaleDateString('zh-CN') 
        : (article.created_at ? new Date(article.created_at).toLocaleDateString('zh-CN') : '');

      return `
        <article class="my-daily-card ${isLow ? 'is-low-score' : ''}">
          <div class="my-daily-card-top">
            <div class="my-daily-card-tags">
              ${domain ? `<span class="my-daily-tag my-daily-tag-domain">🎯 ${escapeHtml(domain)}</span>` : ''}
              <span class="my-daily-tag my-daily-tag-source">${escapeHtml(originLabel)}</span>
            </div>
            <div class="my-daily-score-badge ${scoreClass}" title="JEV 综合相关性评分">
              <span>★</span>
              <span>${scorePercent}%</span>
            </div>
          </div>

          <h2 class="my-daily-card-title">
            <a href="/articles/${article.id}">${escapeHtml(title)}</a>
          </h2>

          <div class="my-daily-card-summary">
            ${escapeHtml(summary)}
          </div>

          <div class="my-daily-card-footer">
            <span class="my-daily-card-date">📅 ${escapeHtml(timeStr)}</span>
            <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer" class="my-daily-card-link">
              查看原文 ↗
            </a>
          </div>
        </article>
      `;
    }).join('');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // 重新评分处理
  window.triggerRefreshDaily = async function () {
    const btn = document.getElementById('myDailyRefreshBtn');
    if (!btn || btn.disabled) return;

    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ 正在打分中 (JEV 评估)...';

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

      if (typeof showToast === 'function') {
        const msg = data.scored !== undefined 
          ? `评分完成！已为 ${data.scored} 篇文章完成个性化排序` 
          : (data.message || '评分完成');
        showToast(msg, 'success');
      }

      // 重新加载文章并刷新日期下拉框
      await loadAvailableDates();
      await loadArticles(currentDate);
    } catch (err) {
      console.error('重新评分失败:', err);
      if (typeof showToast === 'function') {
        showToast(err.message, 'error');
      } else {
        alert(err.message);
      }
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
