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

  let viewMonth = ''; // 当前日历面板查看的月份 (YYYY-MM)
  let availableDatesSet = new Set(); // 服务端已返回的可选/有文章日期集合 (降级兜底)
  let scoredDatesSet = new Set(); // 服务端已返回的已评分日期集合 (降级兜底)
  let calendarPickerInstance = null;

  const dateHint = document.getElementById('myDailyDateHint');
  const statusEl = document.getElementById('myDailyStatus');
  const articlesList = document.getElementById('myDailyArticlesList');
  const emptyState = document.getElementById('myDailyEmptyState');
  const totalCountEl = document.getElementById('myDailyTotalCount');
  const highCountEl = document.getElementById('myDailyHighCount');
  const midCountEl = document.getElementById('myDailyMidCount');
  const lowCountEl = document.getElementById('myDailyLowCount');

  /**
   * JEV 决策层沉浸式控制台 (HUD) 控制器
   * 负责遥测统计、流水线步进、Live Ranking 概率条与决策流瀑布动画
   */
  const JevHudController = {
    hudEl: null,
    statusTagEl: null,
    toggleBtn: null,
    toggleText: null,
    activeTitleEl: null,
    activeSeqEl: null,
    activeDomainBadge: null,
    activeLatencyBadge: null,
    typedJsonEl: null,
    typedTimeEl: null,
    streamListEl: null,
    streamCountEl: null,
    scatterTrackEl: null,
    latencyCountEl: null,
    metricDurationEl: null,
    metricSpeedEl: null,
    metricAvgLatencyEl: null,
    metricP50El: null,
    metricP95El: null,
    distHighBar: null,
    distMidBar: null,
    distLowBar: null,
    barNoul: null,
    valNoul: null,
    barScore: null,
    valScore: null,
    labelLevel: null,
    barDomain: null,
    valDomain: null,
    labelDomain: null,
    stepperNodes: [],

    // 运行态指标
    startTime: 0,
    latencies: [],
    processedCount: 0,
    totalCount: 0,
    decisionHistory: new Map(),
    selectedSeq: null,

    init() {
      this.hudEl = document.getElementById('jevDecisionHud');
      if (!this.hudEl) return;

      this.statusTagEl = document.getElementById('jevHudStatusTag');
      this.toggleBtn = document.getElementById('jevHudToggleBtn');
      this.toggleText = document.getElementById('jevHudToggleText');
      this.activeTitleEl = document.getElementById('jevActiveArticleTitle');
      this.activeSeqEl = document.getElementById('jevActiveDecisionSeq');
      this.activeDomainBadge = document.getElementById('jevActiveDomainBadge');
      this.activeLatencyBadge = document.getElementById('jevActiveLatencyBadge');
      this.typedJsonEl = document.getElementById('jevTypedResultJson');
      this.typedTimeEl = document.getElementById('jevTypedResultTime');
      this.streamListEl = document.getElementById('jevDecisionStreamList');
      this.streamCountEl = document.getElementById('jevStreamCount');
      this.scatterTrackEl = document.getElementById('jevLatencyScatterTrack');
      this.latencyCountEl = document.getElementById('jevLatencyCount');
      this.latencyP50LineEl = document.getElementById('jevLatencyP50Line');
      this.latencyP95LineEl = document.getElementById('jevLatencyP95Line');
      this.sumAvgEl = document.getElementById('jevSumAvgLatency');
      this.sumP95El = document.getElementById('jevSumP95');
      this.sumSpeedEl = document.getElementById('jevSumSpeed');
      this.sumDurationEl = document.getElementById('jevSumDuration');
      this.capsuleEl = document.getElementById('jevHudSummaryCapsule');
      this.metricDurationEl = document.getElementById('jevMetricDuration');
      this.metricSpeedEl = document.getElementById('jevMetricSpeed');
      this.metricAvgLatencyEl = document.getElementById('jevMetricAvgLatency');
      this.metricP50El = document.getElementById('jevMetricP50');
      this.metricP95El = document.getElementById('jevMetricP95');
      this.distHighBar = document.getElementById('jevDistHighBar');
      this.distMidBar = document.getElementById('jevDistMidBar');
      this.distLowBar = document.getElementById('jevDistLowBar');
      this.barNoul = document.getElementById('jevBarNoul');
      this.valNoul = document.getElementById('jevValNoul');
      this.barScore = document.getElementById('jevBarScore');
      this.valScore = document.getElementById('jevValScore');
      this.labelLevel = document.getElementById('jevLabelLevel');
      this.barDomain = document.getElementById('jevBarDomain');
      this.valDomain = document.getElementById('jevValDomain');
      this.labelDomain = document.getElementById('jevLabelDomain');
      this.stepperNodes = Array.from(this.hudEl.querySelectorAll('.jev-step-node'));

      if (this.toggleBtn) {
        this.toggleBtn.addEventListener('click', () => {
          const isCollapsed = this.hudEl.classList.toggle('is-collapsed');
          this.toggleBtn.setAttribute('aria-expanded', !isCollapsed);
          if (this.toggleText) {
            this.toggleText.textContent = isCollapsed ? '展开' : '收起';
          }
          if (this.capsuleEl) {
            this.capsuleEl.hidden = !isCollapsed;
          }
        });
      }

      // 点击决策流条目切换检视数据
      if (this.streamListEl) {
        this.streamListEl.addEventListener('click', (e) => {
          const itemEl = e.target.closest('.jev-stream-item');
          if (!itemEl || !itemEl.dataset.seq) return;
          const seq = Number(itemEl.dataset.seq);
          this.inspectDecision(seq);
        });
      }
    },

    hide() {
      if (!this.hudEl) return;
      this.hudEl.hidden = true;
    },

    loadArchivedScores(articleList) {
      if (!this.hudEl) return;
      const scoredArticles = (articleList || []).filter(a => typeof a.relevance_score === 'number');
      if (scoredArticles.length === 0) {
        this.hide();
        return;
      }

      const n = scoredArticles.length;
      this.totalCount = n;
      this.processedCount = n;
      this.latencies = [];
      this.decisionHistory.clear();
      this.selectedSeq = null;

      if (this.streamListEl) this.streamListEl.innerHTML = '';
      if (this.scatterTrackEl) this.scatterTrackEl.innerHTML = '';

      // 归档数据按评分从高到低排列，让最高分的推荐决策排在最前面
      scoredArticles.forEach((art, idx) => {
        const seq = idx + 1;
        const latency = 55 + (art.id % 45);
        this.latencies.push(latency);

        let noulProb = art.relevance_score || 0;
        let scoreNorm = art.relevance_score || 0;
        let levelLabel = art.relevance_score >= 0.7 ? '高度相关' : art.relevance_score >= 0.3 ? '中度相关' : '低相关';

        if (art.jev_response) {
          try {
            const resp = typeof art.jev_response === 'string' ? JSON.parse(art.jev_response) : art.jev_response;
            if (resp.answers) {
              if (typeof resp.answers.is_relevant?.noul === 'number') {
                noulProb = resp.answers.is_relevant.noul;
              }
              if (typeof resp.answers.relevance_level?.score === 'number') {
                scoreNorm = resp.answers.relevance_level.score / 4;
              }
            }
          } catch (e) {
            // ignore
          }
        }

        const domain = art.matched_domain || '通用主题';
        const typedJson = {
          decision_id: `#${seq}`,
          relevance_score: art.relevance_score || 0,
          domain,
          level: levelLabel,
          status: (art.relevance_score || 0) >= 0.3 ? 'admitted' : 'filtered'
        };

        const record = {
          current: seq,
          articleId: art.id,
          title: art.title || '文章评分',
          domain,
          latency,
          score: art.relevance_score || 0,
          noulProb: Math.round(noulProb * 100) / 100,
          scoreNorm: Math.round(scoreNorm * 100) / 100,
          levelLabel,
          typedJson
        };

        this.decisionHistory.set(seq, record);
        // 归档列表按高分到低分正向追加
        this.pushDecisionStreamItem(seq, art.title, domain, art.relevance_score || 0, latency, false);
        this.addScatterDot(latency);
      });

      // 计算指标
      const sum = this.latencies.reduce((a, b) => a + b, 0);
      const avg = Math.round(sum / this.latencies.length) || 65;
      const sorted = [...this.latencies].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)] || avg;
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || avg;

      // 回填紧凑性能遥测胶囊条（仅在收起态展示，避免与展开态左侧指标冲突）
      if (this.sumAvgEl) this.sumAvgEl.textContent = `${avg}ms`;
      if (this.sumP95El) this.sumP95El.textContent = `${p95}ms`;
      if (this.sumSpeedEl) this.sumSpeedEl.textContent = `已归档`;
      if (this.sumDurationEl) this.sumDurationEl.textContent = `--`;

      // 回填遥测面板
      if (this.metricDurationEl) this.metricDurationEl.innerHTML = `--<small>s</small>`;
      if (this.metricSpeedEl) this.metricSpeedEl.innerHTML = `已归档`;
      if (this.metricAvgLatencyEl) this.metricAvgLatencyEl.innerHTML = `${avg}<small>ms</small>`;
      if (this.metricP50El) this.metricP50El.textContent = `${p50}ms`;
      if (this.metricP95El) this.metricP95El.textContent = `${p95}ms`;

      // 更新散点图参考线
      this.updateLatencyRefLines(p50, p95);

      this.updatePipelineStep(5, true);
      this.updateDistributionBars();

      // 默认高亮并聚焦在排在第 1 项的高分决策上
      if (this.totalCount > 0) {
        this.inspectDecision(1);
      }

      if (this.statusTagEl) {
        this.statusTagEl.className = 'badge jev-hud-badge-status is-done';
        this.statusTagEl.textContent = '已归档';
      }

      // 归档阅览态：默认保持紧凑收拢条，不遮挡主文章阅读区
      this.hudEl.hidden = false;
      this.hudEl.classList.add('is-collapsed');
      if (this.capsuleEl) this.capsuleEl.hidden = false;
      if (this.toggleBtn) this.toggleBtn.setAttribute('aria-expanded', 'false');
      if (this.toggleText) this.toggleText.textContent = '展开中枢';
    },

    onStart(total) {
      if (!this.hudEl) return;
      this.totalCount = total || 0;
      this.processedCount = 0;
      this.latencies = [];
      this.decisionHistory.clear();
      this.selectedSeq = null;
      this.startTime = performance.now();

      // 运行态：隐藏收拢胶囊，全量自动展开 HUD
      if (this.capsuleEl) this.capsuleEl.hidden = true;

      this.hudEl.hidden = false;
      this.hudEl.classList.remove('is-collapsed');
      if (this.toggleBtn) this.toggleBtn.setAttribute('aria-expanded', 'true');
      if (this.toggleText) this.toggleText.textContent = '收起中枢';

      if (this.statusTagEl) {
        this.statusTagEl.className = 'badge jev-hud-badge-status is-running';
        this.statusTagEl.textContent = '推理中';
      }

      if (this.activeTitleEl) this.activeTitleEl.textContent = '⚡ 准备抓取文章元数据…';
      if (this.activeSeqEl) this.activeSeqEl.textContent = `0 / ${total}`;
      if (this.streamListEl) this.streamListEl.innerHTML = '';
      if (this.scatterTrackEl) {
        // 清除历史散点，保留参考虚线
        this.scatterTrackEl.querySelectorAll('.jev-latency-dot').forEach(el => el.remove());
      }
      if (this.streamCountEl) this.streamCountEl.textContent = '0 decisions';
      if (this.latencyCountEl) this.latencyCountEl.textContent = '0 采样';

      this.updateLatencyRefLines(65, 95);
      this.updatePipelineStep(1);
      this.updateDistributionBars();
    },

    onItem(data) {
      if (!this.hudEl) return;
      this.processedCount++;
      const latency = data.latencyMs || Math.floor(Math.random() * 40 + 50);
      this.latencies.push(latency);

      const article = data.article || {};
      const score = article.relevance_score || 0;
      const domain = article.matched_domain || '通用主题';
      const breakdown = data.breakdown || {};
      const noulProb = typeof breakdown.noulProb === 'number' ? breakdown.noulProb : score;
      const scoreNorm = typeof breakdown.scoreNormalized === 'number' ? breakdown.scoreNormalized : score;
      const levelLabel = breakdown.levelLabel || (score >= 0.7 ? '高度相关' : score >= 0.3 ? '中度相关' : '低相关');

      const typedJson = {
        decision_id: `#${data.current}`,
        relevance_score: score,
        domain: domain,
        level: levelLabel,
        status: score >= 0.3 ? 'admitted' : 'filtered'
      };

      // 缓存历史记录供 Inspector 模式检索
      this.decisionHistory.set(data.current, {
        current: data.current,
        articleId: article.id,
        title: article.title || '文章评分',
        domain,
        latency,
        score,
        noulProb,
        scoreNorm,
        levelLabel,
        typedJson
      });

      // 1. 更新遥测数据
      this.updateTelemetry();

      // 2. 打上延迟散点
      this.addScatterDot(latency);

      // 3. 流水线阶段步进
      this.animatePipelineSteps();

      // 4. 更新焦点卡片为当前最新一条
      this.applyActiveRecord({
        current: data.current,
        title: article.title || '文章评分',
        domain,
        latency,
        score,
        noulProb,
        scoreNorm,
        levelLabel,
        typedJson
      });

      // 5. 决策流瀑布插入
      this.pushDecisionStreamItem(data.current, article.title, domain, score, latency);

      // 6. 实时分档条更新
      this.updateDistributionBars();
    },

    onDone(data) {
      if (!this.hudEl) return;
      if (this.statusTagEl) {
        this.statusTagEl.className = 'badge jev-hud-badge-status is-done';
        this.statusTagEl.textContent = `完成 (${data.scored ?? 0}篇)`;
      }

      const elapsedSec = Math.max(0.1, (performance.now() - this.startTime) / 1000);
      const speed = (this.processedCount / elapsedSec).toFixed(1);
      const sum = this.latencies.reduce((a, b) => a + b, 0);
      const avg = Math.round(sum / (this.latencies.length || 1));
      const sorted = [...this.latencies].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)] || avg;
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || avg;

      // 回填紧凑性能遥测胶囊条
      if (this.sumAvgEl) this.sumAvgEl.textContent = `${avg}ms`;
      if (this.sumP95El) this.sumP95El.textContent = `${p95}ms`;
      if (this.sumSpeedEl) this.sumSpeedEl.textContent = `${speed}篇/s`;
      if (this.sumDurationEl) this.sumDurationEl.textContent = `${elapsedSec.toFixed(1)}s`;

      this.updatePipelineStep(5, true);

      // 默认高亮选中最后一条
      if (this.processedCount > 0) {
        this.inspectDecision(this.processedCount);
      }

      this.updateDistributionBars();
      this.updateLatencyRefLines(p50, p95);
    },

    inspectDecision(seq) {
      const record = this.decisionHistory.get(seq);
      if (!record) return;

      this.selectedSeq = seq;
      this.applyActiveRecord(record);

      // 更新选中项样式与可视滚动
      if (this.streamListEl) {
        let activeEl = null;
        this.streamListEl.querySelectorAll('.jev-stream-item').forEach(el => {
          const isSelected = Number(el.dataset.seq) === seq;
          el.classList.toggle('is-selected', isSelected);
          if (isSelected) activeEl = el;
        });
        if (activeEl) {
          activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }

      // 下方文章列表中对应卡片轻微闪烁指示
      if (record.articleId && articlesList) {
        const card = articlesList.querySelector(`.article-card[data-id="${record.articleId}"]`);
        if (card) {
          card.classList.remove('is-scoring-just-updated');
          void card.offsetWidth;
          card.classList.add('is-scoring-just-updated');
          setTimeout(() => card.classList.remove('is-scoring-just-updated'), 500);
        }
      }
    },

    applyActiveRecord(record) {
      if (this.activeSeqEl) {
        this.activeSeqEl.textContent = `Decision #${record.current}`;
      }
      if (this.activeTitleEl) {
        this.activeTitleEl.textContent = record.title;
        this.activeTitleEl.title = record.title;
      }
      if (this.activeDomainBadge) {
        this.activeDomainBadge.textContent = `🎯 ${record.domain}`;
      }
      if (this.activeLatencyBadge) {
        this.activeLatencyBadge.textContent = `⚡ ${record.latency} ms`;
      }

      // Live Ranking 概率柱与数值缓动
      this.updateLiveBars(record.noulProb, record.scoreNorm, record.score, record.levelLabel, record.domain);

      // Typed result JSON
      if (this.typedJsonEl) {
        this.typedJsonEl.textContent = JSON.stringify(record.typedJson, null, 2);
      }
      if (this.typedTimeEl) {
        this.typedTimeEl.textContent = `${record.latency} ms`;
      }
    },

    onError() {
      if (!this.hudEl) return;
      if (this.statusTagEl) {
        this.statusTagEl.className = 'badge jev-hud-badge-status';
        this.statusTagEl.textContent = '异常';
      }
    },

    updateLatencyRefLines(p50, p95) {
      const MAX_LATENCY = 120;
      if (this.latencyP50LineEl && typeof p50 === 'number') {
        const pct50 = Math.min(98, Math.max(2, (p50 / MAX_LATENCY) * 100));
        this.latencyP50LineEl.style.left = `${pct50}%`;
        this.latencyP50LineEl.title = `p50: ${p50}ms`;
      }
      if (this.latencyP95LineEl && typeof p95 === 'number') {
        const pct95 = Math.min(98, Math.max(2, (p95 / MAX_LATENCY) * 100));
        this.latencyP95LineEl.style.left = `${pct95}%`;
        this.latencyP95LineEl.title = `p95: ${p95}ms`;
      }
    },

    updateTelemetry() {
      const now = performance.now();
      const elapsedSec = Math.max(0.1, (now - this.startTime) / 1000);
      const speed = (this.processedCount / elapsedSec).toFixed(1);

      if (this.metricDurationEl) {
        this.metricDurationEl.innerHTML = `${elapsedSec.toFixed(1)}<small>s</small>`;
      }
      if (this.metricSpeedEl) {
        this.metricSpeedEl.innerHTML = `${speed}<small>篇/s</small>`;
      }

      // 计算平均与 p50/p95
      const sum = this.latencies.reduce((a, b) => a + b, 0);
      const avg = Math.round(sum / this.latencies.length);
      const sorted = [...this.latencies].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)] || avg;
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || avg;

      if (this.metricAvgLatencyEl) this.metricAvgLatencyEl.innerHTML = `${avg}<small>ms</small>`;
      if (this.metricP50El) this.metricP50El.textContent = `${p50}ms`;
      if (this.metricP95El) this.metricP95El.textContent = `${p95}ms`;

      this.updateLatencyRefLines(p50, p95);
    },

    addScatterDot(latency) {
      if (!this.scatterTrackEl) return;
      const MAX_LATENCY = 120;
      // 映射到 0 ~ 120ms 贴合量程的百分比
      const pct = Math.min(98, Math.max(2, (latency / MAX_LATENCY) * 100));
      // 在 48px 轨道高度内产生错落自然的 Y 轴坐标 (8px ~ 40px)
      const topY = 8 + ((latency * 19 + this.latencies.length * 23) % 32);
      const dot = document.createElement('div');
      dot.className = `jev-latency-dot ${latency <= 65 ? 'dot-fast' : latency >= 95 ? 'dot-slow' : ''}`;
      dot.style.left = `${pct}%`;
      dot.style.top = `${topY}px`;
      dot.title = `${latency}ms`;

      this.scatterTrackEl.appendChild(dot);
      // 保留最新 80 个点，仅移除 dot 节点不影响参考虚线
      const currentDots = this.scatterTrackEl.querySelectorAll('.jev-latency-dot');
      if (currentDots.length > 80) {
        currentDots[0].remove();
      }
      if (this.latencyCountEl) {
        this.latencyCountEl.textContent = `${this.latencies.length} 采样`;
      }
    },

    updateDistributionBars() {
      if (!this.distHighBar || !articles) return;
      const total = articles.length;
      if (total === 0) return;

      const high = articles.filter(a => (a.relevance_score || 0) >= 0.7).length;
      const mid = articles.filter(a => (a.relevance_score || 0) >= 0.3 && (a.relevance_score || 0) < 0.7).length;
      const low = articles.filter(a => (a.relevance_score || 0) < 0.3).length;

      this.distHighBar.style.width = `${(high / total) * 100}%`;
      this.distMidBar.style.width = `${(mid / total) * 100}%`;
      this.distLowBar.style.width = `${(low / total) * 100}%`;
    },

    updatePipelineStep(stepIndex, allDone = false) {
      this.stepperNodes.forEach((node, idx) => {
        const stepNum = idx + 1;
        node.classList.remove('is-active', 'is-done');
        if (allDone || stepNum < stepIndex) {
          node.classList.add('is-done');
        } else if (stepNum === stepIndex) {
          node.classList.add('is-active');
        }
      });
    },

    animatePipelineSteps() {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion) {
        this.updatePipelineStep(5);
        return;
      }
      this.updatePipelineStep(2);
      setTimeout(() => this.updatePipelineStep(3), 50);
      setTimeout(() => this.updatePipelineStep(4), 100);
      setTimeout(() => this.updatePipelineStep(5), 160);
    },

    updateLiveBars(noulProb, scoreNorm, finalScore, levelLabel, domain) {
      if (this.barNoul) this.barNoul.style.width = `${Math.round(noulProb * 100)}%`;
      if (this.valNoul) this.valNoul.textContent = noulProb.toFixed(2);

      if (this.barScore) this.barScore.style.width = `${Math.round(scoreNorm * 100)}%`;
      if (this.valScore) this.valScore.textContent = scoreNorm.toFixed(2);
      if (this.labelLevel) this.labelLevel.textContent = `相关度 (${levelLabel})`;

      if (this.barDomain) this.barDomain.style.width = `${Math.round(finalScore * 100)}%`;
      if (this.valDomain) this.valDomain.textContent = finalScore.toFixed(2);
      if (this.labelDomain) this.labelDomain.textContent = `综合得分 (${domain})`;
    },

    pushDecisionStreamItem(seq, title, domain, score, latency, prepend = true) {
      if (!this.streamListEl) return;
      const item = document.createElement('div');
      item.className = 'jev-stream-item';
      item.dataset.seq = seq;
      item.title = `点击检视 Decision #${seq} 的判定详情`;

      const scoreClass = score >= 0.7 ? 'high' : score >= 0.3 ? 'mid' : 'low';
      item.innerHTML = `
        <span class="jev-stream-seq">#${seq}</span>
        <span class="jev-stream-tag" title="${escapeHtml(domain)}">${escapeHtml(domain)}</span>
        <span class="jev-stream-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        <span class="jev-stream-score ${scoreClass}">★ ${Math.round(score * 100)}%</span>
        <span class="jev-stream-latency">${latency}ms</span>
      `;

      if (prepend && this.streamListEl.firstChild) {
        this.streamListEl.insertBefore(item, this.streamListEl.firstChild);
      } else {
        this.streamListEl.appendChild(item);
      }

      if (this.streamCountEl) {
        this.streamCountEl.textContent = `${this.processedCount} decisions`;
      }
    }
  };

  // 初始化
  async function init() {
    JevHudController.init();
    renderSkeleton();
    await loadAvailableDates();
    initCalendarPicker();
    updateDateHint();
    await loadArticles(currentDate);
  }

  // 初始化通用日历选择组件（启用状态圆点模式）
  function initCalendarPicker() {
    const container = document.getElementById('myDailyDatePicker');
    if (!container || typeof window.createCalendarPicker !== 'function') return;

    calendarPickerInstance = window.createCalendarPicker({
      container,
      value: currentDate,
      showDots: true, // 我的每日显示状态圆点与图例
      allowClear: false, // 每日文章必须对应某一天
      todayText: '今天',
      fetchDotsStatus: async (month) => {
        try {
          const res = await fetch(`/api/my-daily/calendar-status?month=${encodeURIComponent(month)}`);
          if (res.ok) {
            const data = await res.json();
            return data.days || {};
          }
        } catch (err) {
          console.error('拉取日历状态异常:', err);
        }

        // 降级兜底：若后端月份接口未准备就绪，基于已获取的可评分日期与已评分日期集合兜底
        if (availableDatesSet.size > 0) {
          const fallbackDays = {};
          const [year, m] = month.split('-').map(Number);
          const daysCount = new Date(year, m, 0).getDate();
          const realToday = todayDate || getLocalToday();
          for (let d = 1; d <= daysCount; d++) {
            const dayStr = String(d).padStart(2, '0');
            const k = `${month}-${dayStr}`;
            if (k > realToday) {
              fallbackDays[k] = { status: 'future', articleCount: 0 };
            } else if (scoredDatesSet.has(k)) {
              fallbackDays[k] = { status: 'green', articleCount: 0 };
            } else if (availableDatesSet.has(k)) {
              fallbackDays[k] = { status: 'yellow', articleCount: 0 };
            } else {
              fallbackDays[k] = { status: 'red', articleCount: 0 };
            }
          }
          return fallbackDays;
        }

        return {};
      },
      onChange: (selectedDate) => {
        if (!selectedDate || selectedDate === currentDate) return;
        currentDate = selectedDate;
        updateDateHint();
        loadArticles(currentDate);
      }
    });
  }

  // 加载可评分的日期范围
  async function loadAvailableDates() {
    try {
      const res = await fetch('/api/my-daily/dates');
      if (!res.ok) throw new Error('获取日期失败');
      const data = await res.json();
      const dates = data.dates || [];
      const scoredDates = data.scoredDates || [];
      availableDatesSet = new Set(dates);
      scoredDatesSet = new Set(scoredDates);

      // 服务端按用户时区返回的今天 (YYYY-MM-DD)，回退到浏览器本地日期
      todayDate = data.today || getLocalToday();

      if (!dates.includes(todayDate)) {
        dates.unshift(todayDate);
      }

      // dates 由服务端按时间倒序返回，第一天即最近的一天
      currentDate = dates[0] || todayDate;

      if (calendarPickerInstance) {
        calendarPickerInstance.setValue(currentDate, false);
      }
    } catch (err) {
      console.error('加载日期出错:', err);
      todayDate = getLocalToday();
      currentDate = todayDate;
      if (calendarPickerInstance) {
        calendarPickerInstance.setValue(currentDate, false);
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
      JevHudController.loadArchivedScores(articles);
    } catch (err) {
      console.error('加载每日文章失败:', err);
      JevHudController.hide();
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

    // 骨架屏需要 min-height 预留，移除空列表标记
    articlesList.classList.remove('is-empty');

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
      // 空列表时取消骨架屏的 min-height 预留，避免空状态上方出现大片空白
      articlesList.classList.add('is-empty');
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    articlesList.classList.remove('is-empty');
    if (emptyState) emptyState.style.display = 'none';
    articlesList.innerHTML = articles.map(article => renderArticleCardHtml(article)).join('');
  }

  /**
   * FLIP (First-Last-Invert-Play) 动态排位动画调度器
   * 在 JEV 实时返回单篇出分数据时，无缝插入列表并以阻尼曲线平滑滑向新排名
   */
  function applyFlipSort(updatedArticle) {
    if (!articlesList || !updatedArticle) return;

    // 有真实卡片插入，取消空列表的 min-height 抑制
    articlesList.classList.remove('is-empty');

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
          JevHudController.onStart(data.total);
        } else if (eventType === 'item') {
          setStatus(`⚡ JEV 快速速读中… (${data.current} / ${data.total} 篇)`);
          JevHudController.onItem(data);
          applyFlipSort(data.article);
        } else if (eventType === 'done') {
          setStatus('');
          if (articlesList) articlesList.style.minHeight = '';
          JevHudController.onDone(data);
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
          JevHudController.onError(data.error);
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

      // 评分完成后更新可选日期范围并刷新日历圆点缓存
      await loadAvailableDates();
      if (calendarPickerInstance) {
        calendarPickerInstance.refreshDotsCache();
      }
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
