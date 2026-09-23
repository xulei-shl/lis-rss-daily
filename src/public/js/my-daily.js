/**
 * 我的每日 (My Daily) 交互逻辑
 */

(function () {
  /** 摘要折叠阈值，与首页一致 */
  const SUMMARY_TRUNCATE_LENGTH = 400;

  let currentDate = '';
  let todayDate = '';
  let articles = [];
  let flipCleanupTimer = null;

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

  // 选中「今天」时给出胶囊标记（配合 CSS opacity/scale 平滑过渡）
  function updateDateHint() {
    if (!dateHint) return;
    dateHint.classList.toggle('is-visible', currentDate === todayDate);
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
        <div class="my-daily-empty" style="border-color: color-mix(in srgb, var(--red) 30%, transparent);">
          <div class="my-daily-empty-icon">⚠️</div>
          <h3 style="color: var(--red);">加载失败</h3>
          <p>${escapeHtml(err.message)}</p>
          <button class="btn btn-secondary" onclick="loadArticles(currentDate)">重新加载</button>
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

  // 统计计数更新
  function updateStatsCounters() {
    const total = articles.length;
    const high = articles.filter(a => a.relevance_score >= 0.7).length;
    const mid = articles.filter(a => a.relevance_score >= 0.3 && a.relevance_score < 0.7).length;
    const low = articles.filter(a => a.relevance_score < 0.3).length;

    if (totalCountEl) totalCountEl.textContent = total;
    if (highCountEl) highCountEl.textContent = high;
    if (midCountEl) midCountEl.textContent = mid;
    if (lowCountEl) lowCountEl.textContent = low;

    if (high + mid + low !== total) {
      console.error('评分分档统计不一致:', { total, high, mid, low });
    }
  }

  // 生成单张卡片的 HTML 字符串
  function renderArticleCardHtml(article, isJustUpdated = false) {
    const score = article.relevance_score || 0;
    const isLow = score < 0.3;
    
    let scoreClass = 'my-daily-score-low';
    if (score >= 0.7) {
      scoreClass = 'my-daily-score-high';
    } else if (score >= 0.3) {
      scoreClass = 'my-daily-score-mid';
    }

    const scorePercent = Math.round(score * 100);
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

    return `
      <article class="article-card ${isLow ? 'is-low-score' : ''} ${isJustUpdated ? 'is-scoring-just-updated' : ''}" data-id="${article.id}">
        <div class="article-card-header">
          <h3 class="article-title">
            <a href="/articles/${article.id}">${escapeHtml(title)}</a>
          </h3>
          <span class="badge ${scoreClass} my-daily-score-badge" title="JEV 综合相关性评分">★ ${scorePercent}%</span>
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
  }

  // 渲染整页文章列表及统计
  function renderArticles() {
    if (!articlesList) return;

    updateStatsCounters();

    if (articles.length === 0) {
      articlesList.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    articlesList.innerHTML = articles.map(article => renderArticleCardHtml(article)).join('');
  }

  /**
   * FLIP (First-Last-Invert-Play) 动态排位动画调度器
   * 在 JEV 实时返回单篇出分数据时，无缝插入列表并以阻尼曲线平滑滑向新排名
   */
  function applyFlipSort(updatedArticle) {
    if (!articlesList || !updatedArticle) return;

    // 清除骨架屏占位（锁定当前高度以避免清空时列表骤缩塌陷）
    const skeletonEl = articlesList.querySelector('[role="status"]');
    if (skeletonEl) {
      const currentHeight = articlesList.offsetHeight;
      if (currentHeight > 0) {
        articlesList.style.minHeight = `${currentHeight}px`;
      }
      articlesList.innerHTML = '';
    }

    // 取消上一次未结束的样式清理定时器，避免高频流式推送时中途强制截断正在运动的卡片
    if (flipCleanupTimer) {
      clearTimeout(flipCleanupTimer);
      flipCleanupTimer = null;
    }

    // 1. 合并入本地数据列表
    const existingIndex = articles.findIndex(a => a.id === updatedArticle.id);
    if (existingIndex >= 0) {
      articles[existingIndex] = { ...articles[existingIndex], ...updatedArticle };
    } else {
      articles.push(updatedArticle);
    }

    // 按评分从高到低排序，同分则按 id 降序保证稳定
    articles.sort((a, b) => {
      const diff = (b.relevance_score ?? 0) - (a.relevance_score ?? 0);
      if (diff !== 0) return diff;
      return (b.id ?? 0) - (a.id ?? 0);
    });

    if (emptyState) emptyState.style.display = 'none';
    updateStatsCounters();

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 2. First: 记录重排前各卡片实际视觉位置
    const firstPositions = new Map();
    if (!prefersReducedMotion) {
      articlesList.querySelectorAll('.article-card[data-id]').forEach(el => {
        firstPositions.set(Number(el.dataset.id), el.getBoundingClientRect().top);
      });
    }

    // 3. Update DOM: 调整卡片顺序与分值状态
    articles.forEach(art => {
      let cardEl = articlesList.querySelector(`.article-card[data-id="${art.id}"]`);
      if (!cardEl) {
        // 新卡片
        const temp = document.createElement('div');
        temp.innerHTML = renderArticleCardHtml(art, art.id === updatedArticle.id);
        cardEl = temp.firstElementChild;
      } else {
        // 已有卡片：更新分数徽章与分档状态
        const score = art.relevance_score || 0;
        const isLow = score < 0.3;
        cardEl.classList.toggle('is-low-score', isLow);

        let scoreClass = 'my-daily-score-low';
        if (score >= 0.7) {
          scoreClass = 'my-daily-score-high';
        } else if (score >= 0.3) {
          scoreClass = 'my-daily-score-mid';
        }

        const badgeEl = cardEl.querySelector('.my-daily-score-badge, .badge');
        if (badgeEl) {
          badgeEl.className = `badge ${scoreClass} my-daily-score-badge`;
          badgeEl.textContent = `★ ${Math.round(score * 100)}%`;
        }

        // 刚刚出分的卡片触发微脉冲动效（240ms 轻盈脉冲）
        if (art.id === updatedArticle.id) {
          cardEl.classList.remove('is-scoring-just-updated');
          void cardEl.offsetWidth; // 触发 reflow
          cardEl.classList.add('is-scoring-just-updated');
          setTimeout(() => {
            cardEl.classList.remove('is-scoring-just-updated');
          }, 300);
        }
      }

      // appendChild 自动将已有元素移动到排序对应的新位置
      articlesList.appendChild(cardEl);
    });

    if (prefersReducedMotion) return;

    // 4. Last & Invert: 测量新位置并反转坐标
    const movedCards = [];
    const newCards = [];

    articlesList.querySelectorAll('.article-card[data-id]').forEach(el => {
      const id = Number(el.dataset.id);
      const firstTop = firstPositions.get(id);
      const lastTop = el.getBoundingClientRect().top;

      if (firstTop !== undefined) {
        const deltaY = firstTop - lastTop;
        if (Math.abs(deltaY) > 0.5) {
          el.style.transform = `translateY(${deltaY}px)`;
          el.style.transition = 'none';
          movedCards.push(el);
        }
      } else {
        // 新卡片淡入与轻微上浮（由 10px 开始微浮，更加自然平滑）
        el.style.opacity = '0';
        el.style.transform = 'translateY(10px)';
        el.style.transition = 'none';
        newCards.push(el);
      }
    });

    // 强刷 layout 确保瞬移反转生效
    void articlesList.offsetHeight;

    // 5. Play: 下一帧开启动画平滑滑向新位置 (240ms 高度响应阻尼曲线，符合 Emil Kowalski <300ms 标准)
    requestAnimationFrame(() => {
      movedCards.forEach(el => {
        el.style.transition = 'transform 240ms cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.transform = '';
      });
      newCards.forEach(el => {
        el.style.transition = 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease-out';
        el.style.transform = '';
        el.style.opacity = '1';
      });
    });

    // 动画完成后清理 inline 样式
    flipCleanupTimer = setTimeout(() => {
      movedCards.forEach(el => {
        el.style.transition = '';
        el.style.transform = '';
      });
      newCards.forEach(el => {
        el.style.transition = '';
        el.style.transform = '';
        el.style.opacity = '';
      });
      flipCleanupTimer = null;
    }, 260);
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
        <button class="summary-toggle" type="button" aria-expanded="false" onclick="toggleSummary(this)">展开</button>
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
      btn.setAttribute('aria-expanded', 'true');
    } else {
      fullText.style.display = 'none';
      shortText.style.display = 'inline';
      btn.textContent = '展开';
      btn.setAttribute('aria-expanded', 'false');
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

  // 重新评分处理（支持 SSE 流式实时接收与 FLIP 动态重排）
  window.triggerRefreshDaily = async function () {
    const btn = document.getElementById('myDailyRefreshBtn');
    if (!btn || btn.disabled) return;

    // 按钮置灰并显示加载态
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
    setStatus('⚡ 正在连接 JEV 极速评分引擎…');

    const queueHintTimer = setTimeout(() => {
      setStatus('正在排队等待（前面有任务在执行）…');
    }, 2000);

    try {
      const res = await fetch('/api/my-daily/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({ date: currentDate }),
      });

      clearTimeout(queueHintTimer);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '重新评分失败');
      }

      if (!res.body) {
        throw new Error('当前浏览器环境不支持流式响应');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const handleProgressEvent = (eventType, data) => {
        if (eventType === 'start') {
          setStatus(`⚡ JEV 快速速读中… (0 / ${data.total} 篇)`);
          if (emptyState && data.total > 0) emptyState.style.display = 'none';
        } else if (eventType === 'item') {
          setStatus(`⚡ JEV 快速速读中… (${data.current} / ${data.total} 篇)`);
          applyFlipSort(data.article);
        } else if (eventType === 'done') {
          setStatus('');
          if (articlesList) articlesList.style.minHeight = '';
          if (data.failed > 0) {
            showToastMessage(
              `评分完成：成功 ${data.scored ?? 0} 篇，失败 ${data.failed} 篇（JEV 调用失败，可稍后重试）`,
              'error'
            );
          } else {
            showToastMessage(
              `⚡ JEV 评分完成！已为 ${data.scored ?? 0} 篇文章完成极速排序`,
              'success'
            );
          }
        } else if (eventType === 'info') {
          setStatus('');
          if (articlesList) articlesList.style.minHeight = '';
          showToastMessage(data.message || '评分提示', 'info');
        } else if (eventType === 'error') {
          setStatus('');
          if (articlesList) articlesList.style.minHeight = '';
          showToastMessage(data.error || '评分失败', 'error');
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          if (!block.trim()) continue;
          let eventType = 'message';
          let dataStr = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataStr += line.slice(5).trim();
            }
          }

          if (!dataStr) continue;
          try {
            const data = JSON.parse(dataStr);
            handleProgressEvent(eventType, data);
          } catch (e) {
            console.error('解析 SSE 数据异常:', e, dataStr);
          }
        }
      }

      // 评分完成后同步日期控件的可选范围
      await loadAvailableDates();
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
